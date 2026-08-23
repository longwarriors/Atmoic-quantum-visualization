"""Session-wide pytest policy: a skipped test fails the run.

``pytest.importorskip`` or ``@pytest.mark.skip`` can drop a whole gate module
(``tests/test_references.py`` once skipped itself wholesale when the docs
dependency group was missing) while the run stays green -- and a green run
with a silently skipped gate is indistinguishable from one where the gate
passed. Every runner (``scripts/check.ps1``, ``make test``, CI) installs the
docs group, so nothing here has a legitimate reason to skip. The hooks below
turn any skip into a failed session.

What counts as a skip is "the test body never ran to its own verdict":

* ``@pytest.mark.skip`` / ``pytest.skip()`` / ``importorskip`` / a module-level
  ``pytest.skip(allow_module_level=True)``;
* ``@pytest.mark.xfail(run=False)`` -- pytest reports it as xfailed
  (``[NOTRUN]``) without executing a line of the body;
* an imperative ``pytest.xfail()`` -- it raises out of the body at that
  statement, so whatever follows is never exercised.

An *honest* xfail -- ``@pytest.mark.xfail`` on a body that runs and fails --
remains allowed: the failure is real and recorded. ``xfail_strict = true`` in
``pyproject.toml`` makes the complementary case, a marked test that
unexpectedly passes, a failure rather than a silent XPASS.

Set ``QUVIZ_ALLOW_SKIPS=1`` (the literal ``1``) to allow skips deliberately
for a one-off run. The flag is read once, when pytest configures itself, so a
test cannot disarm the policy by setting the variable mid-run.
``tests/test_conftest_policy.py`` exercises each of these cases.
"""

from __future__ import annotations

import os

import pytest

ALLOW_SKIPS_ENV = "QUVIZ_ALLOW_SKIPS"
_skipped: list[str] = []
_allow_skips = False


def pytest_configure(config: pytest.Config) -> None:
    del config
    global _allow_skips
    _allow_skips = os.environ.get(ALLOW_SKIPS_ENV) == "1"


def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]) -> None:
    # ``pytest.xfail.Exception`` is raised by an imperative ``pytest.xfail()``
    # and by the ``[NOTRUN]`` path of ``xfail(run=False)``. Both leave the body
    # unexecuted, unlike a marked body that ran and failed (which reaches the
    # report as the real exception, not this one).
    if call.excinfo is not None and isinstance(call.excinfo.value, pytest.xfail.Exception):
        _skipped.append(f"{item.nodeid} (xfail without running: {call.excinfo.value.msg})")


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    # A marked xfail whose body ran and failed also reports as "skipped" but
    # carries ``wasxfail``; that is an expected failure, not a dropped test.
    # The never-ran variants are caught in ``pytest_runtest_makereport``.
    if report.skipped and not hasattr(report, "wasxfail"):
        _skipped.append(report.nodeid)


def pytest_collectreport(report: pytest.CollectReport) -> None:
    # A module-level ``importorskip`` / ``pytest.skip(allow_module_level=True)``
    # skips at collection time and never produces a test report.
    if report.skipped:
        _skipped.append(report.nodeid)


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    if not _skipped or _allow_skips:
        return
    terminalreporter.section("skipped tests are failures", sep="=", red=True, bold=True)
    for nodeid in _skipped:
        terminalreporter.write_line(f"SKIPPED {nodeid}")
    terminalreporter.write_line(
        f"A skipped gate is indistinguishable from a passing one; set {ALLOW_SKIPS_ENV}=1 "
        "to allow skips deliberately."
    )


def pytest_sessionfinish(session: pytest.Session) -> None:
    # pytest returns ``session.exitstatus`` after this hook runs, so raising it
    # here is what makes the process exit non-zero. A session whose only
    # module skipped itself at collection time otherwise ends as
    # NO_TESTS_COLLECTED, which hides the reason.
    harmless = {pytest.ExitCode.OK, pytest.ExitCode.NO_TESTS_COLLECTED}
    if _skipped and not _allow_skips and session.exitstatus in harmless:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED
