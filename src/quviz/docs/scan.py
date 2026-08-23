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
* **Raw HTML blocks** are decided by python-markdown itself: the scanner runs
  the ``md_in_html`` ``HTMLExtractorExtra`` that ``HtmlBlockPreprocessor``
  uses at build time and blanks every source span it stashes. That covers
  the rules a hand-written scanner used to approximate -- a block-level tag
  (``<pre>``, ``<div>``, ``<details>``, ``<script>`` ...) starting a line
  indented at most three spaces opens a raw block that ends at its matching
  closing tag, or swallows the rest of the document when never closed; a
  ``markdown`` attribute other than ``"0"`` keeps the content as prose only
  when the opening tag is the very first thing in its block -- at column 0
  of its line, not even one space in front of it, and nothing but a line
  break or blank lines between it and the previous block (the full rule is
  below) -- and the ones it got wrong. After a raw block, a block-level comment, an
  ``<hr>``, a void tag or a ``markdown`` element closes with more content on
  its line the extractor is *in tail*: the next block-level tag on that line
  opens another raw block wherever it sits, and a comment there joins the raw
  cache. Directly inside a ``markdown`` element, before any text, a
  block-level tag nests an element whose content is raw unless it carries
  ``markdown`` itself; after text it is inline HTML and its content is prose.
  The ``markdown`` element's own tags leave the text flow, so its content is
  parsed as blocks of its own, as ``MarkdownInHtmlProcessor`` does -- but
  only when the element's placeholder *starts* its block: that processor
  matches it at position 0. A ``markdown`` element opened in the tail of a
  raw block (after the closing tag, a comment, an ``<hr>`` or a void tag on
  the same line, whatever whitespace separates them), or on a line indented
  one to three spaces (``at_line_start`` still opens the element, but the
  spaces land in front of its placeholder) shares its block with whatever
  precedes it and is emitted verbatim, attribute and all, so its content is
  raw to the build and blanked here. Prose text *before* the tag on a
  fresh line is the other case: the tag is then inline HTML inside a
  paragraph and its content is prose, to the build and to the scanner.
* **HTML comments** are removed when they start a line (a block-level
  comment) or follow a closed block in its tail. A comment inside a prose
  line stays in the paragraph, where the citation pattern runs *before* the
  inline-HTML pattern, so ``[@key]`` inside it is validated at build time
  and must be counted here too.
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
  admonition indentation in front of the block are accepted as prefixes. A
  block that is not math as a whole is split where python-markdown splits
  it -- at an ATX heading line first (``HashHeaderProcessor``), else at a
  thematic break (``HRProcessor``) -- and each side is tried again, so math
  directly under a heading or a rule, with no blank line between, is still
  math, while ``$$ ... --- ... $$`` stays one math block (arithmatex runs
  before both splitters).
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
a fence whose info string superfences would reject; a YAML front matter that
is not a mapping (mkdocs then leaves it in the page as prose, the scanner
still removes it); an inline math pair whose delimiters sit in different
block elements that no blank line separates (a heading and the paragraph
under it); a reference definition line that setext underlining turns into a
heading; an indented ``# heading`` continuing a paragraph (literal text to
the build, a splitter to the scanner because the same indentation is an
admonition body); and a ``markdown="span"`` element, whose content the build
hands straight to the inline patterns without block parsing (a reference
definition or block math in there is prose to the build, blanked here).
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterable
from pathlib import Path

from markdown import Markdown
from markdown.extensions.md_in_html import HTMLExtractorExtra

from quviz.docs.bibliography import Bibliography, keywords
from quviz.docs.locators import GROUP_PATTERN, parse_citation_group

# Entries that document the build toolchain rather than a scientific claim are
# not expected to appear in prose.
TOOLING_KEYWORD = "tooling"

# superfences: optional whitespace / blockquote prefix, then a backtick or tilde
# run. The info string of a backtick fence may not contain a backtick.
_FENCE_OPEN = re.compile(r"^(?P<prefix>[ \t>]*)(?P<fence>`{3,}(?=[^`\n]*$)|~{3,})")
_FENCE_PREFIX_CHARS = " \t>"

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
# Lines at which python-markdown splits a block and parses each side on its
# own: an ATX heading (HashHeaderProcessor, which needs no space after the
# hashes) first, then a thematic break (HRProcessor), in that priority order.
_BLOCK_SPLITTERS = (
    re.compile(r"^#{1,6}"),
    re.compile(r"^[ ]{0,3}(?:(?:-+[ ]{0,2}){3,}|(?:_+[ ]{0,2}){3,}|(?:\*+[ ]{0,2}){3,})[ ]*$"),
)

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


class _HiddenSpanExtractor(HTMLExtractorExtra):
    """python-markdown's own raw-HTML extractor, recording what it hides.

    ``HtmlBlockPreprocessor`` (the ``md_in_html`` flavour ``mkdocs.yml``
    configures) runs this parser over the source and stashes raw blocks,
    block-level comments and the content of ``markdown``-disabled elements
    away from every later processor. Instead of re-deriving its rules -- the
    "in tail" state after a block closes with text left on its line, the
    nested-element rule of ``md_in_html`` ... -- this subclass lets the real
    state machine run and notes the source spans that end up stashed, so the
    scanner can blank exactly those and keep its line numbers.

    Positions come from ``updatepos``, which the parser calls with the
    offsets of every token it consumes, rather than from ``getpos``: after
    ``feed`` stops on an incomplete construct, ``close`` re-parses the
    remainder in a truncated buffer, and ``_base`` keeps the absolute offset
    straight across that boundary.
    """

    def __init__(self, md: Markdown, source: str) -> None:
        super().__init__(md)
        self.source = source
        self.hidden: list[tuple[int, int]] = []
        self._base = 0
        self._cursor = 0
        self._at_eof = False
        self._raw_start: int | None = None
        self._off_start: int | None = None
        self._element_start: int | None = None

    # -- position tracking ----------------------------------------------------

    def goahead(self, end: bool) -> None:
        self._cursor = self._base
        super().goahead(end)
        self._base = len(self.source) - len(self.rawdata)
        self._cursor = self._base

    def updatepos(self, i: int, j: int) -> int:
        self._cursor = self._base + j
        return super().updatepos(i, j)

    def _tag_end(self, pos: int) -> int:
        if self._at_eof:
            return len(self.source)
        close = self.source.find(">", pos)
        return len(self.source) if close < 0 else close + 1

    def _hide(self, start: int, end: int) -> None:
        self.hidden.append((start, end))

    # -- the extractor's decisions, observed -----------------------------------

    def handle_starttag(self, tag: str, attrs: Iterable[tuple[str, str | None]]) -> None:
        pos = self._cursor
        super().handle_starttag(tag, attrs)
        if self.inraw:
            if self._raw_start is None:
                self._raw_start = pos
        elif self.mdstack and self.mdstarted[-1]:
            # md_in_html opened an element for this tag: the tag itself
            # leaves the text flow, and an element whose content is not
            # parsed hides everything until it closes.
            self._hide(pos, pos + len(self.get_starttag_text()))
            if len(self.mdstack) == 1:
                self._element_start = pos
            if self.mdstate[-1] == "off" and self._off_start is None:
                self._off_start = pos

    def handle_endtag(self, tag: str) -> None:
        pos = self._cursor
        was_raw = self.inraw
        was_element = not was_raw and tag in self.mdstack
        super().handle_endtag(tag)
        end = self._tag_end(pos)
        if was_raw and not self.inraw and self._raw_start is not None:
            self._hide(self._raw_start, end)
            self._raw_start = None
        if self._off_start is not None and not (self.mdstack and self.mdstate[-1] == "off"):
            self._hide(self._off_start, end)
            self._off_start = None
        if was_element:
            self._hide(pos, end)
            if not self.mdstack and self._element_start is not None:
                if not self._element_starts_its_block():
                    self._hide(self._element_start, end)
                self._element_start = None

    def _element_starts_its_block(self) -> bool:
        """Whether the outermost element just stashed will be parsed at all.

        ``MarkdownInHtmlProcessor.run`` matches the element's placeholder at
        position 0 of its block, so the element is parsed only when nothing
        else precedes it since the last blank line of ``cleandoc``. Opened in
        the tail of a raw block, after text on its line, or on an indented
        line, the text in front shares its block and the element is emitted
        verbatim -- ``markdown`` attribute and all -- so its content never
        reaches the inline patterns. ``cleandoc`` ends with the placeholder
        and the ``"\\n\\n"`` the extractor appends after it.
        """

        before = "".join(self.cleandoc[:-2])
        return not before or before.endswith("\n\n")

    def handle_empty_tag(self, data: str, is_block: bool) -> None:
        pos = self._cursor
        # In the tail of a closed block (and outside any markdown element) the
        # extractor appends the tag to its raw cache; elsewhere it is hidden
        # exactly when it went into the HTML stash.
        in_tail = self.intail and not self.mdstack
        stashed = self.md.htmlStash.html_counter
        super().handle_empty_tag(data, is_block)
        if self.inraw or self._off_start is not None:
            return  # already inside a hidden span
        if in_tail or self.md.htmlStash.html_counter > stashed:
            self._hide(pos, pos + len(data))

    def close(self) -> None:
        # Flush what ``feed`` left while positions are still tracked, then
        # let the extractor close unclosed blocks and elements at EOF.
        self.goahead(True)
        self._at_eof = True
        super().close()
        for start in (self._raw_start, self._off_start):
            if start is not None:
                self._hide(start, len(self.source))


def _strip_html_blocks(text: str) -> str:
    extractor = _HiddenSpanExtractor(Markdown(), text)
    extractor.feed(text)
    extractor.close()
    out: list[str] = []
    pos = 0
    for start, end in sorted(extractor.hidden):
        if end <= pos:
            continue
        start = max(start, pos)
        out.append(text[pos:start])
        out.append(_blank_lines(text[start:end]))
        pos = end
    out.append(text[pos:])
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


def _blank_block_math(block: str) -> str:
    """``block`` with its math blanked, in python-markdown's processor order.

    Arithmatex (priority 79.9) tests the whole block first. Only when that
    fails does a heading (70) or, failing that, a thematic break (50) split
    the block, and each side is then parsed as a block of its own.
    """

    if block.strip() and _is_block_math(block):
        return _blank_lines(block)
    lines = block.split("\n")
    for splitter in _BLOCK_SPLITTERS:
        for index, line in enumerate(lines):
            if splitter.match(_LINE_PREFIX.sub("", line, count=1)):
                sides = [lines[:index], lines[index + 1 :]]
                before, after = (_blank_block_math("\n".join(s)) if s else None for s in sides)
                return "\n".join(part for part in (before, line, after) if part is not None)
    return block


def _strip_block_math(markdown: str) -> str:
    # ``re.split`` with a capturing group keeps the blank-line separators at
    # the odd indices, so the blocks can be blanked in place.
    parts = _BLANK_LINE_SPLIT.split(markdown)
    for index in range(0, len(parts), 2):
        parts[index] = _blank_block_math(parts[index])
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
