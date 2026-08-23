"""The zero-skip policy in ``tests/conftest.py``, exercised end to end.

Each case runs a throwaway test file under the repository's own conftest and
``[tool.pytest.ini_options]`` (copied verbatim from ``pyproject.toml``) with
pytest's ``pytester`` plugin, so what is checked is the policy as this
repository actually runs it, not a re-implementation of it.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CONFTEST = (ROOT / "tests" / "conftest.py").read_text(encoding="utf-8")
ALLOW_SKIPS_ENV = "QUVIZ_ALLOW_SKIPS"


def _pytest_ini_options() -> str:
    """The ``[tool.pytest.ini_options]`` table of the repository's pyproject, verbatim."""

    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(
        r"^\[tool\.pytest\.ini_options\]\n(.*?)(?=^\[|\Z)", text, re.MULTILINE | re.DOTALL
    )
    assert match is not None
    return "[tool.pytest.ini_options]\n" + match.group(1)


@pytest.fixture
def policy(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch) -> pytest.Pytester:
    # The inner run is in-process and inherits os.environ; monkeypatch records
    # the original so a test file that mutates the variable is undone.
    monkeypatch.delenv(ALLOW_SKIPS_ENV, raising=False)
    pytester.makeconftest(CONFTEST)
    pytester.makepyprojecttoml(_pytest_ini_options())
    return pytester


def _run(pytester: pytest.Pytester, source: str) -> pytest.RunResult:
    pytester.makepyfile(test_case=source)
    return pytester.runpytest("test_case.py")


def test_repository_config_makes_an_unexpected_pass_a_failure(
    pytestconfig: pytest.Config,
) -> None:
    # ``xfail_strict`` is the pre-9 name; pytest 9 keeps it as an alias of
    # ``strict_xfail``. Either way the repository must have it on.
    assert pytestconfig.getini("xfail_strict") is True


def test_plain_skip_fails_the_session(policy: pytest.Pytester) -> None:
    result = _run(policy, "import pytest\n@pytest.mark.skip\ndef test_x():\n    pass\n")
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*skipped tests are failures*", "*SKIPPED*test_case.py::test_x*"])


def test_module_level_importorskip_fails_the_session(policy: pytest.Pytester) -> None:
    result = _run(policy, "import pytest\npytest.importorskip('quviz_no_such_module')\n")
    assert result.ret == pytest.ExitCode.TESTS_FAILED


def test_xfail_run_false_never_runs_the_body_so_it_is_a_skip(policy: pytest.Pytester) -> None:
    source = "import pytest\n@pytest.mark.xfail(run=False)\ndef test_x():\n    assert False\n"
    result = _run(policy, source)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*skipped tests are failures*", "*test_case.py::test_x*"])


def test_imperative_xfail_never_runs_the_body_so_it_is_a_skip(policy: pytest.Pytester) -> None:
    source = "import pytest\ndef test_x():\n    pytest.xfail('later')\n    assert False\n"
    result = _run(policy, source)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*skipped tests are failures*", "*test_case.py::test_x*"])


def test_unexpected_pass_fails_instead_of_passing_silently(policy: pytest.Pytester) -> None:
    source = "import pytest\n@pytest.mark.xfail(reason='not yet')\ndef test_x():\n    pass\n"
    result = _run(policy, source)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*XPASS(strict)*"])


def test_honest_xfail_whose_body_runs_and_fails_is_allowed(policy: pytest.Pytester) -> None:
    source = "import pytest\n@pytest.mark.xfail(reason='known')\ndef test_x():\n    assert False\n"
    result = _run(policy, source)
    assert result.ret == pytest.ExitCode.OK
    assert result.parseoutcomes() == {"xfailed": 1}


def test_flag_set_mid_run_does_not_disarm_the_policy(policy: pytest.Pytester) -> None:
    source = (
        "import os, pytest\n"
        "def test_x():\n"
        f"    os.environ[{ALLOW_SKIPS_ENV!r}] = '1'\n"
        "    pytest.skip('sneaky')\n"
    )
    result = _run(policy, source)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*skipped tests are failures*"])


def test_flag_set_before_the_run_allows_skips_only_when_it_is_exactly_one(
    policy: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = "import pytest\n@pytest.mark.skip\ndef test_x():\n    pass\n"
    monkeypatch.setenv(ALLOW_SKIPS_ENV, "1")
    assert _run(policy, source).ret == pytest.ExitCode.OK
    for value in ("true", "yes", "0", ""):
        monkeypatch.setenv(ALLOW_SKIPS_ENV, value)
        assert _run(policy, source).ret == pytest.ExitCode.TESTS_FAILED, value
