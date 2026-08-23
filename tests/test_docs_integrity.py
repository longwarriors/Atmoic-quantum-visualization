"""Byte-level integrity gates for the Markdown corpus.

A text-level check that reads the docs with ``read_text()`` (universal
newlines) and tolerates ``\\r`` cannot see the corruption class that actually
hit this repository: a ``\\r``/``\\n``/``\\t`` escape inside LaTeX (``\\rho``,
``\\nabla``, ``\\theta``) being interpreted by a tool and written back as a raw
CR/LF/TAB byte. The symptoms are a lone CR or TAB in the file, a formula split
across two lines, and a Markdown table row that silently gains or loses cells.
These gates read the raw bytes and fail on each symptom independently.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
ROOT_LEVEL_DOCS = ("README.md", "CONTRIBUTING.md", "VALIDATION.md")

# Only ``\n`` is a legitimate C0 byte in a Markdown source. No tracked Markdown
# file contains a TAB, so a TAB is a defect exactly like a lone or paired CR:
# the repository normalises to LF, and a CR / TAB is the fingerprint of a
# corrupted ``\r...`` / ``\t...`` LaTeX command (``\rho`` -> CR + ``ho``,
# ``\theta`` -> TAB + ``heta``).
ALLOWED_CONTROL_BYTES = frozenset({0x0A})

# LaTeX commands whose first letter is a C escape letter (\a \b \f \n \r \t \v).
# When a tool interprets the escape the command loses its first letter and the
# remainder lands right after a control byte -- at the start of the next line
# for ``\n``/``\r``. The fragment set is the union of this static seed and
# every such command actually present in the corpus (see
# ``corpus_orphan_patterns``), so the list cannot drift behind the docs.
ESCAPE_LETTER_COMMAND = re.compile(r"\\([abfnrtv][A-Za-z]+)")
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


# Fragments shorter than this (``u`` from ``\nu``, ``ar`` from ``\bar``, ``e``
# from ``\ne``, ``ho`` from ``\rho``) are ordinary prose far too often
# (``$\mathbf{u}$``, ``$x=u$``, a line starting with ``ar ``) to be evidence on
# their own. For ``\a \b \f \r \t \v`` commands the control byte left behind is
# the evidence and the byte check reports it; a short fragment is only reported
# when it is immediately followed by something that can only continue a formula.
MIN_FRAGMENT_LENGTH = 3


class OrphanPatterns(NamedTuple):
    """Compiled detectors for the fragments a corrupted escape leaves behind."""

    # A fragment only counts at the very start of a chunk (the byte after the
    # corrupted escape) or directly after a character that, in a formula, would
    # precede a command: ``/``, ``{``, ``=``, ``(``. It must not continue as a
    # word.
    at_chunk_start: re.Pattern[str]
    after_operator: re.Pattern[str]
    # Short fragments: chunk start only, and only when glued to ``$``, ``}``,
    # ``_``, ``^``, ``\`` or a digit (``\nu$``, ``\nu_0``, ``\ne0``).
    short_at_chunk_start: re.Pattern[str] | None


def escape_letter_commands(text: str) -> set[str]:
    """Every ``\\[abfnrtv]...`` command in ``text`` (without the backslash)."""

    return set(ESCAPE_LETTER_COMMAND.findall(text))


def escape_letter_commands_in_corpus() -> set[str]:
    commands: set[str] = set()
    for path in _markdown_sources():
        commands |= escape_letter_commands(path.read_text(encoding="utf-8"))
    return commands


def orphan_fragments(commands: Iterable[str]) -> tuple[str, ...]:
    """The fragment each command leaves once its escape letter is consumed."""

    return tuple(sorted({command[1:] for command in commands}, key=len, reverse=True))


def compile_orphan_patterns(fragments: Iterable[str]) -> OrphanPatterns:
    long = [fragment for fragment in fragments if len(fragment) >= MIN_FRAGMENT_LENGTH]
    short = [fragment for fragment in fragments if len(fragment) < MIN_FRAGMENT_LENGTH]
    alternation = "|".join(re.escape(fragment) for fragment in long)
    short_alternation = "|".join(re.escape(fragment) for fragment in short)
    return OrphanPatterns(
        at_chunk_start=re.compile(rf"^(?:{alternation})(?![A-Za-z])"),
        after_operator=re.compile(rf"[/{{=(](?:{alternation})(?![A-Za-z])"),
        short_at_chunk_start=(
            re.compile(rf"^(?:{short_alternation})(?=[$}}_^\\0-9])") if short else None
        ),
    )


def corpus_orphan_patterns() -> OrphanPatterns:
    """Patterns for the static seed plus every escape-letter command in the docs."""

    commands = set(CORRUPTIBLE_COMMANDS) | escape_letter_commands_in_corpus()
    return compile_orphan_patterns(orphan_fragments(commands))


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


def orphan_fragment_violations(data: bytes, patterns: OrphanPatterns) -> list[str]:
    # Split on every control byte (not just LF) so a fragment that follows a
    # lone CR or a form feed is still seen "at the start of a line".
    violations: list[str] = []
    in_display_math = False
    for chunk in NON_CONTROL_RUN.finditer(data):
        text = chunk.group().decode("utf-8")
        hit = patterns.at_chunk_start.search(text)
        if hit is None and patterns.short_at_chunk_start is not None:
            hit = patterns.short_at_chunk_start.search(text)
        # Operators only indicate LaTeX context when the line is a formula:
        # inline ``$...$`` on this line, or a line inside a ``$$ ... $$`` block.
        if hit is None and ("$" in text or in_display_math):
            hit = patterns.after_operator.search(text)
        if hit is not None:
            violations.append(f"{_line_of(data, chunk.start())}: {hit.group(0)!r} in {text[:60]!r}")
        # A line with an odd number of ``$$`` opens or closes a display block.
        if text.count("$$") % 2 == 1:
            in_display_math = not in_display_math
    return violations


def test_markdown_sources_exist() -> None:
    assert len(_markdown_sources()) > len(ROOT_LEVEL_DOCS)


def test_markdown_sources_contain_only_newline_control_bytes() -> None:
    violations: list[str] = []
    for path in _markdown_sources():
        violations.extend(
            f"{path.relative_to(ROOT)}:{hit}" for hit in control_byte_violations(path.read_bytes())
        )
    assert not violations, "control bytes other than LF:\n" + "\n".join(violations)


def test_markdown_sources_have_no_orphaned_latex_fragments() -> None:
    # Also the proof that the corpus-derived fragment set has no false
    # positives on the current corpus.
    patterns = corpus_orphan_patterns()
    violations: list[str] = []
    for path in _markdown_sources():
        violations.extend(
            f"{path.relative_to(ROOT)}:{hit}"
            for hit in orphan_fragment_violations(path.read_bytes(), patterns)
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


# --- red/green cases for the gate itself --------------------------------------


def test_tab_byte_is_a_control_byte_violation() -> None:
    # ``\to``, ``\tfrac`` and ``\theta`` corrupt to TAB + ``o``/``frac``/``heta``.
    # No tracked Markdown file contains a TAB, so a TAB is a corruption
    # fingerprint exactly like CR and must not be tolerated.
    assert control_byte_violations(b"$a \to b$\n") == ["1: byte 0x09"]
    assert control_byte_violations(b"$a \\to b$\n") == []


def test_escape_letter_commands_are_harvested_from_markdown() -> None:
    text = "$\\rho \\rightarrow \\rvert$ and `\\nabla` but not \\alpha or \\Delta"
    assert escape_letter_commands(text) == {"rho", "rightarrow", "rvert", "nabla", "alpha"}


def test_every_escape_letter_command_in_the_corpus_is_covered() -> None:
    # The static list cannot drift behind the corpus: each ``\[abfnrtv]...``
    # command actually used in the docs must be detected once its escape
    # letter has been consumed (LF + fragment at a line start).
    patterns = corpus_orphan_patterns()
    corpus_commands = escape_letter_commands_in_corpus()
    assert corpus_commands, "corpus scan found no escape-letter commands"
    uncovered = sorted(
        command
        for command in corpus_commands
        if not orphan_fragment_violations(f"$\n{command[1:]}$\n".encode(), patterns)
    )
    assert not uncovered, f"escape-letter commands not covered by the orphan gate: {uncovered}"


def test_injected_rightarrow_and_rvert_corruption_is_caught() -> None:
    patterns = corpus_orphan_patterns()
    # ``\r`` -> LF happens when a CRLF-normalising tool rewrites the CR.
    assert orphan_fragment_violations(b"$a \nightarrow b$\n", patterns) == [
        "2: 'ightarrow' in 'ightarrow b$'"
    ]
    assert orphan_fragment_violations(b"$\rvert x \rvert$\n", patterns)
    assert orphan_fragment_violations(b"$\nvert x \nvert$\n", patterns)
    assert orphan_fragment_violations(b"$a \\rightarrow b$ $\\rvert x\\rvert$\n", patterns) == []


def test_one_and_two_letter_fragments_do_not_fire_on_ordinary_markdown() -> None:
    # ``u`` (\nu), ``ar`` (\bar) and ``e`` (\ne) are too short to be evidence
    # on their own; the control byte left behind is the evidence instead.
    patterns = corpus_orphan_patterns()
    for sample in (b"$\\mathbf{u}$\n", b"$x=u$\n", b"ar is a prefix\n", b"e.g. $x=1$\n"):
        assert orphan_fragment_violations(sample, patterns) == [], sample


def test_short_fragments_still_fire_when_immediately_followed_by_math() -> None:
    # ``\nu`` / ``\ne`` corrupt to LF + ``u`` / ``e`` -- the byte check cannot
    # see an LF, so a short fragment is still reported when what follows it can
    # only be the continuation of a formula.
    patterns = corpus_orphan_patterns()
    assert orphan_fragment_violations(b"$\nu$\n", patterns)
    assert orphan_fragment_violations(b"$\nu_0 = 1$\n", patterns)
    assert orphan_fragment_violations(b"$m\ne0$\n", patterns)
    # Known limit: a short fragment followed by a space (``$i\ne j$``) is
    # indistinguishable from prose and is not reported.
    assert orphan_fragment_violations(b"$i\ne j$\n", patterns) == []


def test_operator_fragments_are_checked_inside_display_math_blocks() -> None:
    # ``\cos(\theta)`` -> TAB + ``heta`` -> a whitespace-normalising tool drops
    # the TAB -> ``cos(heta)``. The line carries no ``$`` of its own.
    patterns = corpus_orphan_patterns()
    corrupted = b"$$\nx = r\\cos(heta)\n$$\n"
    assert orphan_fragment_violations(corrupted, patterns) == ["2: '(heta' in 'x = r\\\\cos(heta)'"]
    # The same text in prose is not a formula and must stay silent.
    assert orphan_fragment_violations(b"x = r\\cos(heta)\n", patterns) == []
    # A closed block stops the context.
    assert orphan_fragment_violations(b"$$\nx\n$$\nx = r\\cos(heta)\n", patterns) == []
