"""Citation scanning of Markdown sources, restricted to prose.

The orphan / unknown-key gate used to run the citation regex over the raw
Markdown text, so a key that appeared only inside a fenced code block, an
inline code span or an HTML comment counted as "cited" -- precisely the places
where ``cite-sources.md`` shows example syntax. An entry that nobody actually
cites then stayed invisible. This module strips those regions first and is the
single scanner shared by ``scripts/render_reference_index.py`` and the tests,
so the two cannot drift.

The yardstick is what python-markdown, with the extensions ``mkdocs.yml``
configures (``pymdownx.superfences``, ``md_in_html``, ``pymdownx.arithmatex``
...), hands to the citation inline pattern at build time.
``tests/test_citation_gates.py`` builds each case below with that very
extension list and checks that the scanner agrees:

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
* **Math** (``pymdownx.arithmatex``, generic mode, smart dollars): inline
  ``$...$`` and ``\\(...\\)`` are stashed at priority 189.9, before the
  citation pattern (175) runs, so ``$[@key]$`` is never a citation. The
  scanner uses arithmatex's own delimiter rules -- a ``$`` opener may not be
  followed by whitespace nor the closer preceded by it, ``\\$`` is literal, an
  even run of backslashes before a delimiter is literal backslashes, and the
  body may contain ``\\.`` escapes but no bare ``$`` -- and, like the build,
  never lets a pair cross a code span (already stashed at 190) or a blank
  line. Block math (``$$...$$``, ``\\[...\\]``, ``\\begin{env}...\\end{env}``)
  is recognised only when it is the *whole* blank-line-delimited block, as
  arithmatex anchors its block pattern; trailing text on the closing line
  turns the block back into prose. Blockquote markers, list markers and
  admonition indentation in front of the block are accepted as prefixes.
* **Link reference definitions** (``[label]: url "title"``, URL possibly on
  the next line) are consumed by python-markdown's ``ReferenceProcessor``
  wherever they start a line, also inside a paragraph, a blockquote or a list
  item. ``[@key]: https://...`` therefore defines a reference, it does not
  cite. A line that merely *looks* like one (``[@key]: see the paper``) is
  prose, exactly as the build treats it.
* **Front matter** is removed by mkdocs (``mkdocs.utils.meta``) before
  Markdown ever runs: a leading ``---``/``...``-delimited YAML block, or
  MultiMarkdown-style ``Key: value`` lines up to the first blank line.

What is *not* stripped, deliberately: four-space indented blocks. In
mkdocs-material they are admonition bodies far more often than indented code,
and a citation inside an admonition is real prose. Known, rare divergences:
a block-level tag later on the line a block just closed on (python-markdown
opens another raw block there); a fence whose info string superfences would
reject; a YAML front matter that is not a mapping (mkdocs then leaves it in
the page as prose, the scanner still removes it); an inline math pair whose
delimiters sit in different block elements that no blank line separates (a
heading and the paragraph under it); and a reference definition line that
setext underlining turns into a heading.
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
# python-markdown replaces a stashed span with an STX...ETX placeholder, and
# arithmatex's inline bodies exclude those two characters. The scanner leaves
# the same STX behind where a code span was, so math cannot cross one either.
_STASH = "\x02"

# pymdownx.arithmatex inline math, generic mode with smart dollars (the
# mkdocs.yml configuration). Rebuilt from RE_SMART_DOLLAR_INLINE and
# RE_BRACKET_INLINE: the build first consumes an even run of backslashes in
# front of a delimiter as literal backslashes, then opens on the delimiter;
# ``(?<!\\)(?:\\\\)*`` folds those two steps into one match. A body never
# crosses a blank line because inline patterns run per block element.
_NOT_BLANK_LINE = r"(?!\n[ \t]*\n)"
_INLINE_MATH = re.compile(
    r"(?<!\\)(?:\\\\)*(?:"
    r"\$(?!\s)(?:\\.|" + _NOT_BLANK_LINE + r"[^\\$\x02\x03])+?(?<!\s)\$"
    r"|"
    r"\\\((?:\\[^)]|" + _NOT_BLANK_LINE + r"[^\\\x02\x03])+?\\\)"
    r")",
    re.DOTALL,
)
# arithmatex's block pattern, verbatim (tests/test_citation_gates.py pins it to
# the installed pymdownx): it must match the whole block.
_BLOCK_MATH = re.compile(
    r"(?s)^(?:"
    r"(?P<dollar>[$]{2})(?P<math>((?:\\.|[^\\])+?))(?P=dollar)"
    r"|"
    r"\\\[(?P<math3>(?:\\[^\]]|[^\\])+?)\\\]"
    r"|"
    r"(?P<math2>\\begin\{(?P<env>[a-z]+\*?)\}(?:\\.|[^\\])+?\\end\{(?P=env)\})"
    r")[ ]*$"
)
# What may stand in front of a block before its content is parsed again:
# blockquote markers, a list marker, admonition / list-continuation indent.
_BLOCK_PREFIX = re.compile(r"^(?:[ \t]*(?:>|[*+-][ \t]|\d+\.[ \t]))*[ \t]*")
_LINE_PREFIX = re.compile(r"^[ \t>]*")
_BLANK_LINE_SPLIT = re.compile(r"(\n[ \t]*\n)")

# python-markdown's ReferenceProcessor.RE, verbatim after the ``^`` (pinned by
# the tests). Blockquote and list markers may precede it on the first line.
_REFERENCE_DEFINITION_BODY = (
    r'[ ]{0,3}\[([^\[\]]*)\]:[ ]*\n?[ ]*([^\s]+)[ ]*(?:\n[ ]*)?((["\'])(.*)\4[ ]*|\((.*)\)[ ]*)?$'
)
_REFERENCE_DEFINITION = re.compile(
    r"^(?:[ ]{0,3}(?:>[ ]?|[*+-][ ]+|\d+\.[ ]+))*" + _REFERENCE_DEFINITION_BODY, re.MULTILINE
)

# mkdocs.utils.meta: YAML front matter, else MultiMarkdown ``Key: value`` lines.
_YAML_FRONT_MATTER = re.compile(r"^-{3}[ \t]*\n(.*?\n)(?:\.{3}|-{3})[ \t]*\n", re.DOTALL)
_META_LINE = re.compile(r"^[ ]{0,3}(?P<key>[A-Za-z0-9_-]+):\s*(?P<value>.*)")
_META_MORE = re.compile(r"^([ ]{4}|\t)(\s*)(?P<value>.*)")

# The file suffixes mkdocs renders as Markdown (mkdocs.utils.markdown_extensions)
# and the paths its default ``exclude_docs`` leaves out of the site.
MARKDOWN_SUFFIXES = (".markdown", ".mdown", ".mkdn", ".mkd", ".md")
EXCLUDED_ROOT_DIRS = frozenset({"templates"})


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


def _strip_front_matter(markdown: str) -> str:
    """Blank what ``mkdocs.utils.meta.get_data`` removes before Markdown runs."""

    match = _YAML_FRONT_MATTER.match(markdown)
    if match is not None:
        return _blank_lines(match.group(0)) + markdown[match.end() :]
    lines = markdown.split("\n")
    consumed = 0
    for line in lines:
        if not line.strip():
            break
        if _META_LINE.match(line) is None and not (consumed and _META_MORE.match(line)):
            break
        consumed += 1
    return "\n".join([""] * consumed + lines[consumed:])


def _is_block_math(block: str) -> bool:
    lines = block.strip("\n").split("\n")
    head = _BLOCK_PREFIX.sub("", lines[0], count=1)
    rest = [_LINE_PREFIX.sub("", line, count=1) for line in lines[1:]]
    return _BLOCK_MATH.match("\n".join([head, *rest])) is not None


def _strip_block_math(markdown: str) -> str:
    # ``re.split`` with a capturing group keeps the blank-line separators at
    # the odd indices, so the blocks can be blanked in place.
    parts = _BLANK_LINE_SPLIT.split(markdown)
    for index in range(0, len(parts), 2):
        if parts[index].strip() and _is_block_math(parts[index]):
            parts[index] = _blank_lines(parts[index])
    return "".join(parts)


def strip_non_prose(markdown: str) -> str:
    """Blank out everything the build never hands to the citation pattern.

    Front matter, fenced code, raw HTML blocks and block comments, block and
    inline math, link reference definitions and code spans -- in the order
    the toolchain removes them. Newline count is preserved so callers can
    still report line numbers.
    """

    text = _strip_front_matter(markdown)
    text = _strip_fences(text)
    text = _strip_html_blocks(text)
    text = _strip_block_math(text)
    text = _REFERENCE_DEFINITION.sub(lambda m: _blank_lines(m.group(0)), text)
    text = _CODE_SPAN.sub(lambda m: _STASH + _blank_lines(m.group(0)), text)
    text = _INLINE_MATH.sub(lambda m: _blank_lines(m.group(0)), text)
    return text.replace(_STASH, "")


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
    """Union of :func:`cited_keys_in` over every page mkdocs would build.

    Walks the Markdown suffixes mkdocs renders and applies its default
    ``exclude_docs`` (dot-files and dot-directories anywhere, ``templates/``
    at the docs root) so a page the site never shows cannot keep an entry
    looking cited. A malformed citation is re-raised with the offending path
    prefixed.
    """

    root = Path(docs_dir)
    excluded = {Path(path).resolve() for path in exclude}
    keys: set[str] = set()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in MARKDOWN_SUFFIXES:
            continue
        parts = path.relative_to(root).parts
        if any(part.startswith(".") for part in parts):
            continue
        if len(parts) > 1 and parts[0] in EXCLUDED_ROOT_DIRS:
            continue
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
