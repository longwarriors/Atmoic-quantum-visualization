"""Small BibTeX reader for QuViz's canonical reference registry.

The implementation intentionally supports the conservative BibTeX subset used
by ``references.bib``: brace- or quote-delimited scalar fields and ``and``-
separated authors. It keeps the documentation build independent of Pandoc while
making citation-key validation available to tests and maintenance scripts.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Person:
    """A display-oriented BibTeX author."""

    first_names: tuple[str, ...] = ()
    last_names: tuple[str, ...] = ()
    literal: str | None = None


@dataclass(frozen=True, slots=True)
class BibEntry:
    """A parsed BibTeX entry."""

    entry_type: str
    key: str
    fields: dict[str, str]
    authors: tuple[Person, ...]


@dataclass(frozen=True, slots=True)
class Bibliography:
    """Keyed collection of parsed entries."""

    entries: dict[str, BibEntry]


# Each tuple is a group of alternatives: at least one non-empty field in the
# group is required.  Keeping this policy next to the parser gives the index
# generator and tests one definition of "complete enough to publish" without
# making the deliberately small parser reject partial entries used by callers.
ENTRY_TYPE_REQUIRED_FIELDS: Mapping[str, tuple[tuple[str, ...], ...]] = {
    "article": (
        ("author",),
        ("title",),
        ("journal",),
        ("year",),
        ("volume",),
        ("pages",),
    ),
    "book": (
        ("author", "editor"),
        ("title",),
        ("publisher",),
        ("year",),
        ("edition",),
    ),
    "incollection": (
        ("author",),
        ("title",),
        ("booktitle",),
        ("editor",),
        ("publisher",),
        ("year",),
        ("pages",),
    ),
    "online": (("author", "editor", "organization"), ("title",), ("url",), ("urldate",)),
    "software": (
        ("author", "editor", "organization"),
        ("title",),
        ("url",),
        ("urldate",),
        ("version", "commit"),
    ),
}

# QuViz additionally requires a discovery tag and a persistent target for
# every canonical entry, independent of its BibTeX type.
COMMON_REQUIRED_FIELDS: tuple[tuple[str, ...], ...] = (
    ("keywords",),
    ("doi", "url"),
)


def keywords(entry: BibEntry) -> set[str]:
    """The comma-separated ``keywords`` field as a set, whitespace stripped.

    Shared by the index renderer, the pin validator and the orphan gate so
    ``keywords = {tooling}``, ``{ tooling }`` and ``{software, tooling}`` all
    mean the same thing everywhere.
    """

    return {value.strip() for value in entry.fields.get("keywords", "").split(",")} - {""}


def required_field_problems(bibliography: Bibliography) -> list[str]:
    """Return missing-field problems under QuViz's supported entry policy.

    A field group such as ``("author", "editor")`` means that either field is
    sufficient.  Unsupported entry types are rejected explicitly: otherwise a
    misspelled ``@article`` would silently bypass every type-specific check.
    """

    problems: list[str] = []
    for key, entry in bibliography.entries.items():
        type_groups = ENTRY_TYPE_REQUIRED_FIELDS.get(entry.entry_type)
        if type_groups is None:
            problems.append(f"{key}: unsupported entry type {entry.entry_type!r}")
            continue
        for alternatives in (*type_groups, *COMMON_REQUIRED_FIELDS):
            if not any(entry.fields.get(field, "").strip() for field in alternatives):
                label = " or ".join(alternatives)
                problems.append(f"{key} ({entry.entry_type}): missing {label}")
    return problems


def _skip_space(text: str, index: int) -> int:
    while index < len(text) and text[index].isspace():
        index += 1
    return index


def _read_balanced(text: str, index: int, opening: str, closing: str) -> tuple[str, int]:
    if text[index] != opening:
        raise ValueError(f"expected {opening!r} at offset {index}")
    depth = 1
    cursor = index + 1
    start = cursor
    while cursor < len(text):
        char = text[cursor]
        if char == "\\":
            cursor += 2
            continue
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return text[start:cursor], cursor + 1
        cursor += 1
    raise ValueError(f"unclosed {opening!r} starting at offset {index}")


def _read_quoted(text: str, index: int) -> tuple[str, int]:
    cursor = index + 1
    result: list[str] = []
    while cursor < len(text):
        char = text[cursor]
        if char == "\\" and cursor + 1 < len(text):
            result.extend((char, text[cursor + 1]))
            cursor += 2
            continue
        if char == '"':
            return "".join(result), cursor + 1
        result.append(char)
        cursor += 1
    raise ValueError(f"unclosed quote starting at offset {index}")


def _strip_outer_braces(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == "{" and value[-1] == "}":
        depth = 0
        for index, char in enumerate(value):
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0 and index != len(value) - 1:
                    return value
        return value[1:-1].strip()
    return value


def _split_authors(value: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    start = 0
    cursor = 0
    while cursor < len(value):
        char = value[cursor]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        elif depth == 0 and value[cursor : cursor + 5].lower() == " and ":
            parts.append(value[start:cursor].strip())
            cursor += 5
            start = cursor
            continue
        cursor += 1
    tail = value[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _parse_person(value: str) -> Person:
    value = value.strip()
    if value.startswith("{") and value.endswith("}"):
        return Person(literal=_strip_outer_braces(value))
    if "," in value:
        last, first = (part.strip() for part in value.split(",", maxsplit=1))
        return Person(tuple(first.split()), tuple(last.split()))
    tokens = value.split()
    if len(tokens) <= 1:
        return Person(last_names=tuple(tokens))
    return Person(first_names=tuple(tokens[:-1]), last_names=(tokens[-1],))


def _parse_entry_body(entry_type: str, body: str) -> BibEntry:
    comma = body.find(",")
    if comma < 1:
        raise ValueError(f"BibTeX {entry_type} entry has no key separator")
    key = body[:comma].strip()
    fields: dict[str, str] = {}
    cursor = comma + 1
    while cursor < len(body):
        cursor = _skip_space(body, cursor)
        while cursor < len(body) and body[cursor] == ",":
            cursor = _skip_space(body, cursor + 1)
        if cursor >= len(body):
            break
        name_start = cursor
        while cursor < len(body) and (body[cursor].isalnum() or body[cursor] in "_-:"):
            cursor += 1
        name = body[name_start:cursor].strip().lower()
        cursor = _skip_space(body, cursor)
        if not name or cursor >= len(body) or body[cursor] != "=":
            raise ValueError(f"invalid field near offset {cursor} in {key}")
        cursor = _skip_space(body, cursor + 1)
        if cursor >= len(body):
            raise ValueError(f"missing value for {name} in {key}")
        if body[cursor] == "{":
            value, cursor = _read_balanced(body, cursor, "{", "}")
        elif body[cursor] == '"':
            value, cursor = _read_quoted(body, cursor)
        else:
            value_start = cursor
            while cursor < len(body) and body[cursor] != ",":
                cursor += 1
            value = body[value_start:cursor].strip()
        fields[name] = value.strip()
    author_value = fields.get("author", "")
    authors = tuple(_parse_person(author) for author in _split_authors(author_value))
    return BibEntry(entry_type=entry_type.lower(), key=key, fields=fields, authors=authors)


def parse_bibtex(text: str) -> Bibliography:
    """Parse QuViz's supported BibTeX subset from text."""

    entries: dict[str, BibEntry] = {}
    cursor = 0
    while cursor < len(text):
        at = text.find("@", cursor)
        if at < 0:
            break
        type_start = at + 1
        type_end = type_start
        while type_end < len(text) and (text[type_end].isalnum() or text[type_end] in "_-:"):
            type_end += 1
        entry_type = text[type_start:type_end]
        index = _skip_space(text, type_end)
        if not entry_type or index >= len(text) or text[index] not in "{(":
            cursor = at + 1
            continue
        opening = text[index]
        closing = "}" if opening == "{" else ")"
        body, cursor = _read_balanced(text, index, opening, closing)
        entry = _parse_entry_body(entry_type, body)
        if entry.key in entries:
            raise ValueError(f"duplicate BibTeX key: {entry.key}")
        entries[entry.key] = entry
    if not entries:
        raise ValueError("no BibTeX entries found")
    return Bibliography(entries)


def parse_bibtex_file(path: str | Path) -> Bibliography:
    """Parse a UTF-8 BibTeX file."""

    return parse_bibtex(Path(path).read_text(encoding="utf-8"))
