from __future__ import annotations

from pathlib import Path

import pytest

markdown_module = pytest.importorskip("markdown", reason="install the docs dependency group")
Markdown = markdown_module.Markdown

from quviz.docs.citations import CitationExtension

ROOT = Path(__file__).resolve().parents[1]


def test_citation_extension_renders_known_key() -> None:
    markdown = Markdown(extensions=[CitationExtension(bib_file=str(ROOT / "references.bib"))])
    html = markdown.convert("See [@stodolna2013stark].")
    assert "Stodolna et al., 2013" in html
    assert 'data-cite-keys="stodolna2013stark"' in html


def test_citation_extension_rejects_unknown_key() -> None:
    markdown = Markdown(extensions=[CitationExtension(bib_file=str(ROOT / "references.bib"))])
    with pytest.raises(ValueError, match="unknown citation"):
        markdown.convert("See [@not-a-real-source].")
