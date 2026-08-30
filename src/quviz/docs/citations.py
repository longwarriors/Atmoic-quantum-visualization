"""Markdown citation rendering backed by QuViz's BibTeX registry.

Source Markdown uses Pandoc-like keys such as ``[@stodolna2013stark]``. The
extension renders readable author-year labels and validates every key against
``references.bib``. A generated reference index remains the full bibliography.
"""

from __future__ import annotations

from pathlib import Path
from re import Match
from xml.etree import ElementTree

from markdown import Markdown
from markdown.extensions import Extension
from markdown.inlinepatterns import InlineProcessor

from quviz.docs.bibliography import BibEntry, Bibliography, parse_bibtex_file
from quviz.docs.locators import CitationReference, parse_citation_group

# Deliberately permissive: a strict key pattern silently fails to match a
# citation that carries a locator, so ``[@key, p. 4]`` would pass through as
# literal text and escape validation entirely. Matching loosely and validating
# afterwards turns that silent hole into a build error.
_PATTERN = r"(?<!\\)\[@([^\]]+)\]"


def _person_family(entry: BibEntry, index: int) -> str:
    person = entry.authors[index]
    if person.literal:
        return person.literal
    return " ".join(person.last_names) or " ".join(person.first_names) or "Unknown"


def _author_year(entry: BibEntry) -> str:
    if not entry.authors:
        author = entry.fields.get("organization", "Unknown")
    else:
        author = _person_family(entry, 0)
        if len(entry.authors) == 2:
            author = f"{author} & {_person_family(entry, 1)}"
        elif len(entry.authors) > 2:
            author = f"{author} et al."
    year = entry.fields.get("year", "n.d.")
    return f"{author}, {year}"


class CitationInlineProcessor(InlineProcessor):
    def __init__(self, pattern: str, bibliography: Bibliography) -> None:
        super().__init__(pattern)
        self.bibliography = bibliography

    def handleMatch(  # type: ignore[override]
        self, match: Match[str], data: str
    ) -> tuple[ElementTree.Element | None, int | None, int | None]:
        del data
        references: list[CitationReference] = parse_citation_group(match.group(1))
        missing = [ref.key for ref in references if ref.key not in self.bibliography.entries]
        if missing:
            raise ValueError(f"unknown citation key(s): {', '.join(missing)}")

        span = ElementTree.Element("span")
        span.set("class", "quviz-citation")
        span.set("data-cite-keys", ";".join(ref.key for ref in references))
        locators = [ref.locator or "" for ref in references]
        if any(locators):
            span.set("data-cite-locators", ";".join(locators))
        titles: list[str] = []
        span.text = "["
        for index, ref in enumerate(references):
            entry = self.bibliography.entries[ref.key]
            label = _author_year(entry)
            link = ElementTree.SubElement(span, "a")
            link.set("class", "quviz-citation__link")
            # MkDocs' relative-path tree processor rewrites this docs-root
            # source path for the current page when ``absolute_links`` is set
            # to ``relative_to_docs``. The built href is therefore safe both
            # at the domain root and under a deployment subpath.
            link.set("href", f"/references/index.md#{ref.key}")
            link.text = f"{label}, {ref.locator}" if ref.locator else label
            link.tail = " ; " if index < len(references) - 1 else "]"
            titles.append(f"{ref.key}: {entry.fields.get('title', ref.key)}")
        span.set("title", " | ".join(titles))
        return span, match.start(0), match.end(0)


class CitationExtension(Extension):
    def __init__(self, **kwargs: object) -> None:
        self.config = {
            "bib_file": ["references.bib", "Path to the canonical BibTeX file"],
        }
        super().__init__(**kwargs)

    def extendMarkdown(self, md: Markdown) -> None:
        bib_path = Path(str(self.getConfig("bib_file"))).resolve()
        bibliography = parse_bibtex_file(bib_path)
        md.inlinePatterns.register(
            CitationInlineProcessor(_PATTERN, bibliography), "quviz-citations", 175
        )


def makeExtension(**kwargs: object) -> CitationExtension:
    return CitationExtension(**kwargs)
