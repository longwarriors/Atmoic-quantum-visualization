"""Gates on the gate runner itself: ``scripts/check.ps1``.

``check.ps1`` once ran its Python/docs steps in the *caller's* current
directory while anchoring only the npm steps on ``$PSScriptRoot``. Invoked by
absolute path from another checkout (an older clone, a second worktree) it
therefore lint-checked, type-checked, tested and built the docs of *that*
tree, ran the web tests of *this* tree, and exited 0 -- a verdict that
certified neither. These tests pin the fix: every step runs in the
repository the script lives in, whatever the caller's cwd.

The behavioural test needs ``pwsh``. It is on every GitHub runner image, and
``tests/conftest.py`` turns a skip into a failed session, so a machine without
it fails the test loudly rather than passing by omission.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK_SCRIPT = ROOT / "scripts" / "check.ps1"

_INVOKE = re.compile(r"^\s*Invoke-Checked\s", re.MULTILINE)
_PUSH_ROOT = re.compile(r"Push-Location\s+\$repoRoot")
_REPO_ROOT = re.compile(r"\$repoRoot\s*=.*\$PSScriptRoot.*'\.\.'")


def _same_dir(a: str | Path, b: str | Path) -> bool:
    # ``realpath`` expands Windows 8.3 short names (``SCHROD~1``) and symlinks;
    # ``normcase`` folds the case differences Windows tools introduce.
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


# --- check.ps1 -------------------------------------------------------------


def test_check_script_pushes_to_its_own_repo_root_before_any_gate() -> None:
    """Static guard: the repo-root ``Push-Location`` precedes every step.

    Cheap enough to run everywhere and independent of ``pwsh``; the
    behavioural test below is the one that proves the effect.
    """

    text = CHECK_SCRIPT.read_text(encoding="utf-8")
    invocations = list(_INVOKE.finditer(text))
    assert invocations, "check.ps1 no longer invokes any gate through Invoke-Checked"
    first_gate = invocations[0].start()
    last_gate = invocations[-1].end()

    root_assignment = _REPO_ROOT.search(text)
    assert root_assignment, "check.ps1 must derive $repoRoot from $PSScriptRoot/.."
    push = _PUSH_ROOT.search(text)
    assert push, "check.ps1 must Push-Location $repoRoot"
    assert root_assignment.end() < push.start() < first_gate, (
        "Push-Location $repoRoot must precede the first Invoke-Checked"
    )
    assert text.find("try {", push.end()) < first_gate, (
        "the repo-root Push-Location must be followed by a try block before the first gate"
    )
    closing = text.rfind("finally", last_gate)
    assert closing != -1 and "Pop-Location" in text[closing:], (
        "the last gate must be followed by a finally block that pops the location"
    )


def _write_stub(directory: Path, name: str, label: str) -> None:
    if sys.platform == "win32":
        # pwsh resolves ``& uv`` through PATH and PATHEXT, so a .cmd shadows
        # uv.exe when its directory comes first.
        (directory / f"{name}.cmd").write_text(
            f"@echo off\r\necho {label} cwd=%CD% args=%*\r\nexit /b 0\r\n", encoding="ascii"
        )
    else:
        stub = directory / name
        stub.write_text(f'#!/bin/sh\necho "{label} cwd=$PWD args=$*"\nexit 0\n', encoding="ascii")
        stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_check_script_runs_every_gate_in_its_own_checkout(tmp_path: Path) -> None:
    """Run ``check.ps1`` from a foreign cwd; every gate must see the repo root.

    ``uv`` and ``npm`` are shadowed by stubs that print their working
    directory, so the run is fast and the cwd of each step is observable.
    The foreign directory stands in for the older clone of the original
    failure: before the fix the six ``uv`` steps printed it.
    """

    pwsh = shutil.which("pwsh")
    assert pwsh, "pwsh is required to exercise scripts/check.ps1 (installed on GitHub runners)"

    stubs = tmp_path / "stubs"
    stubs.mkdir()
    _write_stub(stubs, "uv", "[stub uv]")
    _write_stub(stubs, "npm", "[stub npm]")
    foreign = tmp_path / "other-checkout"
    foreign.mkdir()

    env = dict(os.environ, PATH=os.pathsep.join([str(stubs), os.environ.get("PATH", "")]))
    run = subprocess.run(
        [pwsh, "-NoProfile", "-File", str(CHECK_SCRIPT)],
        cwd=foreign,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert run.returncode == 0, run.stdout + run.stderr

    steps = re.findall(r"^\[stub (uv|npm)\] cwd=(.+?) args=(.*)$", run.stdout, re.MULTILINE)
    programs = [program for program, _, _ in steps]
    assert programs == ["uv"] * 6 + ["npm"] * 2, run.stdout
    for program, cwd, args in steps:
        expected = ROOT if program == "uv" else ROOT / "web"
        assert _same_dir(cwd, expected), f"{program} {args!r} ran in {cwd}, not {expected}"
        assert not _same_dir(cwd, foreign), f"{program} {args!r} ran in the caller's cwd"

    # The script announces the root it resolved, so a log shows which tree
    # was certified.
    announced = re.search(r"^check\.ps1: running every gate in (.+)$", run.stdout, re.MULTILINE)
    assert announced, run.stdout
    assert _same_dir(announced.group(1).strip(), ROOT)
