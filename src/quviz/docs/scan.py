"""Citation scanning of Markdown sources, restricted to prose.

The orphan / unknown-key gate used to run the citation regex over the raw
Markdown text, so a key that appeared only inside a fenced code block, an
inline code span or an HTML comment counted as "cited" -- precisely the places
where ``cite-sources.md`` shows example syntax. An entry that nobody actually
cites then stayed invisible. This module strips those regions first and is the
single scanner shared by ``scripts/render_reference_index.py`` and the tests,
so the two cannot drift.

What is *not* stripped, deliberately: four-space indented blocks. In
mkdocs-material they are admonition bodies far more often than indented code,
and a citation inside an admonition is real prose.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from pathlib import Path

from quviz.docs.locators import GROUP_PATTERN, parse_citation_group

_FENCE_OPEN = re.compile(r"^\s*(`{3,}|~{3,})")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
# A code span is delimited by backtick runs of equal length (CommonMark 6.1).
_CODE_SPAN = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.DOTALL)


def _blank_lines(text: str) -> str:
    """Replace ``text`` with the same number of newlines so line numbers survive."""

    return "\n" * text.count("\n")


def _strip_fences(markdown: str) -> str:
    lines = markdown.split("\n")
    out: list[str] = []
    closing: tuple[str, int] | None = None
    for line in lines:
        if closing is None:
            match = _FENCE_OPEN.match(line)
            if match:
                marker = match.group(1)
                closing = (marker[0], len(marker))
                out.append("")
                continue
            out.append(line)
            continue
        stripped = line.strip()
        char, length = closing
        if stripped and set(stripped) == {char} and len(stripped) >= length:
            closing = None
        out.append("")
    return "\n".join(out)


def strip_non_prose(markdown: str) -> str:
    """Blank out fenced code blocks, HTML comments and inline code spans.

    Newline count is preserved so callers can still report line numbers.
    """

    text = _strip_fences(markdown)
    text = _HTML_COMMENT.sub(lambda m: _blank_lines(m.group(0)), text)
    return _CODE_SPAN.sub(lambda m: _blank_lines(m.group(0)), text)


def cited_keys_in(markdown: str) -> set[str]:
    """Keys cited in the prose of one Markdown document.

    Raises ``ValueError`` for a malformed citation, exactly as the MkDocs
    extension would at build time.
    """

    keys: set[str] = set()
    for match in GROUP_PATTERN.finditer(strip_non_prose(markdown)):
        keys.update(ref.key for ref in parse_citation_group(match.group(1)))
    return keys


def cited_keys_in_tree(docs_dir: Path, *, exclude: Collection[Path] = ()) -> set[str]:
    """Union of :func:`cited_keys_in` over every ``*.md`` under ``docs_dir``.

    A malformed citation is re-raised with the offending path prefixed.
    """

    excluded = {Path(path).resolve() for path in exclude}
    keys: set[str] = set()
    for path in sorted(Path(docs_dir).rglob("*.md")):
        if path.resolve() in excluded:
            continue
        try:
            keys |= cited_keys_in(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise ValueError(f"{path}: {exc}") from exc
    return keys
