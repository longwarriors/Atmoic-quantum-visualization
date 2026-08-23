"""Session-wide pytest policy: a skipped test fails the run.

``pytest.importorskip`` or ``@pytest.mark.skip`` can drop a whole gate module
(``tests/test_references.py`` once skipped itself wholesale when the docs
dependency group was missing) while the run stays green -- and a green run
with a silently skipped gate is indistinguishable from one where the gate
passed. Every runner (``scripts/check.ps1``, ``make test``, CI) installs the
docs group, so nothing here has a legitimate reason to skip. The hook below
turns any skip into a failed session; set ``QUVIZ_ALLOW_SKIPS=1`` to allow
skips deliberately for a one-off run.
"""

from __future__ import annotations

import os

import pytest

ALLOW_SKIPS_ENV = "QUVIZ_ALLOW_SKIPS"
_skipped: list[str] = []


def _skips_allowed() -> bool:
    return os.environ.get(ALLOW_SKIPS_ENV) == "1"


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    # xfail also reports as "skipped" but carries ``wasxfail``; that is an
    # expected failure, not a dropped test.
    if report.skipped and not hasattr(report, "wasxfail"):
        _skipped.append(report.nodeid)


def pytest_collectreport(report: pytest.CollectReport) -> None:
    # A module-level ``importorskip`` / ``pytest.skip(allow_module_level=True)``
    # skips at collection time and never produces a test report.
    if report.skipped:
        _skipped.append(report.nodeid)


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    if not _skipped or _skips_allowed():
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
    # here is what makes the process exit non-zero.
    if _skipped and not _skips_allowed() and session.exitstatus == pytest.ExitCode.OK:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED
