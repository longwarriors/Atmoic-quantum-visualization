"""Citation scanning of Markdown sources, restricted to prose.

The orphan / unknown-key gate used to run the citation regex over the raw
Markdown text, so a key that appeared only inside a fenced code block, an
inline code span or an HTML comment counted as "cited" -- precisely the places
where ``cite-sources.md`` shows example syntax. An entry that nobody actually
cites then stayed invisible. This module strips those regions first and is the
single scanner shared by ``scripts/render_reference_index.py`` and the tests,
so the two cannot drift.

The yardstick is what python-markdown (with ``pymdownx.superfences`` and
``md_in_html``, as ``mkdocs.yml`` configures) hands to the inline patterns at
build time. ``tests/test_citation_gates.py`` builds each case below and checks
that the scanner agrees:

* **Fenced code** follows superfences, not CommonMark: the closing fence must
  be the same run as the opener (`````` ``` `````` is not closed by
  `````` ```` ``````), a non-blank line indented less than the opener abandons
  the fence, and a fence that never closes is not a fence -- its lines stay
  prose. A backtick run on a list-marker line (``- ```\\```) is *not* a fence
  opener; it is paragraph text that python-markdown pairs into a multi-line
  code span, which the code-span rule below handles (so ``- ~~~`` stays prose).
* **Raw HTML blocks**: a block-level tag (``<pre>``, ``<div>``, ``<details>``,
  ``<script>`` ...) that starts a line, indented at most three spaces, is
  stashed whole by python-markdown's ``HtmlBlockPreprocessor`` -- nothing
  inside it is a citation -- unless it carries a ``markdown`` attribute other
  than ``"0"`` (``md_in_html``). The block ends at the matching closing tag;
  text after that tag on the same line is prose again. An unclosed block
  swallows the rest of the document, as it does at build time.
* **HTML comments** are removed only when they start a line (a block-level
  comment). A comment inside a prose line stays in the paragraph, where the
  citation pattern runs *before* the inline-HTML pattern, so ``[@key]`` inside
  it is validated at build time and must be counted here too.
* **Code spans** never cross a blank line, because python-markdown splits the
  document into blocks before inline patterns run.

What is *not* stripped, deliberately: four-space indented blocks. In
mkdocs-material they are admonition bodies far more often than indented code,
and a citation inside an admonition is real prose. Known, rare divergences:
a block-level tag later on the line a block just closed on (python-markdown
opens another raw block there), and a fence whose info string superfences
would reject.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from pathlib import Path

from quviz.docs.bibliography import Bibliography, keywords
from quviz.docs.locators import GROUP_PATTERN, parse_citation_group

# Entries that document the build toolchain rather than a scientific claim are
# not expected to appear in prose.
TOOLING_KEYWORD = "tooling"

# python-markdown's BLOCK_LEVEL_ELEMENTS minus the void ``hr``, which cannot
# contain a citation. tests/test_citation_gates.py pins this to the installed
# python-markdown so the two cannot drift.
BLOCK_TAGS = frozenset({
    "address", "article", "aside", "blockquote", "body", "canvas", "center", "colgroup",
    "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
    "form", "group", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "html",
    "iframe", "legend", "li", "main", "map", "math", "menu", "nav", "noscript", "object",
    "ol", "option", "output", "p", "pre", "progress", "script", "section", "style",
    "summary", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr", "ul",
    "video",
})  # fmt: skip

# superfences: optional whitespace / blockquote prefix, then a backtick or tilde
# run. The info string of a backtick fence may not contain a backtick.
_FENCE_OPEN = re.compile(r"^(?P<prefix>[ \t>]*)(?P<fence>`{3,}(?=[^`\n]*$)|~{3,})")
_FENCE_PREFIX_CHARS = " \t>"

# A raw HTML block starts a line (up to three spaces in) with a comment opener
# or a tag; attributes may span lines.
_HTML_BLOCK_START = re.compile(
    r"^[ ]{0,3}(?:(?P<comment><!--)|<(?P<tag>[a-zA-Z][a-zA-Z0-9]*)"
    r"(?P<attrs>(?:\s[^>]*?)?)\s*(?P<void>/?)>)",
    re.MULTILINE,
)
# md_in_html: ``markdown``, ``markdown="1"``, ``markdown="block"``/``"span"``
# mean "parse the contents"; ``markdown="0"`` means raw.
_MARKDOWN_ATTR = re.compile(
    r"""(?<![\w-])markdown(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?"""
)
# A code span is delimited by backtick runs of equal length (CommonMark 6.1)
# and, in python-markdown, never spans a blank line.
_CODE_SPAN = re.compile(r"(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n).)+?)(?<!`)\1(?!`)", re.DOTALL)


def _blank_lines(text: str) -> str:
    """Replace ``text`` with the same number of newlines so line numbers survive."""

    return "\n" * text.count("\n")


def _fence_extent(lines: list[str], start: int, indent: int, fence: str) -> tuple[bool, int]:
    """Where the fence opened on ``lines[start]`` ends.

    Returns ``(True, closer_index)`` when it closes, otherwise ``(False, i)``
    where ``i`` is the under-indented line that abandoned it (superfences
    consumes that line without re-reading it as an opener) or the last line
    of the document.
    """

    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip():
            continue
        if len(line) - len(line.lstrip(_FENCE_PREFIX_CHARS)) < indent:
            return False, index
        if line[indent:].rstrip(" \t") == fence:
            return True, index
    return False, len(lines) - 1


def _strip_fences(markdown: str) -> str:
    lines = markdown.split("\n")
    out = list(lines)
    index = 0
    while index < len(lines):
        match = _FENCE_OPEN.match(lines[index])
        if match is None:
            index += 1
            continue
        closed, last = _fence_extent(lines, index, len(match.group("prefix")), match.group("fence"))
        if closed:
            for blanked in range(index, last + 1):
                out[blanked] = ""
        index = last + 1
    return "\n".join(out)


def _markdown_enabled(attrs: str) -> bool:
    match = _MARKDOWN_ATTR.search(attrs)
    if match is None:
        return False
    value = next((group for group in match.groups() if group is not None), "1")
    return value != "0"


def _html_block_end(markdown: str, match: re.Match[str]) -> int | None:
    """End offset of the raw block ``match`` opens, or ``None`` if it opens none."""

    if match.group("comment"):
        close = markdown.find("-->", match.end())
        # An unclosed ``<!--`` is literal text to python-markdown.
        return None if close < 0 else close + len("-->")
    tag = match.group("tag").lower()
    if tag not in BLOCK_TAGS or _markdown_enabled(match.group("attrs")):
        return None
    if match.group("void"):
        return match.end()
    depth = 1
    same_tag = re.compile(rf"<(/?){re.escape(tag)}(?=[\s/>])[^>]*>", re.IGNORECASE)
    for tag_match in same_tag.finditer(markdown, match.end()):
        if tag_match.group(1):
            depth -= 1
            if depth == 0:
                return tag_match.end()
        elif not tag_match.group(0).endswith("/>"):
            depth += 1
    return len(markdown)


def _strip_html_blocks(markdown: str) -> str:
    out: list[str] = []
    pos = 0
    while (match := _HTML_BLOCK_START.search(markdown, pos)) is not None:
        end = _html_block_end(markdown, match)
        if end is None:
            out.append(markdown[pos : match.end()])
            pos = match.end()
            continue
        out.append(markdown[pos : match.start()])
        out.append(_blank_lines(markdown[match.start() : end]))
        pos = end
    out.append(markdown[pos:])
    return "".join(out)


def strip_non_prose(markdown: str) -> str:
    """Blank out fenced code, raw HTML blocks, block comments and code spans.

    Newline count is preserved so callers can still report line numbers.
    """

    text = _strip_fences(markdown)
    text = _strip_html_blocks(text)
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


def orphan_keys(bibliography: Bibliography, used: set[str]) -> list[str]:
    """Entries nobody cites in prose -- and which therefore nobody reviews.

    Entries tagged ``keywords = {tooling}`` are exempt. Shared by the index
    script and the test suite so the two cannot disagree about what an orphan
    is.
    """

    return sorted(
        key
        for key, entry in bibliography.entries.items()
        if key not in used and TOOLING_KEYWORD not in keywords(entry)
    )
