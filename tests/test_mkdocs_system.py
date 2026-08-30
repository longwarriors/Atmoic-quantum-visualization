"""Repository-level contracts for the MkDocs information architecture."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import yaml
from markdown import Markdown
from mkdocs.config import load_config

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
CONFIG_PATH = ROOT / "mkdocs.yml"


class _MkDocsSafeLoader(yaml.SafeLoader):
    """Safe YAML loader that keeps MkDocs' callable tag as a plain name."""


def _python_name(loader: _MkDocsSafeLoader, suffix: str, node: yaml.nodes.Node) -> str:
    loader.construct_scalar(node)
    return suffix


_MkDocsSafeLoader.add_multi_constructor("tag:yaml.org,2002:python/name:", _python_name)


def _raw_config() -> dict[str, Any]:
    return yaml.load(CONFIG_PATH.read_text(encoding="utf-8"), Loader=_MkDocsSafeLoader)


def _nav_paths(node: Any) -> list[str]:
    if isinstance(node, str):
        return [node] if node.endswith(".md") else []
    if isinstance(node, list):
        return [path for child in node for path in _nav_paths(child)]
    if isinstance(node, dict):
        return [path for child in node.values() for path in _nav_paths(child)]
    raise TypeError(f"unsupported nav node: {node!r}")


def test_every_markdown_page_appears_once_in_navigation() -> None:
    nav_paths = _nav_paths(_raw_config()["nav"])
    counts = Counter(nav_paths)
    duplicates = sorted(path for path, count in counts.items() if count != 1)
    markdown = {path.relative_to(DOCS).as_posix() for path in DOCS.rglob("*.md")}

    assert duplicates == []
    assert set(nav_paths) == markdown


def test_strict_validation_policy_is_explicit() -> None:
    config = _raw_config()
    assert config["strict"] is True
    assert config["validation"] == {
        "nav": {
            "omitted_files": "warn",
            "not_found": "warn",
            "absolute_links": "warn",
        },
        "links": {
            "not_found": "warn",
            "absolute_links": "relative_to_docs",
            "unrecognized_links": "warn",
            "anchors": "warn",
        },
    }


def test_admonition_titles_use_markdown_syntax_not_typographic_quotes() -> None:
    malformed: list[str] = []
    for path in DOCS.rglob("*.md"):
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.startswith("!!!") and ("“" in line or "”" in line):
                malformed.append(f"{path.relative_to(ROOT)}:{line_number}: {line}")

    assert malformed == [], (
        "PyMdown admonition titles require straight ASCII quotes; typographic quotes "
        "render the indented body as a code block:\n" + "\n".join(malformed)
    )


def test_mathjax_and_mermaid_are_exactly_pinned_and_instant_navigation_aware() -> None:
    scripts = _raw_config()["extra_javascript"]
    assert scripts == [
        "assets/javascripts/mathjax.js",
        "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js",
        "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js",
        "assets/javascripts/mermaid.js",
    ]
    mathjax = (DOCS / "assets/javascripts/mathjax.js").read_text(encoding="utf-8")
    mermaid = (DOCS / "assets/javascripts/mermaid.js").read_text(encoding="utf-8")
    assert "document$.subscribe" in mathjax
    assert "MathJax.typesetPromise()" in mathjax
    assert "startOnLoad: false" in mermaid
    assert "document$.subscribe(renderMermaid)" in mermaid
    assert "window.mermaid.run({ nodes })" in mermaid


def test_mermaid_fence_reaches_runtime_as_plain_diagram_text() -> None:
    config = load_config(str(CONFIG_PATH))
    markdown = Markdown(
        extensions=config["markdown_extensions"],
        extension_configs=config["mdx_configs"],
    )
    html = markdown.convert("```mermaid\ngraph LR\nA --> B\n```")

    assert '<div class="mermaid">graph LR' in html
    assert "A --&gt; B" in html
    assert "<code>" not in html


def test_phase_zero_python_api_reference_covers_public_modules() -> None:
    reference = (DOCS / "reference/physics-api.md").read_text(encoding="utf-8")
    modules = {
        "quviz.conventions",
        "quviz.physics.continuity",
        "quviz.physics.finite_box",
        "quviz.physics.hybridization",
        "quviz.physics.hydrogenic",
        "quviz.physics.observables",
        "quviz.physics.planes",
        "quviz.physics.superposition",
        "quviz.sampling.inverse_cdf",
        "quviz.sampling.point_cloud",
        "quviz.scene.binary",
        "quviz.scene.builders",
        "quviz.scene.models",
        "quviz.scene.slices",
        "quviz.scene.streamlines",
        "quviz.solvers.grid",
    }
    documented = {
        line.removeprefix("::: ").strip()
        for line in reference.splitlines()
        if line.startswith("::: ")
    }
    assert documented == modules
