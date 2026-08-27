"""Declared toolchain versions must match the versions actually enforced.

``docs/getting-started/installation.md`` tells a reader which Node.js they
need; ``web/package.json`` is what npm actually enforces via ``engines``. When
the two drift, the documentation is not merely stale -- it instructs a reader
to install a runtime that the project rejects, and nothing in the build catches
it, because npm reads the manifest and never reads the prose.

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
INSTALLATION_DOC = ROOT / "docs" / "getting-started" / "installation.md"
WEB_PACKAGE_JSON = ROOT / "web" / "package.json"

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


@pytest.mark.parametrize(
    ("bullet", "reason"),
    [
        # The fullwidth semicolon is deliberate fixture data: these bullets
        # mirror the real installation.md line, which ends in Chinese
        # punctuation.
        ("- Node.js 20+ 与 npm；", "a bare major with no minor names no comparable version"),  # noqa: RUF001
        ("- Node.js `^20.0.0 || >=24.0.0` 与 npm；", "understates the minimum major"),  # noqa: RUF001
        ("- Node.js `^22.11.0 || >=24.0.0` 与 npm；", "understates the minimum minor"),  # noqa: RUF001
        ("- Node.js `^22.13.0` 与 npm；", "drops the second accepted major line"),  # noqa: RUF001
        ("- Node.js `^22.13.0 || >=24.0.0 || >=26.0.0` 与 npm；", "invents an extra branch"),  # noqa: RUF001
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
