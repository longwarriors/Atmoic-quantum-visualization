"""Declared setup commands and toolchain versions must match what is enforced.

``docs/getting-started/installation.md`` tells a reader which Node.js they
need; the manifest, lockfile, version-manager files, npm configuration and CI
jointly enforce that contract. When any pair drifts, the documentation can
instruct a reader to install a runtime that the locked dependency tree rejects.

The invariant is deliberately strict on numbers and loose on wording: the
prerequisite bullet may be phrased in any language, but the version numbers it
names must be exactly the lower bounds of the ``engines`` range, and the
smallest number it names must be the smallest version npm will accept.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
INSTALLATION_DOC = ROOT / "docs" / "getting-started" / "installation.md"
WEB_PACKAGE_JSON = ROOT / "web" / "package.json"
WEB_PACKAGE_LOCK = ROOT / "web" / "package-lock.json"
WEB_NPMRC = ROOT / "web" / ".npmrc"
NODE_VERSION = ROOT / ".node-version"
NVMRC = ROOT / ".nvmrc"
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

Version = tuple[int, int, int]

# A prerequisite bullet naming Node.js, in any wording: only the leading
# marker and the product name are fixed.
_DOC_NODE_BULLET = re.compile(r"^[-*]\s*Node\.js\b(?P<rest>.*)$", re.MULTILINE)

# ``major.minor`` with an optional ``patch``. A bare "20" is deliberately not a
# version here: the doc line this gate replaced said "Node.js 20+", and a
# pattern that accepted it would have had nothing to compare.
_VERSION = re.compile(r"(?<![\w.])(\d+)\.(\d+)(?:\.(\d+))?(?![\w.])")

# One clause of an npm range, e.g. ``^22.13.0`` or ``>=24.0.0``. Only operators
# whose lower bound is the version itself are accepted; anything else (``<``,
# ``*``, ``x`` ranges) is a range shape this gate has not been taught to read,
# and is reported rather than silently treated as a minimum.
_ENGINE_CLAUSE = re.compile(r"^\s*(?P<op>\^|~|>=|>|=)?\s*(?P<version>\d+\.\d+\.\d+)\s*$")


def _versions_in(text: str) -> list[Version]:
    return [
        (int(major), int(minor), int(patch or 0)) for major, minor, patch in _VERSION.findall(text)
    ]


def _documented_node_versions(markdown: str) -> list[Version]:
    """Every version number named on the Node.js prerequisite bullet."""

    bullets = _DOC_NODE_BULLET.findall(markdown)
    assert bullets, f"{INSTALLATION_DOC} has no Node.js prerequisite bullet to check"
    assert len(bullets) == 1, (
        f"{INSTALLATION_DOC} names Node.js on {len(bullets)} bullets; "
        "this gate compares exactly one prerequisite line"
    )
    return _versions_in(bullets[0])


def _engine_lower_bounds(engines_range: str) -> list[Version]:
    """The lower bound of every ``||`` alternative in an npm engines range."""

    bounds: list[Version] = []
    for clause in engines_range.split("||"):
        match = _ENGINE_CLAUSE.match(clause)
        assert match is not None, (
            f"unsupported engines clause {clause!r} in {engines_range!r}; "
            "this gate only reads clauses whose lower bound is the stated version"
        )
        major, minor, patch = match.group("version").split(".")
        bounds.append((int(major), int(minor), int(patch)))
    assert bounds, f"engines range {engines_range!r} has no clauses"
    return bounds


def _node_engines_range() -> str:
    manifest = json.loads(WEB_PACKAGE_JSON.read_text(encoding="utf-8"))
    engines = manifest.get("engines", {})
    node_range = engines.get("node")
    assert isinstance(node_range, str) and node_range.strip(), (
        f"{WEB_PACKAGE_JSON} declares no engines.node range for the doc to agree with"
    )
    return node_range


def _locked_node_engines(package: str) -> str:
    lock = json.loads(WEB_PACKAGE_LOCK.read_text(encoding="utf-8"))
    package_record = lock["packages"][package]
    node_range = package_record.get("engines", {}).get("node")
    assert isinstance(node_range, str) and node_range.strip(), (
        f"{WEB_PACKAGE_LOCK} package {package!r} declares no engines.node range"
    )
    return node_range


def test_installation_doc_node_version_matches_web_engines() -> None:
    """The documented Node.js prerequisite is the one npm enforces."""

    documented = _documented_node_versions(INSTALLATION_DOC.read_text(encoding="utf-8"))
    enforced = _engine_lower_bounds(_node_engines_range())

    assert documented, (
        "the Node.js prerequisite names no major.minor version; "
        f"web/package.json enforces engines.node = {_node_engines_range()!r}"
    )
    assert min(documented)[:2] == min(enforced)[:2], (
        f"docs say the minimum Node.js is {min(documented)}, "
        f"but web/package.json accepts nothing below {min(enforced)}"
    )
    assert set(documented) == set(enforced), (
        f"docs name Node.js versions {sorted(documented)}, "
        f"but the engines range's lower bounds are {sorted(enforced)}"
    )


def test_manifest_accepts_exactly_the_locked_jsdom_node_lines() -> None:
    """The app must not claim support below the strictest locked dependency."""

    declared = _node_engines_range()
    assert _locked_node_engines("") == declared
    assert _locked_node_engines("node_modules/jsdom") == declared


def test_node_version_files_and_ci_pin_the_lowest_supported_runtime() -> None:
    """Local version managers and every front-end CI job use one exact baseline."""

    minimum = ".".join(str(part) for part in min(_engine_lower_bounds(_node_engines_range())))
    assert NODE_VERSION.read_text(encoding="utf-8").strip() == minimum
    assert NVMRC.read_text(encoding="utf-8").strip() == minimum

    workflow = CI_WORKFLOW.read_text(encoding="utf-8")
    ci_versions = re.findall(r'^\s*node-version:\s*["\']?([^"\'\s]+)', workflow, re.MULTILINE)
    assert len(ci_versions) == 3, (
        "the three web, full-stack and visual setup-node steps must each pin a runtime"
    )
    assert set(ci_versions) == {minimum}


def test_npm_rejects_unsupported_node_instead_of_only_warning() -> None:
    settings = {
        line.strip()
        for line in WEB_NPMRC.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith(("#", ";"))
    }
    assert "engine-strict=true" in settings


def test_readme_setup_is_copyable_from_the_repository_root() -> None:
    """The primary path builds and serves one app without hidden cwd changes."""

    readme = README.read_text(encoding="utf-8")
    required = (
        "uv sync --locked --all-groups",
        "npm --prefix web ci --no-audit --no-fund",
        "npm --prefix web run build",
        "uv run --locked --no-sync quviz serve",
        "npm --prefix web run dev",
        "http://127.0.0.1:8000/openapi.json",
    )
    for command_or_url in required:
        assert command_or_url in readme
    assert "\ncd web" not in readme
    assert readme.index("npm --prefix web run build") < readme.index(
        "uv run --locked --no-sync quviz serve"
    )

    generator_checks = [
        line
        for line in readme.splitlines()
        if "render_reference_index.py" in line or "render_openapi_reference.py" in line
    ]
    assert generator_checks
    assert all("--check" in line for line in generator_checks), (
        "serving the documentation must not rewrite generated reference pages"
    )


def test_uv_setup_and_run_preserve_the_explicit_dependency_profile() -> None:
    installation = INSTALLATION_DOC.read_text(encoding="utf-8")
    assert "uv sync --locked --no-default-groups" in installation
    assert "uv sync --locked --no-default-groups --group docs" in installation
    assert "uv run --locked --no-sync python" in installation
    assert "uv run --locked --no-sync mkdocs" in installation
    assert "render_openapi_reference.py --check" in installation


@pytest.mark.parametrize(
    ("bullet", "reason"),
    [
        # The fullwidth semicolon is deliberate fixture data: these bullets
        # mirror the real installation.md line, which ends in Chinese
        # punctuation.
        ("- Node.js 20+ 与 npm；", "a bare major with no minor names no comparable version"),  # noqa: RUF001
        (
            "- Node.js `^22.13.0 || ^24.15.0 || >=26.0.0` 与 npm；",  # noqa: RUF001
            "understates the minimum minor",
        ),
        (
            "- Node.js `^22.22.2 || ^24.0.0 || >=26.0.0` 与 npm；",  # noqa: RUF001
            "understates the second active line",
        ),
        ("- Node.js `^22.22.2` 与 npm；", "drops the other accepted release lines"),  # noqa: RUF001
        (
            "- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0 || >=28.0.0` 与 npm；",  # noqa: RUF001
            "invents an extra branch",
        ),
    ],
)
def test_a_doc_line_that_disagrees_with_engines_is_rejected(bullet: str, reason: str) -> None:
    """Negative control: the same comparison must fail on a drifted bullet."""

    enforced = _engine_lower_bounds(_node_engines_range())
    documented = _documented_node_versions(f"# 安装\n\n## 前置条件\n\n{bullet}\n")

    agrees = (
        bool(documented)
        and min(documented)[:2] == min(enforced)[:2]
        and set(documented) == set(enforced)
    )
    assert not agrees, f"gate accepted a drifted Node.js prerequisite ({reason}): {bullet!r}"
