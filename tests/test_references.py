from __future__ import annotations

from pathlib import Path

import pytest

markdown_module = pytest.importorskip("markdown", reason="install the docs dependency group")
Markdown = markdown_module.Markdown

from quviz.docs.citations import CitationExtension  # noqa: E402

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


def test_citation_extension_renders_a_page_or_section_locator() -> None:
    # source-policy.md requires core claims to record a page or section. The
    # syntax has to be able to express one before the policy is enforceable.
    markdown = Markdown(extensions=[CitationExtension(bib_file=str(ROOT / "references.bib"))])
    html = markdown.convert("See [@griffiths2018qm, §4.4.1].")
    assert "2018, §4.4.1" in html
    assert 'data-cite-keys="griffiths2018qm"' in html


def test_citation_extension_renders_locators_for_each_key_in_a_group() -> None:
    markdown = Markdown(extensions=[CitationExtension(bib_file=str(ROOT / "references.bib"))])
    html = markdown.convert("See [@griffiths2018qm, ch. 4; @stodolna2013stark, fig. 2].")
    assert "2018, ch. 4" in html
    assert "Stodolna et al., 2013, fig. 2" in html


def test_citation_extension_rejects_an_unknown_key_that_carries_a_locator() -> None:
    # Previously the strict key pattern simply failed to match a citation with
    # a locator, so it passed through as literal text and escaped validation.
    markdown = Markdown(extensions=[CitationExtension(bib_file=str(ROOT / "references.bib"))])
    with pytest.raises(ValueError, match="unknown citation"):
        markdown.convert("See [@not-a-real-source, p. 1].")


def test_citation_extension_rejects_a_malformed_key() -> None:
    markdown = Markdown(extensions=[CitationExtension(bib_file=str(ROOT / "references.bib"))])
    with pytest.raises(ValueError, match="malformed citation"):
        markdown.convert("See [@griffiths2018qm p. 4].")
