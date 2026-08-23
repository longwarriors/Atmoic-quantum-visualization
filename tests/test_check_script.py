"""Gates on the gate runners themselves: ``scripts/check.ps1`` and ``ci.yml``.

``check.ps1`` once ran its Python/docs steps in the *caller's* current
directory while anchoring only the npm steps on ``$PSScriptRoot``. Invoked by
absolute path from another checkout (an older clone, a second worktree) it
therefore lint-checked, type-checked, tested and built the docs of *that*
tree, ran the web tests of *this* tree, and exited 0 -- a verdict that
certified neither. The first two tests pin the fix: every step runs in the
repository the script lives in, whatever the caller's cwd.

``ci.yml``'s ``changed-links`` job resolves the revision to diff against. On a
push it used ``github.event.before``, which is the zero SHA for the first push
of a branch and a non-ancestor after a force push; both cases used to *skip*
the probe while the docs said the job ran on every push. The remaining tests
execute that step's actual shell script (read from the workflow, not
re-implemented) against throwaway repositories and require it to fall back to
``origin/master`` instead of skipping. When even that base contains HEAD --
the first or a force push of ``master`` itself, where ``origin/master`` *is*
HEAD and a diff against it is empty -- or when there is no ``origin/master``
at all, the step must not fall silent either: it asks the probe step to
sweep every cited URL and DOI instead, and the probe step's script is
executed here with a stub ``uv`` to show it honours that.

Both behavioural tests need an interpreter: ``pwsh`` for the PowerShell script
and a POSIX ``bash`` for the workflow step. Both are on every GitHub runner
image, and ``tests/conftest.py`` turns a skip into a failed session, so a
machine without them fails these tests loudly rather than passing by omission.
On Windows the ``bash`` on ``PATH`` is usually the WSL launcher, so the one
shipped with Git for Windows is located through ``git --exec-path``.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
CHECK_SCRIPT = ROOT / "scripts" / "check.ps1"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
ZERO_SHA = "0" * 40

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


def test_check_script_refuses_to_run_without_a_script_root(tmp_path: Path) -> None:
    """Piped into ``pwsh -Command -`` the script has no ``$PSScriptRoot``.

    In that mode each statement runs on its own, so the failed root
    resolution did not stop the run: it printed the error, ran no gate, and
    exited 0 -- certifying nothing. The script must exit non-zero instead.
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
        [pwsh, "-NoProfile", "-Command", "-"],
        cwd=foreign,
        env=env,
        input=CHECK_SCRIPT.read_text(encoding="utf-8"),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert run.returncode != 0, run.stdout + run.stderr
    assert "[stub" not in run.stdout, f"a gate ran without a resolved repo root:\n{run.stdout}"


# --- ci.yml changed-links base resolution ----------------------------------


def _git_bash() -> str:
    found = shutil.which("bash")
    if sys.platform == "win32" and (found is None or "system32" in found.lower()):
        # C:\Windows\System32\bash.exe launches WSL, not a POSIX shell for this
        # tree. Git for Windows ships one next to its exec path.
        exec_path = subprocess.run(
            ["git", "--exec-path"], capture_output=True, text=True, check=True
        ).stdout.strip()
        git_home = Path(exec_path).resolve().parents[2]
        candidates = [git_home / "bin" / "bash.exe", git_home / "usr" / "bin" / "bash.exe"]
        found = next((str(c) for c in candidates if c.exists()), None)
    assert found, (
        "a POSIX bash is required to execute the ci.yml step (installed on GitHub runners)"
    )
    return found


def _base_resolution_script() -> str:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["changed-links"]["steps"]
    (step,) = [s for s in steps if s.get("id") == "base"]
    script = step["run"]
    assert isinstance(script, str)
    return script


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True, encoding="utf-8"
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """``master`` at A, ``feature`` (checked out) at A->B, ``origin/master`` = A."""

    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "ci@example.invalid")
    _git(repo, "config", "user.name", "ci")
    (repo / "a.txt").write_text("a\n", encoding="utf-8")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-q", "-m", "A")
    _git(repo, "update-ref", "refs/remotes/origin/master", "HEAD")
    _git(repo, "checkout", "-q", "-b", "feature")
    (repo / "b.txt").write_text("b\n", encoding="utf-8")
    _git(repo, "add", "b.txt")
    _git(repo, "commit", "-q", "-m", "B")
    return repo


@dataclass(frozen=True)
class _Resolution:
    code: int
    output: str
    ref: str | None
    sweep: str | None


def _resolve_base(repo: Path, tmp_path: Path, **event: str) -> _Resolution:
    """Run the workflow step; return its exit code, combined output and outputs."""

    github_output = tmp_path / "github_output"
    github_output.write_text("", encoding="utf-8")
    env = dict(
        os.environ,
        GITHUB_OUTPUT=str(github_output),
        EVENT_NAME=event.get("EVENT_NAME", "push"),
        BASE_REF=event.get("BASE_REF", ""),
        BEFORE=event.get("BEFORE", ""),
    )
    run = subprocess.run(
        [_git_bash(), "-e", "-o", "pipefail", "-c", _base_resolution_script()],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    outputs = dict(
        line.split("=", 1)
        for line in github_output.read_text(encoding="utf-8").splitlines()
        if "=" in line
    )
    return _Resolution(
        run.returncode, run.stdout + run.stderr, outputs.get("ref"), outputs.get("sweep")
    )


def _diff_base(repo: Path, ref: str) -> str:
    return _git(repo, "merge-base", ref, "HEAD")


def test_pull_request_resolves_to_the_base_branch(repo: Path, tmp_path: Path) -> None:
    result = _resolve_base(repo, tmp_path, EVENT_NAME="pull_request", BASE_REF="master")
    assert result.code == 0, result.output
    assert result.ref == "origin/master"
    assert result.sweep is None


def test_push_resolves_to_the_commit_the_ref_moved_from(repo: Path, tmp_path: Path) -> None:
    before = _git(repo, "rev-parse", "HEAD~1")
    result = _resolve_base(repo, tmp_path, BEFORE=before)
    assert result.code == 0, result.output
    assert result.ref == before
    assert result.sweep is None


def test_first_push_of_a_branch_falls_back_to_master(repo: Path, tmp_path: Path) -> None:
    """``before`` is the zero SHA on a branch's first push: probe against master."""

    a = _git(repo, "rev-parse", "HEAD~1")
    result = _resolve_base(repo, tmp_path, BEFORE=ZERO_SHA)
    assert result.code == 0, result.output
    assert result.ref, f"the probe was skipped instead of falling back:\n{result.output}"
    assert _diff_base(repo, result.ref) == a
    assert result.sweep is None


def test_force_push_falls_back_to_master(repo: Path, tmp_path: Path) -> None:
    """``before`` is no ancestor of HEAD after a force push: probe against master."""

    a = _git(repo, "rev-parse", "HEAD~1")
    # A commit on a throwaway branch from A is what a rewritten history looks
    # like from HEAD: reachable from nothing HEAD descends from.
    _git(repo, "checkout", "-q", "-b", "rewritten", a)
    (repo / "c.txt").write_text("c\n", encoding="utf-8")
    _git(repo, "add", "c.txt")
    _git(repo, "commit", "-q", "-m", "C")
    orphan = _git(repo, "rev-parse", "HEAD")
    _git(repo, "checkout", "-q", "feature")

    result = _resolve_base(repo, tmp_path, BEFORE=orphan)
    assert result.code == 0, result.output
    assert result.ref, f"the probe was skipped instead of falling back:\n{result.output}"
    assert result.ref != orphan
    assert _diff_base(repo, result.ref) == a
    assert result.sweep is None


def test_unknown_before_sha_falls_back_to_master(repo: Path, tmp_path: Path) -> None:
    """A ``before`` the checkout never fetched must not abort or skip the step."""

    a = _git(repo, "rev-parse", "HEAD~1")
    result = _resolve_base(repo, tmp_path, BEFORE="f" * 40)
    assert result.code == 0, result.output
    assert result.ref, f"the probe was skipped instead of falling back:\n{result.output}"
    assert _diff_base(repo, result.ref) == a


def _push_of_master_itself(repo: Path) -> None:
    """Turn the fixture into a push of ``master``: HEAD == origin/master, one commit ahead."""

    _git(repo, "checkout", "-q", "master")
    (repo / "m.txt").write_text("m\n", encoding="utf-8")
    _git(repo, "add", "m.txt")
    _git(repo, "commit", "-q", "-m", "M")
    _git(repo, "update-ref", "refs/remotes/origin/master", "HEAD")


def test_first_push_of_master_itself_sweeps_every_link(repo: Path, tmp_path: Path) -> None:
    """``origin/master`` *is* HEAD: a diff against it is empty, so sweep instead."""

    _push_of_master_itself(repo)
    result = _resolve_base(repo, tmp_path, BEFORE=ZERO_SHA)
    assert result.code == 0, result.output
    assert result.ref is None, f"an empty diff was handed to the probe:\n{result.output}"
    assert result.sweep == "true", result.output
    assert "origin/master" in result.output


def test_force_push_of_master_itself_sweeps_every_link(repo: Path, tmp_path: Path) -> None:
    a = _git(repo, "rev-parse", "master")
    _git(repo, "checkout", "-q", "-b", "old", a)
    (repo / "old.txt").write_text("old\n", encoding="utf-8")
    _git(repo, "add", "old.txt")
    _git(repo, "commit", "-q", "-m", "OLD")
    old_tip = _git(repo, "rev-parse", "HEAD")
    _push_of_master_itself(repo)

    result = _resolve_base(repo, tmp_path, BEFORE=old_tip)
    assert result.code == 0, result.output
    assert result.ref is None, f"an empty diff was handed to the probe:\n{result.output}"
    assert result.sweep == "true", result.output


def test_without_any_master_the_step_sweeps_every_link(repo: Path, tmp_path: Path) -> None:
    """Nothing to diff against at all used to be the one remaining skip."""

    _git(repo, "update-ref", "-d", "refs/remotes/origin/master")
    result = _resolve_base(repo, tmp_path, BEFORE=ZERO_SHA)
    assert result.code == 0, result.output
    assert result.ref is None
    assert result.sweep == "true", result.output
    assert "origin/master" in result.output


def test_pull_request_against_a_missing_base_branch_fails_the_step(
    repo: Path, tmp_path: Path
) -> None:
    """A base the checkout does not have is an error, never an empty probe."""

    result = _resolve_base(repo, tmp_path, EVENT_NAME="pull_request", BASE_REF="nonexistent")
    assert result.code != 0, result.output
    assert result.ref is None and result.sweep is None


# --- ci.yml changed-links probe step ----------------------------------------


def _changed_links_steps() -> list[dict[str, object]]:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["changed-links"]["steps"]
    assert isinstance(steps, list)
    return steps


def _probe_script() -> str:
    (step,) = [s for s in _changed_links_steps() if str(s.get("name", "")).startswith("Probe")]
    script = step["run"]
    assert isinstance(script, str)
    return script


def test_no_step_of_the_changed_links_job_can_be_skipped() -> None:
    # The base step always produces either ``ref`` or ``sweep``; no step may
    # carry an ``if`` that turns the job into a silent no-op again.
    for step in _changed_links_steps():
        assert "if" not in step, step


def _run_probe_step(tmp_path: Path, **outputs: str) -> str:
    """Execute the probe step with a stub ``uv`` that prints its arguments."""

    stubs = tmp_path / "stubs"
    stubs.mkdir()
    stub = stubs / "uv"
    stub.write_text('#!/bin/sh\necho "[stub uv] $*"\nexit 0\n', encoding="ascii")
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    env = dict(
        os.environ,
        PATH=os.pathsep.join([str(stubs), os.environ.get("PATH", "")]),
        BASE=outputs.get("ref", ""),
        SWEEP=outputs.get("sweep", ""),
    )
    run = subprocess.run(
        [_git_bash(), "-e", "-o", "pipefail", "-c", _probe_script()],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert run.returncode == 0, run.stdout + run.stderr
    return run.stdout


def test_probe_step_diffs_against_the_resolved_base(tmp_path: Path) -> None:
    out = _run_probe_step(tmp_path, ref="origin/master")
    assert re.search(r"^\[stub uv\] .*check_links\.py --changed-since origin/master$", out, re.M), (
        out
    )
    assert "--include-doi" not in out


def test_probe_step_sweeps_every_link_when_asked(tmp_path: Path) -> None:
    out = _run_probe_step(tmp_path, sweep="true")
    assert re.search(r"^\[stub uv\] .*check_links\.py --include-doi$", out, re.M), out
    assert "--changed-since" not in out
