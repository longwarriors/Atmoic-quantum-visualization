"""Gates on the gate runners themselves: ``check.ps1``, ``ci.yml``, ``npm test``.

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

The last group pins ``web/package.json``'s ``test`` script, which is what
``check.ps1`` and ``ci.yml`` both reach the front-end gates through. Those
gates cannot defend their own invocation: deleting ``&& node
scripts/assert-coverage-scope.mjs`` from that one line leaves every remaining
check green, and deleting the pre-clean together with ``--coverage`` leaves
the verifier certifying the *previous* run's report. That is squarely in the
threat model the front-end gates adopted -- persisting a coverage flag into
this same ``test`` script is the bypass they exist to catch, and deleting a
gate from the chain is cheaper than editing one -- so the chain is pinned from
outside the chain, exactly as ``ci.yml`` and ``check.ps1`` already are.

Naming a stage was not enough on its own: the stages were matched by
substring, so ``vitest run --coverage.enabled=false`` satisfied the stage
called ``vitest run --coverage``, and with ``clean-coverage.mjs``'s artefact
list emptied the verifiers then certified the previous run's report. Naming
them as an ordered *subset* was not enough either -- an inserted stage was
permitted anywhere, and one that rewrote both reports took ``npm test`` to
exit 0 while vitest printed 66.66% for a gated module -- so the chain is now
pinned as an exact tuple. The same group also pins what the chain may *not*
say (no coverage override in the invocation), what npm wraps around it (no
``pretest`` / ``posttest``), what the pre-clean must delete, and that
``web/src/guards.test.ts`` -- which carries most of the front-end gate and
which nothing else in the repo reads -- still exists and still contains its
blocks.

Two pins in that group are here rather than in ``web/`` for a stronger reason
than symmetry: they are the only checks the *run* cannot reach. A Vite plugin's
``config()`` hook rewrites the configuration vitest resolves without touching a
byte of any file the front-end guards read, and a coverage provider reached
that way hands the run's own gates a report the run wrote itself -- measured,
with ``check.ps1`` printing "All checks passed!". Nothing inside the process
can settle that (see the boundary note atop
``web/scripts/assert-coverage-scope.mjs`` and ``docs/project/status.md``). What
these do is make the wiring impossible to add quietly: ``vitest.config.ts``
must declare no ``plugins``, and ``web/scripts/`` must hold exactly the modules
listed here.
"""

from __future__ import annotations

import json
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
WEB_PACKAGE_JSON = ROOT / "web" / "package.json"
WEB_GUARD_SPEC = ROOT / "web" / "src" / "guards.test.ts"
WEB_CLEAN_COVERAGE = ROOT / "web" / "scripts" / "clean-coverage.mjs"
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


def test_check_script_dereferences_a_junctioned_scripts_directory(tmp_path: Path) -> None:
    """A directory junction at ``scripts`` must not redirect the repo root.

    ``$PSScriptRoot`` is never dereferenced by PowerShell itself: a junction
    at ``foreign/scripts`` pointing at this repo's real ``scripts/`` used to
    leave ``$repoRoot`` at the junction, so every gate ran inside the empty
    ``foreign/`` tree and the run still exited 0 -- certifying neither tree.
    No admin/Developer-Mode privilege is needed to create a junction (unlike
    a symlink), so this is reachable by an unprivileged operator or process.
    The fix must resolve the junction back to the real repo before any gate
    runs.
    """

    pwsh = shutil.which("pwsh")
    assert pwsh, "pwsh is required to exercise scripts/check.ps1 (installed on GitHub runners)"

    stubs = tmp_path / "stubs"
    stubs.mkdir()
    _write_stub(stubs, "uv", "[stub uv]")
    _write_stub(stubs, "npm", "[stub npm]")

    foreign = tmp_path / "foreign"
    (foreign / "web").mkdir(parents=True)
    junction = foreign / "scripts"
    real_scripts = ROOT / "scripts"

    subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(real_scripts)],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        env = dict(os.environ, PATH=os.pathsep.join([str(stubs), os.environ.get("PATH", "")]))
        run = subprocess.run(
            [pwsh, "-NoProfile", "-File", str(junction / "check.ps1")],
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
            assert not _same_dir(cwd, foreign), (
                f"{program} {args!r} ran in the junctioned foreign tree, not the real repo"
            )

        announced = re.search(r"^check\.ps1: running every gate in (.+)$", run.stdout, re.MULTILINE)
        assert announced, run.stdout
        assert _same_dir(announced.group(1).strip(), ROOT), (
            "check.ps1 announced the junction's foreign tree instead of the real repo"
        )
    finally:
        subprocess.run(
            ["cmd", "/c", "rmdir", str(junction)], check=True, capture_output=True, text=True
        )
        assert not junction.exists(), "the junction must be removed after the test"
        assert (real_scripts / "check.ps1").exists(), (
            "removing the junction must not have touched the real scripts/ directory"
        )


def test_check_script_refuses_a_hard_linked_copy_outside_its_repo(tmp_path: Path) -> None:
    """A hard link to ``check.ps1`` has no reparse point to resolve.

    Unlike a junction, a hard link is just a second directory entry for the
    same file record -- there is no reparse point for the fix to dereference,
    so the script must recognise that the resolved root is not a genuine
    checkout (missing ``.git``/``pyproject.toml``) and refuse to run any gate
    there, rather than certifying the foreign tree the way the junction
    bypass once did.
    """

    pwsh = shutil.which("pwsh")
    assert pwsh, "pwsh is required to exercise scripts/check.ps1 (installed on GitHub runners)"

    stubs = tmp_path / "stubs"
    stubs.mkdir()
    _write_stub(stubs, "uv", "[stub uv]")
    _write_stub(stubs, "npm", "[stub npm]")

    foreign = tmp_path / "foreign2"
    (foreign / "scripts").mkdir(parents=True)
    (foreign / "web").mkdir()
    linked_script = foreign / "scripts" / "check.ps1"
    os.link(CHECK_SCRIPT, linked_script)
    try:
        env = dict(os.environ, PATH=os.pathsep.join([str(stubs), os.environ.get("PATH", "")]))
        run = subprocess.run(
            [pwsh, "-NoProfile", "-File", str(linked_script)],
            cwd=foreign,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert run.returncode != 0, (
            f"a hard-linked check.ps1 outside the repo must fail, not exit 0:\n{run.stdout + run.stderr}"
        )
        assert "[stub" not in run.stdout, (
            f"a gate ran against the foreign hard-linked tree before the script refused:\n{run.stdout}"
        )
    finally:
        # A hard link is a second directory entry for the real file's inode:
        # unlinking it here only decrements the link count, it never touches
        # the real scripts/check.ps1 (pytest's own tmp_path cleanup is lazy
        # and cross-session, so leaving this to it would pile up extra hard
        # links on the real file across repeated runs).
        linked_script.unlink()
        assert CHECK_SCRIPT.exists(), (
            "unlinking the foreign hard link must not remove the real check.ps1"
        )


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


# --- web/package.json test chain -------------------------------------------

#: The ``test`` script's ``&&``-joined stages, in full and in order.
#: ``clean-coverage.mjs`` first, or the two verifiers can be handed the
#: previous run's reports; ``--coverage`` on the vitest invocation, or no
#: coverage report is produced for ``assert-coverage-scope.mjs`` to read at
#: all; then the two post-run verifiers, which are the only checks that see
#: what the run actually measured and enforced rather than what the config
#: source declares.
NPM_TEST_STAGES = (
    "node scripts/clean-coverage.mjs",
    "tsc -p tsconfig.test.json --noEmit",
    "vitest run --coverage --reporter=default --reporter=json "
    "--outputFile=coverage/vitest-results.json",
    "node scripts/assert-no-skips.mjs",
    "node scripts/assert-coverage-scope.mjs",
)


def _npm_test_script() -> str:
    package = json.loads(WEB_PACKAGE_JSON.read_text(encoding="utf-8"))
    script = package["scripts"]["test"]
    assert isinstance(script, str), "web/package.json has no string `test` script"
    return script


def test_npm_test_runs_exactly_these_gates_in_exactly_this_order() -> None:
    """The stage list is the whole chain: same stages, same order, no extras.

    Naming the stages as an ordered *subset* was not enough. An **inserted**
    stage was permitted anywhere, and that is a complete bypass rather than a
    diff-review problem: with ``&& node scripts/postprocess-coverage.mjs``
    between vitest and the verifiers, plus a plugin ``config()`` hook deleting
    ``thresholds`` so vitest itself stays quiet, a forty-line script rebuilt
    both ``coverage/resolved-coverage.json`` and ``coverage/coverage-final.json``
    out of ``coverage-scope.json``. ``npm test`` exited 0 while vitest's own
    table two lines above the green gate summary read ``color.ts | 66.66``
    (measured; every check in this file passed).

    Everything between vitest and the verifiers is therefore pinned by
    exclusion: the segments must EQUAL this tuple. That also pins two stages
    the subset never named at all -- the ``tsc`` type-check, and the reporter
    flags that write the JSON result file ``assert-no-skips.mjs`` reads.

    Runs of whitespace inside a stage are collapsed before comparing, because
    reformatting one is not a security event; a stage cannot hide in the
    difference, since the split is on ``&&``.
    """

    stages = tuple(" ".join(segment.split()) for segment in _npm_test_script().split("&&"))

    assert stages == NPM_TEST_STAGES, (
        "web/package.json's `test` script is no longer exactly the pinned chain. Deleting a gate "
        "disables it as thoroughly as editing it, and INSERTING a stage between vitest and the "
        "verifiers lets that stage rewrite the reports they read (measured: exit 0 with vitest "
        f"printing 66.66% for a gated module).\n  found:    {stages}\n  expected: {NPM_TEST_STAGES}"
    )


def test_npm_test_stops_at_the_first_failing_gate() -> None:
    """Only ``&&`` may join the stages.

    ``;`` and a bare ``&`` both run the next stage regardless of the previous
    one's exit code, and ``||`` runs it only when the previous one failed. Any
    of the three would leave the chain looking complete while a red gate no
    longer failed the command.
    """

    script = _npm_test_script()
    assert ";" not in script, f"`;` ignores the previous stage's exit code: {script}"
    assert "||" not in script, f"`||` inverts the previous stage's exit code: {script}"
    assert "&" not in script.replace("&&", ""), (
        f"a bare `&` ignores the previous stage's exit code: {script}"
    )


#: Spellings that satisfy the ``vitest run --coverage`` stage above as a
#: substring while turning coverage off or reconfiguring it. ``--coverage.``
#: is the whole family of dotted overrides (``--coverage.enabled=false``,
#: ``--coverage.provider=custom``, ``--coverage.thresholds.lines=0``); a bare
#: ``--coverage`` is all the chain needs, so none of these belongs here.
FORBIDDEN_COVERAGE_FLAGS = ("--coverage.", "--coverage=", "--no-coverage")


def test_npm_test_configures_coverage_only_from_vitest_config() -> None:
    """No coverage override may be persisted into the ``test`` script.

    ``vitest run --coverage.enabled=false`` contains the string
    ``vitest run --coverage``, so the stage check above accepted it: combined
    with an emptied pre-clean list it left the verifiers certifying the
    *previous* run's report at exit 0 (measured). Every other dotted override
    is the same shape -- ``--coverage.provider=custom
    --coverage.customProviderModule=...`` hands the report to a module in this
    repo, and ``--coverage.thresholds.lines=0`` deletes what the report is
    scored against.

    The resolved-config capture catches all of them from inside the run
    (``coverage/resolved-coverage.json`` records what vitest resolved, and
    ``scripts/assert-coverage-scope.mjs`` deep-equals it against
    ``coverage-scope.json``). This is the cheap outer layer: the invocation
    itself carries no coverage configuration at all, so there is only one
    place that configuration can come from.
    """

    script = _npm_test_script()
    for flag in FORBIDDEN_COVERAGE_FLAGS:
        assert flag not in script, (
            f"web/package.json's `test` script passes {flag!r}: coverage must be configured "
            f"only by vitest.config.ts, which is what coverage-scope.json is pinned to. {script}"
        )


#: ``web/vitest.config.ts`` must declare no Vite/vitest ``plugins``.
#:
#: Matched as a key -- bare, quoted, or bracket-indexed -- rather than as the
#: bare word, so a comment may still discuss plugins.
_VITEST_PLUGINS_KEY = re.compile(r"""(?:\bplugins\b|['"]plugins['"])\s*\]?\s*:""")

WEB_VITEST_CONFIG = ROOT / "web" / "vitest.config.ts"


def test_vitest_config_declares_no_plugins() -> None:
    """The absence of a ``plugins`` key is pinned, because it is load-bearing.

    A Vite plugin's ``config()`` hook rewrites the config vitest RESOLVES
    without touching a byte of anything the front-end guards read. Two attacks
    used it and nothing else caught either: ``delete cfg.test.coverage
    .thresholds`` (which the resolved-config capture does now catch), and --
    the one that was caught by nothing at all -- pointing ``coverage.provider``
    at a module in this repo whose ``resolveOptions()`` returns
    ``{...options, provider: 'v8'}``. vitest assigns that return value onto the
    config object *before* ``globalSetup`` runs, so the pristine capture module
    writes a perfectly clean capture while nothing is instrumented: ``npm test``
    exit 0, every test in this file passing, ``check.ps1`` printing "All checks
    passed!", with an uncovered exported function shipping in a gated module.

    Nothing inside the run can see that, because everything inside the run is
    written by the process the attacker controls (see the boundary note atop
    ``web/scripts/assert-coverage-scope.mjs``). What this does is make the
    WIRING impossible to add silently: this repo declares no plugins, so a diff
    that adds one has to edit this file, and this assertion turns that from a
    thing a reviewer might notice into a red build. If a plugin is ever
    genuinely needed, pin the array here the way ``globalSetup`` is pinned in
    ``web/src/guards.test.ts``.
    """

    source = WEB_VITEST_CONFIG.read_text(encoding="utf-8")
    found = _VITEST_PLUGINS_KEY.search(source)
    assert not found, (
        "web/vitest.config.ts declares a `plugins` key: "
        f"{source[max(0, found.start() - 40) : found.end() + 40]!r}. A plugin's config() hook "
        "rewrites the config vitest resolves without touching any source the front-end guards "
        "read -- including coverage.provider, which decides who writes the coverage report."
    )


#: Every file under ``web/scripts/``, as sorted posix paths relative to it.
WEB_SCRIPTS = (
    "assert-coverage-scope.d.mts",
    "assert-coverage-scope.mjs",
    "assert-no-skips.d.mts",
    "assert-no-skips.mjs",
    "capture-resolved-coverage.d.mts",
    "capture-resolved-coverage.mjs",
    "clean-coverage.mjs",
)


def test_web_scripts_directory_holds_exactly_the_pinned_modules() -> None:
    """A new module cannot appear beside the gates without a reviewed edit.

    ``web/scripts/`` is where the chain's stages live, and both attacks the
    round above could not otherwise stop begin by adding one file to it: a fake
    coverage provider (``fake-coverage-provider.mjs``) and an inserted chain
    stage (``postprocess-coverage.mjs``). Neither is expensive to write; what
    makes them cheap is that they cost nothing to *land*.

    This is a manifest, with the same human-review latch ``coverage-scope.json``
    is: adding a module here is a one-line edit to this tuple, in the same
    reviewed commit. It is not a wall on its own -- a module can be put
    anywhere in ``web/``, and what actually stops it being reached is that
    every way of wiring one in is pinned from outside the run (no
    ``--coverage.`` flag in the ``test`` script, no ``plugins`` key in
    ``vitest.config.ts``, an exact stage tuple for the chain, and
    ``coverage.provider`` deep-equalled in three places). It closes the last
    cheap step of both.
    """

    scripts = ROOT / "web" / "scripts"
    assert scripts.is_dir(), "web/scripts/ is gone; the whole front-end gate chain lived there"
    found = tuple(
        sorted(
            path.relative_to(scripts).as_posix() for path in scripts.rglob("*") if path.is_file()
        )
    )
    assert found == WEB_SCRIPTS, (
        "web/scripts/ no longer holds exactly the pinned modules. A module that appears here "
        "without a reviewed edit to this list is how a forged coverage provider or an inserted "
        f"chain stage arrives.\n  found:    {found}\n  expected: {WEB_SCRIPTS}"
    )


def test_npm_test_runs_no_npm_lifecycle_hook_around_the_chain() -> None:
    """``pretest`` / ``posttest`` must not exist.

    npm runs them automatically around ``npm test``, so the pinned chain above
    describes only the middle of what actually executes. Neither can seed a
    report -- ``clean-coverage.mjs`` runs after ``pretest`` and deletes all
    three -- but both are arbitrary code the chain check says nothing about,
    and a gate whose invocation is pinned should not have unpinned bookends.
    """

    scripts = json.loads(WEB_PACKAGE_JSON.read_text(encoding="utf-8"))["scripts"]
    for hook in ("pretest", "posttest"):
        assert hook not in scripts, (
            f"web/package.json defines a `{hook}` script; npm runs it automatically around "
            f"`npm test`, outside everything NPM_TEST_STAGES pins: {scripts[hook]!r}"
        )


#: Every file ``scripts/clean-coverage.mjs`` must delete before vitest starts.
#: Each is an INPUT to a gate that runs after vitest, and each is only
#: evidence about *this* run while it cannot survive from the last one.
STALE_ARTEFACTS = (
    "coverage/coverage-final.json",
    "coverage/vitest-results.json",
    "coverage/resolved-coverage.json",
)


def test_clean_coverage_deletes_every_report_the_gates_read() -> None:
    """``STALE_ARTEFACTS`` is pinned from outside the file that carries it.

    Emptying that array is exactly as effective as deleting the pre-clean
    stage from the ``test`` script -- measured: with it set to ``[]`` and
    coverage turned off, both verifiers passed against the previous run's
    report while an uncovered function shipped. The stage is pinned above; the
    list the stage acts on is pinned here, for the same reason and in the same
    place, because ``web/`` cannot hold its own invocation honest.
    """

    source = WEB_CLEAN_COVERAGE.read_text(encoding="utf-8")
    match = re.search(r"const STALE_ARTEFACTS = \[(.*?)\]", source, re.DOTALL)
    assert match, "web/scripts/clean-coverage.mjs no longer declares a STALE_ARTEFACTS array"
    listed = tuple(re.findall(r"'([^']+)'", match.group(1)))
    assert listed == STALE_ARTEFACTS, (
        "web/scripts/clean-coverage.mjs must delete exactly the reports the post-run gates "
        f"read, in order. Found {listed}, expected {STALE_ARTEFACTS}"
    )


#: Blocks and test names ``web/src/guards.test.ts`` must still carry. Deleting
#: the file is cheaper than defeating any single one of them, and nothing else
#: in the repo would notice: ``assert-no-skips.mjs`` derives its expected spec
#: list from the disk, so a spec that no longer exists is simply not expected.
GUARD_SPEC_CONTENTS = (
    "describe('guard patterns (positive controls)'",
    "describe('scan scope'",
    "describe('committed suite integrity'",
    "describe('result gate (scripts/assert-no-skips.mjs)'",
    "describe('coverage scope gate (scripts/assert-coverage-scope.mjs)'",
    "describe('coverage threshold gate (scripts/assert-coverage-scope.mjs)'",
    "describe('resolved config gate (scripts/assert-coverage-scope.mjs)'",
    "has no skipped, todo, focused or conditionally-run tests",
    "has no coverage-ignore pragmas in gated source modules",
    "keeps the modules coverage excludes as type-only actually type-only",
    "sees code a type-only module emits without exporting it",
    "keeps every runtime module under a gated root inside the coverage include",
    "binds the coverage-gated derivation to the real coverage.include",
    "binds the globalSetup that captures the resolved config",
    "rejects a provider vitest loaded under some other name",
)


def test_web_guard_spec_still_exists_and_still_carries_its_gates() -> None:
    """The guard spec is pinned from outside itself, as the chain is.

    ``web/src/guards.test.ts`` carries the config-source half of the coverage
    binding, the runtime-extension policy, the pragma scan, the type-only
    guard and the derivation-vs-manifest comparison. Deleting it left
    ``npm test`` green at 96 tests with an uncovered ``src/api/sneaky.mts``
    shipping (measured). By the same argument that pins the chain -- deleting
    a gate disables it as thoroughly as editing it -- the file's existence and
    its named blocks are asserted here, where deleting the guard cannot also
    delete the assertion.
    """

    assert WEB_GUARD_SPEC.is_file(), (
        "web/src/guards.test.ts is gone; nothing else reads vitest.config.ts, scans committed "
        "sources for skip modifiers or coverage pragmas, or holds the coverage derivation to "
        "coverage-scope.json"
    )
    source = WEB_GUARD_SPEC.read_text(encoding="utf-8")
    missing = [name for name in GUARD_SPEC_CONTENTS if name not in source]
    assert not missing, (
        f"web/src/guards.test.ts no longer contains {missing}; emptying the file passes an "
        "existence check while disabling every guard in it"
    )
