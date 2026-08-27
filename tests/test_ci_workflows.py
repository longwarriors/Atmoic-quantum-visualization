"""Pins on what the GitHub Actions workflows *declare*, as opposed to what they run.

``tests/test_check_script.py`` executes the interesting shell out of ``ci.yml``
(the ``changed-links`` base resolution and probe steps) against throwaway
repositories. This module is the complementary half: the properties of the
workflow files that no execution can reveal, because they are about the
environment the run is given rather than the commands inside it.

Three of them, each with its own way of going quietly wrong:

**Installs must come from the lockfile, unconditionally.** Every install step
used to read ``if [ -f uv.lock ]; then uv sync --locked ...; else uv sync ...;
fi`` (and the ``npm ci`` / ``npm install`` equivalent). Read as a diff that
line looks like belt-and-braces; read as a gate it is the opposite. The
fallback fires in exactly the situation the ``--locked`` flag exists to catch
-- the lockfile is missing, or was not committed -- and answers it by
resolving a dependency tree no checkout has and reporting green. A missing
lockfile has to fail. Since the conditional forms are what regress back in,
the pin is written as an absolute: no ``run:`` script in any workflow may
contain a ``uv sync`` without ``--locked``, or the string ``npm install``.

**The Python versions CI runs must be exactly the ones ``pyproject.toml``
claims.** ``requires-python`` and the ``Programming Language :: Python :: 3.x``
classifiers are a promise to anyone installing this package; a CI matrix is the
only thing that makes the promise true. They drifted immediately: the project
declared 3.12 and 3.13 while CI built on 3.12 alone, so 3.13 was supported in
the metadata and untested everywhere else. The gate is symmetric on purpose --
it reads both sides and compares sets, so adding a classifier without adding
the matrix entry is as red as dropping the matrix entry while the classifier
stands. Neither side is the source of truth; agreeing is.

**``link-check.yml`` must still exist, and still be weekly.** Nothing in this
repository referenced that file before this module: deleting it, or its job, or
its schedule, left every test green while the citation-rot sweep it exists to
run silently stopped happening -- and a sweep that stops happening looks
exactly like a sweep that finds nothing. It is deliberately not part of CI (rot
is not caused by the commit under review, so it must not block a pull request),
which is precisely why nothing else would notice its absence.

Each pin's predicate is a module-level function over a parsed workflow, so the
negative controls below can feed it a synthetic sabotaged workflow and require
it to object -- the gate is shown failing on the bad input in the same run that
shows it passing on the real files, rather than being trusted to.

The sibling of this module is ``tests/test_declared_versions.py``, which holds
the same kind of invariant for Node.js: the version the documentation promises
must be the version ``web/package.json`` enforces.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
CI_WORKFLOW = WORKFLOWS / "ci.yml"
LINK_CHECK_WORKFLOW = WORKFLOWS / "link-check.yml"
PYPROJECT = ROOT / "pyproject.toml"

#: ``on:`` parses to the YAML 1.1 boolean ``True``, not to the string "on".
_ON_KEY = True

#: The job that runs the Python gates, and so the job whose Python versions
#: are the ones this project can claim to support.
PYTHON_JOB = "python-docs"

#: The install every Python job must run, spelled exactly.
LOCKED_UV_SYNC = "uv sync --locked --all-groups"

#: A ``uv sync`` invocation and the rest of its command line, so the pin can
#: ask whether *that* invocation carried ``--locked`` rather than whether the
#: flag appears anywhere in the script.
_UV_SYNC = re.compile(r"uv\s+sync\b(?P<flags>[^\n;&|]*)")

#: ``${{ matrix.python-version }}`` and friends: a step input that defers to
#: the job's matrix instead of naming a version itself.
_MATRIX_REF = re.compile(r"^\$\{\{\s*matrix\.(?P<key>[A-Za-z0-9_-]+)\s*\}\}$")

#: One clause of ``requires-python``. Only the two shapes this project uses are
#: read; anything else is reported rather than guessed at.
_REQUIRES_PYTHON_CLAUSE = re.compile(r"^\s*(?P<op>>=|<)\s*3\.(?P<minor>\d+)\s*$")

_CLASSIFIER = re.compile(r"^Programming Language :: Python :: 3\.(?P<minor>\d+)$")


# --- reading the workflows --------------------------------------------------


def _workflow(path: Path) -> dict[str, Any]:
    assert path.is_file(), (
        f"{path} does not exist. It is a gate of its own: nothing else in this repository runs "
        "what it runs, so deleting it removes the check rather than moving it."
    )
    parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert isinstance(parsed, dict), f"{path} does not parse as a mapping"
    return parsed


def _jobs(workflow: dict[str, Any], label: str) -> dict[str, Any]:
    jobs = workflow.get("jobs")
    assert isinstance(jobs, dict) and jobs, f"{label} declares no jobs"
    for name, job in jobs.items():
        assert isinstance(job, dict), f"{label}'s `{name}` job is not a mapping"
    return jobs


def _steps(job: dict[str, Any], label: str) -> list[dict[str, Any]]:
    steps = job.get("steps")
    assert isinstance(steps, list) and steps, f"{label} has no steps"
    for step in steps:
        assert isinstance(step, dict), f"{label} has a non-mapping step: {step!r}"
    return steps


def _run_scripts(workflow: dict[str, Any], label: str) -> list[tuple[str, str]]:
    """``(job name, script)`` for every ``run:`` step in the workflow."""

    scripts: list[tuple[str, str]] = []
    for name, job in _jobs(workflow, label).items():
        for step in _steps(job, f"{label}'s `{name}` job"):
            script = step.get("run")
            if script is not None:
                assert isinstance(script, str), f"{label}'s `{name}` job has a non-string `run:`"
                scripts.append((str(name), script))
    return scripts


def _workflow_files() -> list[Path]:
    files = sorted(p for p in WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
    assert files, f"{WORKFLOWS} holds no workflow files at all"
    return files


# --- predicate 1: every install is a locked install -------------------------


def unlocked_installs(workflow: dict[str, Any], label: str) -> list[str]:
    """Every install in ``workflow`` that can resolve a tree no lockfile pins.

    A ``uv sync`` without ``--locked``, or any ``npm install``, whether it
    stands alone or sits in the ``else`` branch of an ``if [ -f <lockfile> ]``
    fallback -- the fallback is the form that regresses, and its ``else`` arm
    is an unlocked install like any other.
    """

    offenders: list[str] = []
    for job, script in _run_scripts(workflow, label):
        for match in _UV_SYNC.finditer(script):
            if "--locked" not in match.group("flags"):
                offenders.append(f"{label} job `{job}`: `{match.group(0).strip()}` has no --locked")
        if "npm install" in script:
            offenders.append(f"{label} job `{job}`: `npm install` can resolve an unpinned tree")
        for lockfile in ("uv.lock", "package-lock.json"):
            if f"-f {lockfile}" in script:
                offenders.append(
                    f"{label} job `{job}`: tests for {lockfile} before installing, so a missing "
                    "lockfile takes a fallback branch instead of failing"
                )
    return offenders


def test_no_workflow_can_install_without_a_lockfile() -> None:
    """Across every workflow file, not just the ones a reviewer thinks of."""

    offenders: list[str] = []
    for path in _workflow_files():
        offenders += unlocked_installs(_workflow(path), path.name)
    assert not offenders, (
        "an install step can resolve dependencies the lockfile does not pin, which makes a "
        "missing or stale lockfile a green run instead of a red one:\n  " + "\n  ".join(offenders)
    )


def test_every_python_job_syncs_the_whole_locked_environment() -> None:
    """``uv sync --locked --all-groups``, spelled exactly, in every job that syncs.

    ``--all-groups`` is load-bearing next to ``--locked``: the citation gates
    import ``markdown``, which reaches the environment only through the
    ``docs`` group, and a sync that omits it fails collection rather than
    running the gates.
    """

    for path in _workflow_files():
        for job, script in _run_scripts(_workflow(path), path.name):
            for match in _UV_SYNC.finditer(script):
                invocation = " ".join(match.group(0).split())
                assert invocation == LOCKED_UV_SYNC, (
                    f"{path.name}'s `{job}` job runs `{invocation}`; every sync must be exactly "
                    f"`{LOCKED_UV_SYNC}`"
                )


@pytest.mark.parametrize(
    ("script", "reason"),
    [
        ("uv sync --all-groups", "a bare sync resolves whatever is newest today"),
        (
            "if [ -f uv.lock ]; then\n  uv sync --locked --all-groups\nelse\n"
            "  uv sync --all-groups\nfi",
            "the fallback fires exactly when --locked would have caught something",
        ),
        ("npm install --no-audit --no-fund", "npm install may resolve past package-lock.json"),
        (
            "if [ -f package-lock.json ]; then\n  npm ci --no-audit --no-fund\nelse\n"
            "  npm install --no-audit --no-fund\nfi",
            "the npm form of the same fallback",
        ),
    ],
)
def test_an_unlocked_install_is_rejected(script: str, reason: str) -> None:
    """Negative control: the predicate must object to each fallback shape."""

    sabotaged = {"jobs": {"build": {"steps": [{"name": "Sync", "run": script}]}}}
    assert unlocked_installs(sabotaged, "<synthetic>"), (
        f"the locked-install gate accepted an unlocked install ({reason}): {script!r}"
    )


def test_a_locked_install_is_accepted() -> None:
    """The complementary control: the pinned spelling must pass cleanly."""

    fine = {
        "jobs": {
            "build": {
                "steps": [
                    {"name": "Sync", "run": LOCKED_UV_SYNC},
                    {"name": "Install", "run": "npm ci --no-audit --no-fund"},
                ]
            }
        }
    }
    assert unlocked_installs(fine, "<synthetic>") == []


# --- predicate 2: CI's Python versions are the declared ones ----------------


def declared_python_versions() -> set[str]:
    """The 3.x versions ``pyproject.toml`` claims, from both places it says so.

    The classifiers are the list a reader sees on an index page;
    ``requires-python`` is what an installer enforces. They are cross-checked
    here before either is compared to CI, because a classifier list that
    disagrees with the bound it sits next to has already lost the meaning this
    gate is about to rely on.
    """

    metadata = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]

    classifiers = set()
    for classifier in metadata["classifiers"]:
        found = _CLASSIFIER.match(str(classifier))
        if found:
            classifiers.add(f"3.{found.group('minor')}")
    assert classifiers, (
        "pyproject.toml names no `Programming Language :: Python :: 3.x` classifier, so nothing "
        "declares which Python versions this project supports"
    )

    bounds: dict[str, int] = {}
    requires = str(metadata["requires-python"])
    for clause in requires.split(","):
        found = _REQUIRES_PYTHON_CLAUSE.match(clause)
        assert found is not None, (
            f"unsupported requires-python clause {clause!r} in {requires!r}; this gate reads only "
            "`>=3.x` and `<3.y`, so a wider range must be taught to it rather than pass unread"
        )
        bounds[found.group("op")] = int(found.group("minor"))
    assert set(bounds) == {">=", "<"}, (
        f"requires-python = {requires!r} must carry both a lower and an upper bound; without the "
        "upper bound the project claims every future Python, which no CI matrix can test"
    )

    spanned = {f"3.{minor}" for minor in range(bounds[">="], bounds["<"])}
    assert classifiers == spanned, (
        f"pyproject.toml's classifiers name {sorted(classifiers)} but requires-python = "
        f"{requires!r} spans {sorted(spanned)}; the two halves of the same declaration disagree"
    )
    return classifiers


def ci_python_versions(job: dict[str, Any], label: str) -> set[str]:
    """Every Python version ``job`` actually installs, matrix entries resolved."""

    strategy = job.get("strategy") or {}
    matrix = strategy.get("matrix") or {}
    assert isinstance(matrix, dict), f"{label} has a non-mapping `strategy.matrix`"

    versions: set[str] = set()
    for step in _steps(job, label):
        if not str(step.get("uses", "")).startswith("astral-sh/setup-uv@"):
            continue
        inputs = step.get("with") or {}
        assert isinstance(inputs, dict), f"{label}'s setup-uv step has a non-mapping `with:`"
        declared = inputs.get("python-version")
        assert declared is not None, (
            f"{label}'s setup-uv step names no `python-version`, so the job runs on whatever "
            "interpreter the runner image happens to ship and CI attests to no version at all"
        )
        reference = _MATRIX_REF.match(str(declared))
        if reference is None:
            versions.add(str(declared))
            continue
        key = reference.group("key")
        entries = matrix.get(key)
        assert isinstance(entries, list) and entries, (
            f"{label}'s setup-uv step reads `matrix.{key}`, which the job's strategy does not "
            f"define; matrix keys found: {sorted(matrix)}"
        )
        versions |= {str(entry) for entry in entries}
    assert versions, f"{label} never installs a Python at all"
    return versions


def _python_job() -> dict[str, Any]:
    jobs = _jobs(_workflow(CI_WORKFLOW), CI_WORKFLOW.name)
    assert PYTHON_JOB in jobs, (
        f"ci.yml has no `{PYTHON_JOB}` job: nothing in CI lints, type-checks, tests or builds the "
        f"documentation of the Python package, while the workflow still reports green. Jobs "
        f"found: {sorted(jobs)}"
    )
    return jobs[PYTHON_JOB]


def test_ci_has_a_python_job_that_runs_the_python_gates() -> None:
    """The job exists and still carries the gates, not just the name."""

    job = _python_job()
    label = f"ci.yml's `{PYTHON_JOB}` job"
    scripts = "\n".join(str(step.get("run", "")) for step in _steps(job, label))
    for gate in ("ruff check", "ruff format --check", "mypy", "pytest", "mkdocs build --strict"):
        assert gate in scripts, f"{label} no longer runs `{gate}`. Steps run:\n{scripts}"
    for escape in ("if", "continue-on-error"):
        assert escape not in job, (
            f"{label} carries `{escape}: {job[escape]!r}`; the Python gates must not be "
            "conditional or advisory"
        )
        for index, step in enumerate(_steps(job, label)):
            assert escape not in step, (
                f"step {index} of {label} carries `{escape}: {step[escape]!r}`; a skipped or "
                "advisory step is a gate that is not enforced"
            )


def test_ci_runs_exactly_the_python_versions_pyproject_declares() -> None:
    """The support claim and the thing that tests it, compared as sets.

    Red in both directions by construction: a classifier added without a
    matrix entry leaves a version claimed and untested, and a matrix entry
    removed while the classifier stands does the same. Fixing either one means
    touching both files, which is the point.
    """

    declared = declared_python_versions()
    tested = ci_python_versions(_python_job(), f"ci.yml's `{PYTHON_JOB}` job")
    assert tested == declared, (
        f"pyproject.toml declares support for Python {sorted(declared)} but ci.yml's "
        f"`{PYTHON_JOB}` job builds on {sorted(tested)}. Every declared version must be built, "
        "and no undeclared version may be the only one built: a version that appears in the "
        "metadata and in no CI run is a promise nothing keeps."
    )


@pytest.mark.parametrize(
    ("job", "reason"),
    [
        (
            {"steps": [{"uses": "astral-sh/setup-uv@v10.0.1", "with": {"python-version": "3.12"}}]},
            "a single pinned version cannot cover a two-version declaration",
        ),
        (
            {
                "strategy": {"matrix": {"python-version": ["3.12"]}},
                "steps": [
                    {
                        "uses": "astral-sh/setup-uv@v10.0.1",
                        "with": {"python-version": "${{ matrix.python-version }}"},
                    }
                ],
            },
            "a version dropped from the matrix while the classifier stands",
        ),
        (
            {
                "strategy": {"matrix": {"python-version": ["3.12", "3.13", "3.14"]}},
                "steps": [
                    {
                        "uses": "astral-sh/setup-uv@v10.0.1",
                        "with": {"python-version": "${{ matrix.python-version }}"},
                    }
                ],
            },
            "a version built but never declared",
        ),
    ],
)
def test_a_ci_matrix_that_disagrees_with_pyproject_is_rejected(
    job: dict[str, Any], reason: str
) -> None:
    """Negative control: the same comparison, run against a drifted job."""

    tested = ci_python_versions(job, "<synthetic>")
    assert tested != declared_python_versions(), (
        f"the version-consistency gate accepted a drifted matrix ({reason}): {sorted(tested)}"
    )


def test_a_job_with_no_python_version_is_rejected() -> None:
    """Negative control: an unpinned interpreter attests to nothing."""

    with pytest.raises(AssertionError, match="names no `python-version`"):
        ci_python_versions({"steps": [{"uses": "astral-sh/setup-uv@v10.0.1"}]}, "<synthetic>")


def test_every_setup_uv_step_shares_one_pinned_release() -> None:
    """One pinned tag across both workflows, never a floating ref.

    A moving ref (``@v10``, ``@main``) makes the toolchain a variable nothing
    in the repository records, and two different pins make the weekly sweep run
    on a uv the pull-request gates never used.
    """

    refs = set()
    for path in _workflow_files():
        for job in _jobs(_workflow(path), path.name).values():
            for step in _steps(job, path.name):
                uses = str(step.get("uses", ""))
                if uses.startswith("astral-sh/setup-uv@"):
                    refs.add(uses.split("@", 1)[1])
    assert len(refs) == 1, f"setup-uv is pinned to more than one ref across the workflows: {refs}"
    (ref,) = refs
    assert re.fullmatch(r"v\d+\.\d+\.\d+", ref), (
        f"setup-uv is used at `{ref}`, which is not an immutable release tag"
    )


# --- predicate 3: the weekly link sweep still exists ------------------------


def weekly_crons(workflow: dict[str, Any], label: str) -> list[str]:
    """Every ``cron:`` in ``workflow`` that fires on one weekday, weekly."""

    triggers = workflow.get(_ON_KEY)
    assert isinstance(triggers, dict), f"{label} declares no `on:` mapping"
    schedule = triggers.get("schedule")
    assert isinstance(schedule, list) and schedule, (
        f"{label} declares no `on.schedule:`, so the sweep it exists to run happens only when "
        "somebody remembers to press the button -- which is indistinguishable, in the log, from a "
        "sweep that ran and found nothing"
    )
    weekly: list[str] = []
    for entry in schedule:
        assert isinstance(entry, dict) and "cron" in entry, f"{label} has a scheduleless {entry!r}"
        fields = str(entry["cron"]).split()
        assert len(fields) == 5, f"{label} has a malformed cron {entry['cron']!r}"
        minute, hour, day_of_month, month, day_of_week = fields
        if day_of_week != "*" and day_of_month == "*" and month == "*":
            assert minute != "*" and hour != "*", (
                f"{label}'s cron {entry['cron']!r} fires every minute or every hour of that day"
            )
            weekly.append(str(entry["cron"]))
    return weekly


def test_link_check_workflow_runs_weekly_and_on_demand() -> None:
    """The sweep is scheduled, and can still be triggered by hand."""

    workflow = _workflow(LINK_CHECK_WORKFLOW)
    assert weekly_crons(workflow, LINK_CHECK_WORKFLOW.name), (
        "link-check.yml has no weekly cron; citation rot is found by the sweep running on its own "
        "or it is not found at all"
    )
    triggers = workflow.get(_ON_KEY)
    assert isinstance(triggers, dict) and "workflow_dispatch" in triggers, (
        "link-check.yml can no longer be run on demand, so a rot report cannot be reproduced "
        f"between Mondays. Triggers found: {sorted(map(str, triggers or {}))}"
    )


def test_link_check_workflow_still_probes_every_cited_link() -> None:
    """A job, a locked sync, and the sweep itself -- including DOIs."""

    workflow = _workflow(LINK_CHECK_WORKFLOW)
    jobs = _jobs(workflow, LINK_CHECK_WORKFLOW.name)
    scripts = "\n".join(script for _, script in _run_scripts(workflow, LINK_CHECK_WORKFLOW.name))
    assert LOCKED_UV_SYNC in scripts, (
        f"link-check.yml never runs `{LOCKED_UV_SYNC}`. Steps run:\n{scripts}"
    )
    assert re.search(r"check_links\.py\s+--include-doi", scripts), (
        "link-check.yml no longer sweeps every cited URL and DOI, which is the one thing it "
        f"exists to do and the one thing no pull-request gate does. Jobs: {sorted(jobs)}. Steps "
        f"run:\n{scripts}"
    )
    for name, job in jobs.items():
        label = f"link-check.yml's `{name}` job"
        for escape in ("if", "continue-on-error"):
            assert escape not in job, (
                f"{label} carries `{escape}: {job[escape]!r}`; a sweep that is advisory reports "
                "rot into a log nobody reads"
            )
            for index, step in enumerate(_steps(job, label)):
                assert escape not in step, (
                    f"step {index} of {label} carries `{escape}: {step[escape]!r}`"
                )


@pytest.mark.parametrize(
    ("schedule", "reason"),
    [
        ([{"cron": "17 4 * * *"}], "daily, not weekly"),
        ([{"cron": "17 * * * 1"}], "every hour of Monday"),
        ([{"cron": "17 4 1 * *"}], "monthly, on a day of the month"),
    ],
)
def test_a_schedule_that_is_not_weekly_is_rejected(
    schedule: list[dict[str, str]], reason: str
) -> None:
    """Negative control: only a genuine weekly cron counts as one."""

    sabotaged = {_ON_KEY: {"schedule": schedule}, "jobs": {"links": {"steps": [{"run": "true"}]}}}
    if reason == "every hour of Monday":
        with pytest.raises(AssertionError, match="every minute or every hour"):
            weekly_crons(sabotaged, "<synthetic>")
        return
    assert not weekly_crons(sabotaged, "<synthetic>"), (
        f"the schedule gate accepted a cron that is {reason}: {schedule!r}"
    )


def test_a_workflow_with_no_schedule_is_rejected() -> None:
    """Negative control: deleting the schedule must be an error, not an empty list."""

    with pytest.raises(AssertionError, match=re.escape("declares no `on.schedule:`")):
        weekly_crons({_ON_KEY: {"workflow_dispatch": None}, "jobs": {}}, "<synthetic>")


def test_a_missing_workflow_file_is_rejected() -> None:
    """Negative control: the deletion this module exists to catch."""

    with pytest.raises(AssertionError, match="does not exist"):
        _workflow(WORKFLOWS / "no-such-workflow.yml")
