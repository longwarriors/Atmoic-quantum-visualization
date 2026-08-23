"""Byte-level integrity gates for the Markdown corpus.

``tests/test_bibliography.py`` reads the docs with ``read_text()`` (universal
newlines) and tolerates ``\\r``, so it cannot see the corruption class that
actually hit this repository: a ``\\r``/``\\n`` escape inside LaTeX (``\\rho``,
``\\nabla``) being interpreted by a tool and written back as a raw CR/LF byte.
The symptoms are a lone CR in the file, a formula split across two lines, and
a Markdown table row that silently gains or loses cells. These gates read the
raw bytes and fail on each symptom independently.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
ROOT_LEVEL_DOCS = ("README.md", "CONTRIBUTING.md", "VALIDATION.md")

# Only ``\t`` and ``\n`` are legitimate C0 bytes in a Markdown source. A lone or
# paired ``\r`` is a defect here: the repository normalises to LF, and a CR is
# the fingerprint of a corrupted ``\r...`` LaTeX command.
ALLOWED_CONTROL_BYTES = frozenset({0x09, 0x0A})

# LaTeX commands whose first letter is a C escape letter (\a \b \f \n \r \t \v).
# When a tool interprets the escape the command loses its first letter and the
# remainder lands right after a control byte -- at the start of the next line
# for ``\n``/``\r``. Keep the fragments specific enough that ordinary prose
# cannot trigger them by accident at a line start.
CORRUPTIBLE_COMMANDS = (
    "alpha",
    "angle",
    "approx",
    "bar",
    "beta",
    "begin",
    "boldsymbol",
    "frac",
    "forall",
    "nabla",
    "neq",
    "nu",
    "rangle",
    "rho",
    "right",
    "tau",
    "text",
    "theta",
    "tilde",
    "times",
    "varepsilon",
    "vec",
    "vert",
)
# A "chunk" is a maximal run of non-control bytes: a line, or what is left of
# one after a stray CR / form feed has cut it.
NON_CONTROL_RUN = re.compile(rb"[^\x00-\x1f]+")

TABLE_ROW = re.compile(r"^\s*\|")
INLINE_MATH = re.compile(r"\$(?P<body>[^$]+?)\$")


class OrphanPatterns(NamedTuple):
    """Compiled detectors for the fragments a corrupted escape leaves behind."""

    # A fragment only counts at the very start of a chunk (the byte after the
    # corrupted escape) or directly after a character that, in a formula, would
    # precede a command: ``/``, ``{``, ``=``, ``(``. It must not continue as a
    # word.
    at_chunk_start: re.Pattern[str]
    after_operator: re.Pattern[str]


def orphan_fragments(commands: Iterable[str]) -> tuple[str, ...]:
    """The fragment each command leaves once its escape letter is consumed."""

    return tuple(sorted({command[1:] for command in commands}, key=len, reverse=True))


def compile_orphan_patterns(fragments: Iterable[str]) -> OrphanPatterns:
    alternation = "|".join(re.escape(fragment) for fragment in fragments)
    return OrphanPatterns(
        at_chunk_start=re.compile(rf"^(?:{alternation})(?![A-Za-z])"),
        after_operator=re.compile(rf"[/{{=(](?:{alternation})(?![A-Za-z])"),
    )


ORPHAN_PATTERNS = compile_orphan_patterns(orphan_fragments(CORRUPTIBLE_COMMANDS))


def _markdown_sources() -> list[Path]:
    paths = sorted((ROOT / "docs").rglob("*.md"))
    paths.extend(ROOT / name for name in ROOT_LEVEL_DOCS if (ROOT / name).exists())
    return paths


def _line_of(data: bytes, offset: int) -> int:
    return data.count(b"\n", 0, offset) + 1


def control_byte_violations(data: bytes) -> list[str]:
    return [
        f"{_line_of(data, offset)}: byte 0x{byte:02X}"
        for offset, byte in enumerate(data)
        if byte < 0x20 and byte not in ALLOWED_CONTROL_BYTES
    ]


def orphan_fragment_violations(
    data: bytes, patterns: OrphanPatterns = ORPHAN_PATTERNS
) -> list[str]:
    # Split on every control byte (not just LF) so a fragment that follows a
    # lone CR or a form feed is still seen "at the start of a line".
    violations: list[str] = []
    for chunk in NON_CONTROL_RUN.finditer(data):
        text = chunk.group().decode("utf-8")
        start_hit = patterns.at_chunk_start.search(text)
        # Operators only indicate LaTeX context when the line is a formula.
        operator_hit = patterns.after_operator.search(text) if "$" in text else None
        hit = start_hit or operator_hit
        if hit is not None:
            violations.append(f"{_line_of(data, chunk.start())}: {hit.group(0)!r} in {text[:60]!r}")
    return violations


def test_markdown_sources_exist() -> None:
    assert len(_markdown_sources()) > len(ROOT_LEVEL_DOCS)


def test_markdown_sources_contain_only_tab_and_newline_control_bytes() -> None:
    violations: list[str] = []
    for path in _markdown_sources():
        violations.extend(
            f"{path.relative_to(ROOT)}:{hit}" for hit in control_byte_violations(path.read_bytes())
        )
    assert not violations, "control bytes other than TAB/LF:\n" + "\n".join(violations)


def test_markdown_sources_have_no_orphaned_latex_fragments() -> None:
    violations: list[str] = []
    for path in _markdown_sources():
        violations.extend(
            f"{path.relative_to(ROOT)}:{hit}"
            for hit in orphan_fragment_violations(path.read_bytes())
        )
    assert not violations, "orphaned LaTeX fragments (escape corruption):\n" + "\n".join(violations)


def test_table_rows_do_not_contain_unescaped_pipes_inside_math() -> None:
    # Python-Markdown splits table cells on ``|`` before inline math runs, so a
    # raw ``|`` inside ``$...$`` on a table row becomes a cell separator.
    violations: list[str] = []
    for path in _markdown_sources():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not TABLE_ROW.match(line):
                continue
            unescaped = line.replace("\\|", "").replace("\\$", "")
            for match in INLINE_MATH.finditer(unescaped):
                if "|" in match.group("body"):
                    violations.append(f"{path.relative_to(ROOT)}:{number}: {match.group(0)}")
    assert not violations, "unescaped '|' inside $...$ on a table row:\n" + "\n".join(violations)
