"""Every third-party module the package imports must be a declared dependency.

``src/quviz/docs/scan.py`` imported ``markdown`` while ``pyproject.toml``
declared it nowhere: not in ``[project] dependencies``, not in the ``dev``
group (which carried only the ``types-Markdown`` stub). The import worked
anyway, because ``mkdocs-material`` in the ``docs`` group pulls python-markdown
in transitively -- so every environment that installed the docs group had it,
and CI installs every group. A contributor who ran the documented ``uv run
pytest`` without ``--group docs`` got ``ModuleNotFoundError: No module named
'markdown'`` at collection time, and so would anyone installing the published
wheel, which carries no dependency groups at all.

The invariant this gate pins is one-directional: an import must be backed by a
declaration. The converse is deliberately not checked -- a distribution may be
declared because it is needed at runtime without being imported by name
(``uvicorn`` is launched as a server, ``orjson`` is picked up by FastAPI's
response class), and turning that into a failure would punish honest
declarations.

Import names and distribution names are different namespaces (``skimage``
comes from ``scikit-image``), so the mapping is taken from the installed
metadata via :func:`importlib.metadata.packages_distributions` rather than
guessed. A module the current environment cannot account for falls back to its
own name as the candidate distribution, which fails loudly rather than passing
by accident.
"""

from __future__ import annotations

import ast
import re
import sys
import tomllib
from collections.abc import Iterable, Mapping
from importlib.metadata import packages_distributions
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"
PACKAGE_DIR = ROOT / "src" / "quviz"

# The distribution this project *is*: its own modules need no declaration.
FIRST_PARTY = frozenset({"quviz"})

# PEP 508: a requirement string starts with the distribution name, which then
# ends at an extras bracket, a version specifier, a marker or whitespace.
_REQUIREMENT_NAME = re.compile(r"^\s*(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)")


def _canonical(name: str) -> str:
    """PEP 503 normalisation, so ``types-Markdown`` and ``types_markdown`` agree."""

    return re.sub(r"[-_.]+", "-", name).lower()


def _declared_distributions() -> set[str]:
    """Canonical names in ``[project] dependencies`` -- what a wheel install gets."""

    manifest = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    requirements = manifest["project"]["dependencies"]
    assert isinstance(requirements, list) and requirements, (
        f"{PYPROJECT} declares no [project] dependencies for this gate to compare against"
    )
    declared: set[str] = set()
    for requirement in requirements:
        match = _REQUIREMENT_NAME.match(str(requirement))
        assert match is not None, f"unparsable requirement string in {PYPROJECT}: {requirement!r}"
        declared.add(_canonical(match.group("name")))
    return declared


def _imported_roots(source: str) -> set[str]:
    """Top-level module names an ``ast``-parsed source imports absolutely.

    Deferred imports inside a function body count: ``scan.py`` would have been
    just as broken had its ``markdown`` import been lazy. Relative imports
    (``level > 0``) address this package and are skipped.
    """

    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".", 1)[0])
    return roots


def _third_party_imports(package_dir: Path) -> dict[str, set[Path]]:
    """Non-stdlib, non-first-party import roots under ``package_dir``, with sources."""

    imports: dict[str, set[Path]] = {}
    for path in sorted(package_dir.rglob("*.py")):
        for root in _imported_roots(path.read_text(encoding="utf-8")):
            if root in sys.stdlib_module_names or root in FIRST_PARTY:
                continue
            imports.setdefault(root, set()).add(path)
    return imports


def _candidate_distributions(root: str, mapping: Mapping[str, list[str]]) -> set[str]:
    """Which distributions could satisfy the import ``root``.

    ``packages_distributions`` reads the installed metadata, so a namespace
    shared by several distributions yields several candidates and any one of
    them declared is enough. A root the environment does not know about falls
    back to its own name, which is the common case (``numpy`` ships ``numpy``)
    and fails with a readable message when it is not.
    """

    return {_canonical(name) for name in mapping.get(root, [root])}


def undeclared_imports(
    imports: Mapping[str, Iterable[Path]],
    declared: set[str],
    mapping: Mapping[str, list[str]],
) -> dict[str, set[Path]]:
    """Imports whose every candidate distribution is missing from ``declared``."""

    return {
        root: set(sources)
        for root, sources in imports.items()
        if not _candidate_distributions(root, mapping) & declared
    }


def test_every_third_party_import_is_a_declared_dependency() -> None:
    """A wheel install of QuViz can import every module the package imports."""

    imports = _third_party_imports(PACKAGE_DIR)
    assert imports, f"no third-party imports found under {PACKAGE_DIR}; the scan is broken"

    missing = undeclared_imports(imports, _declared_distributions(), packages_distributions())

    assert not missing, "imports not backed by [project] dependencies: " + "; ".join(
        f"{root} (imported by {', '.join(sorted(str(p.relative_to(ROOT)) for p in sources))})"
        for root, sources in sorted(missing.items())
    )


def test_markdown_is_declared_because_the_citation_scanner_imports_it() -> None:
    """The specific regression: ``quviz.docs.scan`` needs python-markdown.

    Pinned by name as well as by the general gate above, because this is the
    import that was missing and the general gate would stop covering it the
    moment the mapping from ``markdown`` to its distribution changed shape.
    """

    scanner = PACKAGE_DIR / "docs" / "scan.py"
    assert "markdown" in _imported_roots(scanner.read_text(encoding="utf-8")), (
        f"{scanner} no longer imports markdown; this regression pin needs revisiting"
    )
    assert "markdown" in _declared_distributions(), (
        "quviz.docs.scan imports markdown at runtime, but pyproject.toml does not declare it "
        "in [project] dependencies -- it resolves only as a transitive of the docs group"
    )


def test_an_undeclared_import_is_reported() -> None:
    """Negative control: the comparison must fail on a fabricated missing declaration."""

    fabricated = {"skimage": [Path("src/quviz/render/isosurface.py")]}
    mapping = {"skimage": ["scikit-image"]}

    assert undeclared_imports(fabricated, {"numpy"}, mapping), (
        "gate accepted an import whose distribution is undeclared"
    )
    assert not undeclared_imports(fabricated, {"scikit-image"}, mapping), (
        "gate rejected an import whose distribution is declared under its real name"
    )
