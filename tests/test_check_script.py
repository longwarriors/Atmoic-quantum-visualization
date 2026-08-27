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

Three pins in that group are here rather than in ``web/`` because they are
DIFF-REVIEW TRIPWIRES: each fires the moment a known wiring is written down,
which happens before the run rather than during it. A Vite plugin's ``config()``
hook rewrites the configuration vitest resolves without touching a byte of any
file the front-end guards read, and a coverage provider reached that way hands
the run's own gates a report the run wrote itself -- measured, with the whole of
``check.ps1`` exiting 0. No further layer *in the same trust domain* can settle
that: vitest, its config, its provider, the front-end gates and the artefacts
they read are all one mutable, equally-privileged checkout, and a domain like
that cannot vouch for itself (see the boundary note atop
``web/scripts/assert-coverage-scope.mjs`` and ``docs/project/status.md``).

Being in ``tests/`` is not itself that boundary, and nothing here should be read
as claiming it is: these are ordinary files in the same checkout, and a diff
that edits them is simply a bigger diff. What they do is put a price on the
WIRING, one spelling at a time: ``vitest.config.ts`` must declare no ``plugins``
and must import exactly the modules pinned here, and ``web/scripts/`` must hold
exactly the modules listed here. Each closes a way of reaching a provider; none
closes the provider, and the list is a list of the wirings that are known. The
import pin is here because without it the plugins array simply moved one import
away and took ``check.ps1`` to exit 0 with the other two silent -- measured, on
this tree.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import warnings
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
#: ``$repoRoot`` must come out of ``git rev-parse``, not out of string surgery
#: on ``$PSScriptRoot``. It used to be ``Join-Path <scripts dir> '..'``, which
#: is the caller's directory whenever the invoked path is not where the script
#: really lives.
_REPO_ROOT = re.compile(r"\$repoRoot\s*=.*\$gitLines\[0\]")
_GIT_REV_PARSE = re.compile(
    r"git\s+-C\s+\$scriptsDirectory\s+rev-parse\s+--show-toplevel\s+--show-prefix"
)
#: The script FILE, resolved through the link-following helper -- not just the
#: directory the invoked path happened to sit in.
_RESOLVE_SCRIPT_FILE = re.compile(r"\$scriptPath\s*=\s*Resolve-FinalTarget\s+\$PSCommandPath")
_RESOLVE_SCRIPT_DIR = re.compile(r"\$scriptsDirectory\s*=\s*Resolve-FinalTarget\s")
_REFUSE_HARD_LINK = re.compile(r"\.LinkType\s+-eq\s+'HardLink'")


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
    assert root_assignment, "check.ps1 must derive $repoRoot from git rev-parse --show-toplevel"
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


def test_check_script_resolves_the_script_file_and_proves_the_root_with_git() -> None:
    """Static guard: the four pieces of the root resolution, in order.

    ``$PSScriptRoot`` is the directory the *invoked path* sits in, so it
    answers "where was I called from", not "where do I live". Resolving it
    alone left two ways to redirect the root: a file symlink at
    ``scripts/check.ps1`` (a reparse point on the file, which asking the
    directory never sees) and a hard link to it (a second directory entry for
    the same file, with no reparse point at all). The identity check that was
    supposed to catch the second was ``Test-Path`` on ``.git`` and
    ``pyproject.toml`` -- two *empty* files satisfied it, and a hard-linked
    script in a directory carrying them ran all eight gates there and exited 0
    announcing that tree (reproduced).

    So all four must be present, and the order matters: refuse a hard link
    before anything else can resolve it away, follow a file symlink to its
    target, resolve that target's *directory* (the aliased-directory case the
    behavioural test below covers), and only then ask git.

    The behavioural tests below prove the effect; this one runs everywhere and
    is independent of ``pwsh``, exactly as the ``Push-Location`` guard above is.
    """

    text = CHECK_SCRIPT.read_text(encoding="utf-8")

    refusal = _REFUSE_HARD_LINK.search(text)
    assert refusal, (
        "check.ps1 must refuse a hard-linked script ((Get-Item ...).LinkType -eq 'HardLink'); "
        "a hard link has no reparse point to follow, so it can only be refused"
    )
    resolve_file = _RESOLVE_SCRIPT_FILE.search(text)
    assert resolve_file, (
        "check.ps1 must resolve $PSCommandPath -- the script FILE -- through Resolve-FinalTarget; "
        "resolving only $PSScriptRoot leaves a file symlink pointing the root at the caller's tree"
    )
    resolve_dir = _RESOLVE_SCRIPT_DIR.search(text)
    assert resolve_dir, (
        "check.ps1 must resolve the resolved script's DIRECTORY too; ResolveLinkTarget follows the "
        "final path component only, so an aliased scripts/ -- a junction, or a directory "
        "symlink -- survives resolving the file alone"
    )
    rev_parse = _GIT_REV_PARSE.search(text)
    assert rev_parse, (
        "check.ps1 must prove the resolved root with `git -C $scriptsDirectory rev-parse "
        "--show-toplevel --show-prefix`; two empty files named .git and pyproject.toml satisfied "
        "the Test-Path check this replaces"
    )
    assert "-ne 'scripts/'" in text, (
        "check.ps1 must require git's --show-prefix to be exactly 'scripts/'; without it the "
        "resolved root could be a parent, a sibling or a subdirectory of the real checkout"
    )
    assert "QuViz" in text, (
        "check.ps1 must require pyproject.toml to declare this project by name; every git "
        "checkout satisfies rev-parse, only this one declares itself"
    )

    root_assignment = _REPO_ROOT.search(text)
    assert root_assignment, "check.ps1 must derive $repoRoot from git rev-parse --show-toplevel"
    assert refusal.start() < resolve_file.start() < resolve_dir.start() < rev_parse.start(), (
        "check.ps1 must refuse a hard link, then follow a file symlink, then resolve that "
        "target's directory, then ask git -- in that order"
    )
    first_gate = _INVOKE.search(text)
    assert first_gate and root_assignment.end() < first_gate.start(), (
        "the whole root resolution must complete before the first Invoke-Checked"
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


def _alias_directory(alias: Path, target: Path) -> None:
    """Point ``alias`` at the directory ``target`` using the platform's alias.

    The property under test is the same on both: a reparse alias whose final
    component PowerShell hands to the script undereferenced. Only the way to
    create one differs, and neither way needs a privilege. On Windows that is
    a junction -- a directory *symlink* there would need
    ``SeCreateSymbolicLinkPrivilege`` exactly as a file symlink does, which is
    why the file-symlink test below is the privileged case and this one is
    not. On POSIX it is a directory symlink, which needs nothing; there is no
    ``cmd`` to run ``mklink`` there, and this test used to shell out to it
    unconditionally and die with ``FileNotFoundError: 'cmd'`` on every Linux
    runner (measured in CI once the workflow was able to run at all).
    """

    if sys.platform == "win32":
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(alias), str(target)],
            check=True,
            capture_output=True,
            text=True,
        )
    else:
        os.symlink(target, alias, target_is_directory=True)


def _unalias_directory(alias: Path) -> None:
    """Remove the alias itself, never anything it points at.

    ``rmdir`` on a junction and ``os.unlink`` on a symlink both unlink the
    alias and leave the target untouched. A recursive delete of ``alias`` or
    of any parent holding it would instead walk through it into this repo's
    real ``scripts/`` and delete the checkout's own files, so no test here may
    use one while an alias exists inside ``tmp_path``.
    """

    if sys.platform == "win32":
        subprocess.run(
            ["cmd", "/c", "rmdir", str(alias)], check=True, capture_output=True, text=True
        )
    else:
        os.unlink(alias)


def test_check_script_dereferences_an_aliased_scripts_directory(tmp_path: Path) -> None:
    """A directory alias at ``scripts`` must not redirect the repo root.

    ``$PSScriptRoot`` is never dereferenced by PowerShell itself: an alias at
    ``foreign/scripts`` pointing at this repo's real ``scripts/`` used to
    leave ``$repoRoot`` at the alias, so every gate ran inside the empty
    ``foreign/`` tree and the run still exited 0 -- certifying neither tree.
    Creating one needs no admin/Developer-Mode privilege on either platform
    (a junction on Windows, a directory symlink on POSIX -- see
    ``_alias_directory``), so this is reachable by an unprivileged operator or
    process. The fix must resolve the alias back to the real repo before any
    gate runs.
    """

    pwsh = shutil.which("pwsh")
    assert pwsh, "pwsh is required to exercise scripts/check.ps1 (installed on GitHub runners)"

    stubs = tmp_path / "stubs"
    stubs.mkdir()
    _write_stub(stubs, "uv", "[stub uv]")
    _write_stub(stubs, "npm", "[stub npm]")

    foreign = tmp_path / "foreign"
    (foreign / "web").mkdir(parents=True)
    alias = foreign / "scripts"
    real_scripts = ROOT / "scripts"

    _alias_directory(alias, real_scripts)
    try:
        env = dict(os.environ, PATH=os.pathsep.join([str(stubs), os.environ.get("PATH", "")]))
        run = subprocess.run(
            [pwsh, "-NoProfile", "-File", str(alias / "check.ps1")],
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
                f"{program} {args!r} ran in the aliased foreign tree, not the real repo"
            )

        announced = re.search(r"^check\.ps1: running every gate in (.+)$", run.stdout, re.MULTILINE)
        assert announced, run.stdout
        assert _same_dir(announced.group(1).strip(), ROOT), (
            "check.ps1 announced the alias's foreign tree instead of the real repo"
        )
    finally:
        _unalias_directory(alias)
        assert not alias.exists(), "the alias must be removed after the test"
        assert (real_scripts / "check.ps1").exists(), (
            "removing the alias must not have touched the real scripts/ directory"
        )


def _stub_path(tmp_path: Path) -> dict[str, str]:
    """An environment whose ``uv`` and ``npm`` are the printing stubs."""

    stubs = tmp_path / "stubs"
    stubs.mkdir(exist_ok=True)
    _write_stub(stubs, "uv", "[stub uv]")
    _write_stub(stubs, "npm", "[stub npm]")
    return dict(os.environ, PATH=os.pathsep.join([str(stubs), os.environ.get("PATH", "")]))


def _run_check_script(
    script: Path, cwd: Path, env: dict[str, str]
) -> subprocess.CompletedProcess[str]:
    pwsh = shutil.which("pwsh")
    assert pwsh, "pwsh is required to exercise scripts/check.ps1 (installed on GitHub runners)"
    return subprocess.run(
        [pwsh, "-NoProfile", "-File", str(script)],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def test_check_script_refuses_a_hard_link_even_with_both_repo_markers(tmp_path: Path) -> None:
    """The reproduced bypass: a hard link plus two EMPTY marker files.

    A hard link is a second directory entry for the same file record -- no
    reparse point to dereference, and nothing in the file that says which entry
    came first. The identity check that was supposed to catch it was
    ``Test-Path`` on ``.git`` and ``pyproject.toml``, and two files created
    empty satisfied both: the script announced the foreign root, ran all six
    ``uv`` gates and both ``npm`` gates there, and exited 0 (measured). So the
    markers are created here, empty, exactly as the bypass did -- a version of
    this test without them passes against a script that still has the hole.

    The refusal is deliberately blunt, and its cost is real: Windows reports
    ``LinkType`` ``HardLink`` on *every* entry once a second one exists, so
    while this test's link is alive the repo's own ``scripts/check.ps1``
    refuses too. That is the fail-closed direction, and it is why the link is
    removed in a ``finally``.
    """

    foreign = tmp_path / "foreign2"
    (foreign / "scripts").mkdir(parents=True)
    (foreign / "web").mkdir()
    # The bypass, verbatim: both markers present, both empty.
    (foreign / ".git").write_text("", encoding="ascii")
    (foreign / "pyproject.toml").write_text("", encoding="ascii")

    linked_script = foreign / "scripts" / "check.ps1"
    os.link(CHECK_SCRIPT, linked_script)
    try:
        run = _run_check_script(linked_script, foreign, _stub_path(tmp_path))
        assert run.returncode != 0, (
            "a hard-linked check.ps1 in a directory carrying empty .git and pyproject.toml "
            f"markers must fail, not exit 0:\n{run.stdout + run.stderr}"
        )
        assert "[stub" not in run.stdout, (
            f"a gate ran against the foreign hard-linked tree before the script refused:\n{run.stdout}"
        )
        assert "hard link" in run.stderr, (
            f"the refusal must say what it refused and why:\n{run.stderr}"
        )
    finally:
        # A hard link is a second directory entry for the real file's inode:
        # unlinking it here only decrements the link count, it never touches
        # the real scripts/check.ps1 (pytest's own tmp_path cleanup is lazy
        # and cross-session, so leaving this to it would pile up extra hard
        # links on the real file across repeated runs -- and each of them
        # would keep the real script refusing to run).
        linked_script.unlink()
        assert CHECK_SCRIPT.exists(), (
            "unlinking the foreign hard link must not remove the real check.ps1"
        )


def test_check_script_refuses_a_copy_in_a_foreign_tree_that_is_not_a_checkout(
    tmp_path: Path,
) -> None:
    """The same bypass without the hard link: a plain copy plus empty markers.

    Nothing stops anyone copying this script into another directory, and a copy
    legitimately resolves to the tree it was copied into -- which is why the
    identity check, not the link resolution, is what has to refuse here. Two
    empty files satisfied the old one. ``git rev-parse`` does not: an empty
    ``.git`` is ``fatal: invalid gitfile format``.
    """

    foreign = tmp_path / "copied"
    (foreign / "scripts").mkdir(parents=True)
    (foreign / "web").mkdir()
    (foreign / ".git").write_text("", encoding="ascii")
    (foreign / "pyproject.toml").write_text("", encoding="ascii")
    copied = foreign / "scripts" / "check.ps1"
    shutil.copy2(CHECK_SCRIPT, copied)

    run = _run_check_script(copied, foreign, _stub_path(tmp_path))
    assert run.returncode != 0, (
        f"a copy of check.ps1 in a tree that is not a checkout must fail:\n{run.stdout + run.stderr}"
    )
    assert "[stub" not in run.stdout, f"a gate ran in the foreign tree:\n{run.stdout}"


def test_check_script_refuses_a_real_git_repo_that_is_not_this_project(tmp_path: Path) -> None:
    """``git init`` is cheap, so git alone cannot be the whole identity proof.

    ``git rev-parse --show-toplevel`` answers for *any* checkout. This is the
    second half: ``pyproject.toml`` must declare this project. It is a content
    check rather than a ``Test-Path`` precisely because an empty file is what
    defeated the previous one -- and an empty file very nearly defeated this
    one too, because ``Get-Content -Raw`` returns ``$null`` for it and
    ``$null -notmatch ...`` evaluates to ``$null``, not ``$true`` (measured:
    exit 0, all eight gates run in this temporary repository, before the cast
    that fixes it).
    """

    foreign = tmp_path / "otherproject"
    (foreign / "scripts").mkdir(parents=True)
    (foreign / "web").mkdir()
    (foreign / "pyproject.toml").write_text("", encoding="ascii")
    copied = foreign / "scripts" / "check.ps1"
    shutil.copy2(CHECK_SCRIPT, copied)
    subprocess.run(["git", "init", "-q", str(foreign)], check=True, capture_output=True)

    run = _run_check_script(copied, foreign, _stub_path(tmp_path))
    assert run.returncode != 0, (
        "a real git checkout whose pyproject.toml does not declare this project must fail:\n"
        f"{run.stdout + run.stderr}"
    )
    assert "[stub" not in run.stdout, f"a gate ran in the foreign checkout:\n{run.stdout}"
    assert "QuViz" in run.stderr, f"the refusal must name what it looked for:\n{run.stderr}"


def test_check_script_follows_a_file_symlink_to_its_real_repo(tmp_path: Path) -> None:
    """A file symlink at ``scripts/check.ps1`` must resolve back to this repo.

    The aliased-directory test above covers a reparse point on the
    *directory*. This is the reparse point on the *file*, which
    asking ``$PSScriptRoot`` never sees
    at all: the directory is a perfectly ordinary directory, and only the file
    inside it is a link. Unlike a hard link there is a target to follow, so the
    script must follow it and run the full gate against the real checkout --
    refusing would be a false red on a legitimate way to install a script.

    On POSIX a symlink always creates, so a refusal there is a real failure and
    is raised as one. On Windows creating a *file* symlink needs
    ``SeCreateSymbolicLinkPrivilege`` -- an elevated process, or Developer Mode
    -- while creating a junction needs nothing, which is why the
    aliased-directory test above is the unprivileged Windows case and this one
    is not. That asymmetry is already the stated reasoning there, and it is a threat
    statement as much as a convenience one: on Windows an actor who can plant a
    file symlink is already elevated, and an elevated actor can simply edit this
    script.

    So where Windows refuses, this warns loudly and falls back to asserting
    that the file-side resolution is still WIRED, rather than either failing the
    whole gate for an OS privilege or passing as though the case had run. Note
    what that fallback does and does not buy: the end-to-end proof is the run
    above, and on a machine that warns, only CI (and any POSIX checkout) has
    actually made it. Do not read a green run on such a machine as evidence
    that a symlinked script resolves correctly.
    """

    foreign = tmp_path / "symlinked"
    (foreign / "scripts").mkdir(parents=True)
    (foreign / "web").mkdir()
    link = foreign / "scripts" / "check.ps1"
    try:
        os.symlink(CHECK_SCRIPT, link)
    except OSError as exc:  # pragma: no cover - environment-dependent
        if sys.platform != "win32":
            raise
        text = CHECK_SCRIPT.read_text(encoding="utf-8")
        warnings.warn(
            "the symlinked-script case was NOT exercised: this Windows machine cannot create a "
            "file symlink (needs an elevated process or Developer Mode -- Settings > System > "
            f"For developers). Underlying error: {exc}. Only the static wiring below was checked; "
            "the end-to-end resolution is proved on POSIX and in CI.",
            stacklevel=1,
        )
        assert _RESOLVE_SCRIPT_FILE.search(text), (
            "check.ps1 must resolve $PSCommandPath through Resolve-FinalTarget -- and this "
            "machine could not create the symlink that proves it end to end"
        )
        assert _RESOLVE_SCRIPT_DIR.search(text), (
            "check.ps1 must resolve the resolved script's directory too -- and this machine "
            "could not create the symlink that proves it end to end"
        )
        return

    run = _run_check_script(link, foreign, _stub_path(tmp_path))
    assert run.returncode == 0, run.stdout + run.stderr

    steps = re.findall(r"^\[stub (uv|npm)\] cwd=(.+?) args=(.*)$", run.stdout, re.MULTILINE)
    programs = [program for program, _, _ in steps]
    assert programs == ["uv"] * 6 + ["npm"] * 2, run.stdout
    for program, cwd, args in steps:
        expected = ROOT if program == "uv" else ROOT / "web"
        assert _same_dir(cwd, expected), f"{program} {args!r} ran in {cwd}, not {expected}"
        assert not _same_dir(cwd, foreign), (
            f"{program} {args!r} ran in the symlinked foreign tree, not the real repo"
        )

    announced = re.search(r"^check\.ps1: running every gate in (.+)$", run.stdout, re.MULTILINE)
    assert announced, run.stdout
    assert _same_dir(announced.group(1).strip(), ROOT), (
        "check.ps1 announced the symlink's foreign tree instead of the real repo"
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


# --- ci.yml web job ---------------------------------------------------------

#: ``on:`` parses to the YAML 1.1 boolean ``True``, not to the string "on".
_ON_KEY = True

#: The front-end gates, in the order CI must run them. ``npm run test`` is the
#: whole chain ``NPM_TEST_STAGES`` pins; ``npm run build`` is what proves the
#: bundle -- which no test imports -- still compiles.
WEB_JOB_COMMANDS = ("npm run test", "npm run build")

#: The one install the ``web`` job may run: the lockfile, exactly, with no
#: fallback branch that resolves a fresh tree when the lockfile is missing.
WEB_INSTALL_COMMAND = "npm ci --no-audit --no-fund"


def _workflow() -> dict[object, object]:
    parsed = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(parsed, dict), "ci.yml does not parse as a mapping"
    return parsed


def _web_job() -> dict[str, object]:
    """The ``web`` job, or a failure that says the front-end gates are gone.

    Every other assertion in this group goes through here, so deleting the job
    fails all of them with this message rather than with a ``KeyError``.
    """

    jobs = _workflow().get("jobs")
    assert isinstance(jobs, dict), "ci.yml declares no jobs"
    assert "web" in jobs, (
        "ci.yml has no `web` job: nothing in CI runs `npm run test` or `npm run build`, so every "
        "front-end gate -- the pinned test chain, both coverage verifiers, the guard spec and the "
        "production build -- is absent from CI while the workflow still reports green. Deleting "
        f"the job left every test in this file passing (measured). Jobs found: {sorted(jobs)}"
    )
    job = jobs["web"]
    assert isinstance(job, dict), "ci.yml's `web` job is not a mapping"
    return job


def _web_steps() -> list[dict[str, object]]:
    steps = _web_job().get("steps")
    assert isinstance(steps, list) and steps, "ci.yml's `web` job has no steps"
    for step in steps:
        assert isinstance(step, dict), f"ci.yml's `web` job has a non-mapping step: {step!r}"
    return steps


def test_ci_runs_on_push_and_pull_request() -> None:
    """Both triggers, or the gates below run on neither event that matters.

    This repository merges by fast-forward push, so ``push`` is not redundant
    with ``pull_request``: dropping it would leave every merge to master
    unchecked while pull requests still went green.
    """

    triggers = _workflow().get(_ON_KEY)
    assert isinstance(triggers, dict), (
        "ci.yml declares no `on:` mapping, so nothing says when this workflow runs"
    )
    for event in ("push", "pull_request"):
        assert event in triggers, (
            f"ci.yml no longer runs on `{event}`; this repository merges by fast-forward push, so "
            f"both events must trigger CI. Triggers found: {sorted(map(str, triggers))}"
        )


def test_ci_web_job_runs_every_step_inside_web() -> None:
    """``working-directory: web`` is what makes the npm steps mean anything.

    Without it ``npm run test`` runs at the repository root, where there is no
    ``package.json`` with a ``test`` script -- and a job that fails for that
    reason is a job somebody will "fix" by deleting it.
    """

    job = _web_job()
    defaults = job.get("defaults")
    assert isinstance(defaults, dict), (
        "ci.yml's `web` job declares no `defaults:`; every npm step would run at the repository "
        "root instead of in web/"
    )
    run_defaults = defaults.get("run")
    assert isinstance(run_defaults, dict), "ci.yml's `web` job declares no `defaults.run:`"
    assert run_defaults.get("working-directory") == "web", (
        "ci.yml's `web` job must set `defaults.run.working-directory: web`; found "
        f"{run_defaults.get('working-directory')!r}"
    )


def test_ci_web_job_sets_up_node_and_installs_with_npm_ci() -> None:
    """A Node toolchain, and a lockfile-faithful install with no way around it.

    ``npm ci`` installs exactly ``package-lock.json``; ``npm install`` is free
    to resolve something else, which would let CI test a dependency tree no
    checkout has. The step used to read ``if [ -f package-lock.json ]; then npm
    ci ...; else npm install ...; fi``, which makes a *missing* lockfile a
    silent fresh resolution rather than a failure -- the one case where the
    difference between the two commands matters, handled by taking the branch
    that cannot be reproduced. So what is pinned here is stronger than "``npm
    ci`` appears somewhere": the install step must be exactly ``npm ci``, and
    the word ``npm install`` must not appear in the job at all.
    """

    steps = _web_steps()
    uses = [str(step.get("uses", "")) for step in steps]
    assert any(u.startswith("actions/setup-node@") for u in uses), (
        "ci.yml's `web` job has no actions/setup-node step, so the job runs on whatever Node the "
        f"runner image happens to ship. Steps used: {uses}"
    )
    assert any(u.startswith("actions/checkout@") for u in uses), (
        f"ci.yml's `web` job never checks the repository out. Steps used: {uses}"
    )
    runs = [" ".join(str(step.get("run", "")).split()) for step in steps]
    assert WEB_INSTALL_COMMAND in runs, (
        f"ci.yml's `web` job never runs `{WEB_INSTALL_COMMAND}` as a step of its own; an "
        "`npm install`, or an `npm ci` guarded by a fallback to one, can resolve a dependency "
        f"tree package-lock.json does not describe. Steps run: {runs}"
    )
    scripts = "\n".join(runs)
    assert "npm install" not in scripts, (
        "ci.yml's `web` job still mentions `npm install`; a missing package-lock.json must fail "
        f"the job, not be resolved fresh. Steps run:\n{scripts}"
    )


def test_ci_web_job_runs_the_front_end_gates_in_order() -> None:
    """``npm run test`` then ``npm run build``, both present, in that order.

    The whole job could be deleted and every test in this file still passed
    (measured), which is the hole this closes. Order matters for the reason it
    matters locally in ``check.ps1``: a build that succeeds says nothing about
    a suite that was never run, and running the build first would let a failing
    build mask which gate actually broke.
    """

    runs = [" ".join(str(step.get("run", "")).split()) for step in _web_steps()]
    positions = {}
    for command in WEB_JOB_COMMANDS:
        matched = [index for index, script in enumerate(runs) if script == command]
        assert matched, (
            f"ci.yml's `web` job never runs `{command}` as a step of its own. Steps run: {runs}"
        )
        positions[command] = matched[0]
    ordered = [positions[command] for command in WEB_JOB_COMMANDS]
    assert ordered == sorted(ordered), (
        "ci.yml's `web` job must run "
        + " then ".join(f"`{command}`" for command in WEB_JOB_COMMANDS)
        + f", in that order; found them at step indices {ordered}"
    )


def test_no_step_of_the_web_job_can_be_skipped() -> None:
    """No ``if:`` and no ``continue-on-error:``, on the job or on any step.

    Either one turns the job green without running -- or without honouring --
    the gates, which is the same outcome as deleting it but harder to see in a
    diff. The ``changed-links`` job is held to the same rule above.
    """

    job = _web_job()
    for escape in ("if", "continue-on-error"):
        assert escape not in job, (
            f"ci.yml's `web` job carries `{escape}: {job[escape]!r}`; the front-end gates must "
            "not be conditional or advisory"
        )
        for index, step in enumerate(_web_steps()):
            assert escape not in step, (
                f"step {index} of ci.yml's `web` job carries `{escape}: {step[escape]!r}`; a "
                f"skipped or advisory step is a gate that is not enforced: {step!r}"
            )


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

    The resolved-config capture catches those overrides
    (``coverage/resolved-coverage.json`` records what vitest resolved, and
    ``scripts/assert-coverage-scope.mjs`` deep-equals it against
    ``coverage-scope.json``) -- with one exception it cannot catch, because the
    capture is written from a config object the provider itself returned: a
    custom provider that reports ``provider: 'v8'`` out of ``resolveOptions()``
    hands the capture module a clean-looking config while instrumenting
    nothing. This assertion is the cheap outer layer: the invocation itself
    carries no coverage configuration at all, so there is only one place that
    configuration can come from.
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
    exit 0, every test in this file passing, the whole of ``check.ps1`` at exit
    0, with an uncovered exported function shipping in a gated module.

    Nothing in the same trust domain can see that: the evidence and every
    reader of it are one mutable, equally-privileged checkout, so whoever can
    write the provider can write what the readers read (see the boundary note
    atop ``web/scripts/assert-coverage-scope.mjs``). What this does is put a price
    on the cheapest wiring: a ``plugins`` array spelled out in this file has to
    be added to this file, and this assertion turns that into a red build.

    It is not a wall, and the limit is the pattern's reach -- it reads this
    file's own text and nothing else. Spread the array in from an imported
    module and there is nothing here to match: measured on this tree, that
    took the whole of ``check.ps1`` to exit 0 with a forged coverage report,
    this assertion silent. ``test_vitest_config_imports_exactly_these_modules``
    below closes that spelling. The two together bound the wirings that are
    known, not the attack.

    If a plugin is ever genuinely needed, pin the array here the way
    ``globalSetup`` is pinned in ``web/src/guards.test.ts``.
    """

    source = WEB_VITEST_CONFIG.read_text(encoding="utf-8")
    found = _VITEST_PLUGINS_KEY.search(source)
    assert not found, (
        "web/vitest.config.ts declares a `plugins` key: "
        f"{source[max(0, found.start() - 40) : found.end() + 40]!r}. A plugin's config() hook "
        "rewrites the config vitest resolves without touching any source the front-end guards "
        "read -- including coverage.provider, which decides who writes the coverage report."
    )


#: Every module ``web/vitest.config.ts`` may pull in, in source order.
WEB_VITEST_CONFIG_IMPORTS = ("vitest/config",)

#: A string literal or a comment, matched by ONE pattern so that whichever
#: opens first wins: ``//`` inside a string is not a comment, and an
#: apostrophe inside a comment does not open a string.
_TS_STRING_OR_COMMENT = re.compile(
    r"(?P<string>'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`)"
    r"|(?P<comment>//[^\n]*|/\*.*?\*/)",
    re.DOTALL,
)

#: Every spelling that pulls another module in: ``import ... from`` and
#: ``export ... from``, a bare side-effect ``import 'x'``, a dynamic
#: ``import('x')``, and ``require('x')``. The clause between the keyword and
#: ``from`` may span lines but may hold no quote, paren or semicolon, so it
#: cannot run past the end of its own statement into the next one's specifier.
_TS_MODULE_SPECIFIER = re.compile(
    r"\b(?:import|export)\b[^'\"();]*?\bfrom\s*['\"]([^'\"]+)['\"]"
    r"|\bimport\s*['\"]([^'\"]+)['\"]"
    r"|\b(?:import|require)\s*\(\s*['\"]([^'\"]+)['\"]"
)

#: What must not survive once every import above has been accounted for.
_TS_MODULE_KEYWORD = re.compile(r"\b(?:import|require|from)\b")


def _blank(match: re.Match[str]) -> str:
    """``match`` replaced by spaces, so every other offset stays put."""
    return " " * len(match.group(0))


def test_vitest_config_imports_exactly_these_modules() -> None:
    """The module list is pinned, because a key can be moved behind an import.

    ``test_vitest_config_declares_no_plugins`` reads this file's own text, so
    it only sees a ``plugins`` key spelled *here*. Spread the array in from
    somewhere else and it has nothing to match::

        import { shared } from './base.config'
        export default defineConfig({ ...shared, test: { ... } })

    Two added lines, both well-typed. Measured on this tree: with the fake
    provider parked outside ``web/scripts/`` as well, that diff took the whole
    of ``check.ps1`` to exit 0 with a forged ``coverage-final.json`` certified
    by all three gate lines and every test in this file passing. So the two
    pins beside this one bound the cheapest spellings, not the attack.

    This pin closes that spelling: ``vitest.config.ts`` imports exactly one
    module today, and any other one -- static, bare, dynamic or ``require`` --
    has to arrive as a reviewed edit to the tuple above. It closes ONE MORE
    WIRING SPELLING and nothing more. A provider wired in by any means still
    writes the report the rest of the run is scored against, and no pin from
    out here changes that; see the boundary note atop
    ``web/scripts/assert-coverage-scope.mjs``.

    Fail-closed on its own reading, too: after the imports it recognises are
    blanked out, no ``import`` / ``require`` / ``from`` may remain outside a
    string or comment. A spelling the pattern above cannot read therefore
    fails this test instead of passing it silently.
    """

    source = _TS_STRING_OR_COMMENT.sub(
        lambda match: _blank(match) if match.group("comment") else match.group(0),
        WEB_VITEST_CONFIG.read_text(encoding="utf-8"),
    )

    found: list[str] = []
    residue = list(source)
    for match in _TS_MODULE_SPECIFIER.finditer(source):
        specifier = match.group(1) or match.group(2) or match.group(3)
        found.append(specifier)
        residue[match.start() : match.end()] = [" "] * (match.end() - match.start())

    assert tuple(found) == WEB_VITEST_CONFIG_IMPORTS, (
        "web/vitest.config.ts no longer imports exactly the pinned modules. Moving any part of "
        "this config behind an import puts it where no assertion over this file's text can see "
        "it -- which is how a `plugins` array carrying a coverage provider gets in without "
        f"tripping the no-plugins pin.\n  found:    {tuple(found)}\n"
        f"  expected: {WEB_VITEST_CONFIG_IMPORTS}"
    )

    leftover = _TS_MODULE_KEYWORD.search(
        _TS_STRING_OR_COMMENT.sub(_blank, "".join(residue)),
    )
    assert not leftover, (
        f"web/vitest.config.ts contains {leftover.group(0)!r} outside a string or comment that "
        "the import pattern above did not read as one of the pinned imports. That is a way of "
        "pulling in a module this test cannot account for, so it fails rather than passing by "
        "not matching: teach _TS_MODULE_SPECIFIER the spelling, in a reviewed commit."
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

    What this closes, exactly: DELETING the file, EMPTYING it, and replacing it
    with a placeholder that does not carry the anchor strings below. What it
    does NOT close: a placeholder that keeps them. The check is a substring
    search, so a file containing these names -- as ``describe`` blocks with
    empty bodies, or even in a comment -- passes it while asserting nothing.
    Read this as a tripwire on the cheap ways to remove the guard, not as a
    guarantee that the guard still works; what proves the assertions are still
    real is that they still go red, which is the business of the whole suite
    rather than of this one test.
    """

    assert WEB_GUARD_SPEC.is_file(), (
        "web/src/guards.test.ts is gone; nothing else reads vitest.config.ts, scans committed "
        "sources for skip modifiers or coverage pragmas, or holds the coverage derivation to "
        "coverage-scope.json"
    )
    source = WEB_GUARD_SPEC.read_text(encoding="utf-8")
    missing = [name for name in GUARD_SPEC_CONTENTS if name not in source]
    assert not missing, (
        f"web/src/guards.test.ts no longer contains {missing}; deleting the file, emptying it, or "
        "swapping in a placeholder that drops these names all pass a bare existence check while "
        "disabling every guard in it. (A placeholder that KEEPS these names passes this check "
        "too -- it is a substring search, not a proof that the assertions still run.)"
    )
