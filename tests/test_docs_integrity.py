"""Byte-level integrity gates for the Markdown corpus.

A text-level check that reads the docs with ``read_text()`` (universal
newlines) and tolerates ``\\r`` cannot see the corruption class that actually
hit this repository: a ``\\r``/``\\n``/``\\t`` escape inside LaTeX (``\\rho``,
``\\nabla``, ``\\theta``) being interpreted by a tool and written back as a raw
CR/LF/TAB byte. The symptoms are a lone CR or TAB in the file and a formula
split across two lines. These gates read the raw bytes and fail on each
symptom independently.

A third gate catches a different defect at its cause: an unescaped ``|``
inside ``$...$`` on a ``|``-prefixed table row, which Python-Markdown would
split into an extra cell. It does not scan ``\\(...\\)`` math, and a row
without a leading ``|`` is not scanned at all.
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

# Characters that precede a command inside a formula. A fragment directly
# after one of these (optionally separated by whitespace, because a
# whitespace-normalising editor turns the TAB of a corrupted ``\t...`` into
# spaces) is evidence -- but only on a formula line, see
# ``orphan_fragment_violations``.
FORMULA_OPERATORS = "/{=(+-,^_$"
# Commands whose brace argument is prose: ``\text{ext}``, ``\mathrm{vert}``,
# ``\operatorname{angle}`` are legitimate, so a ``{`` opened by one of these
# is not an operator. Known limit: a corrupted escape *inside* such an
# argument (``\text{\theta}`` -> ``\text{heta}``) is not reported.
TEXT_ARGUMENT_COMMANDS = ("text", "textbf", "mathrm", "mathbf", "mathit", "operatorname")
# A fenced code block (``` or ~~~, any indentation, any info string). Code is
# not scanned: a sample may start a line with ``eta`` / ``frac`` / ``vert``
# or show a literal ``$$``.
FENCE = re.compile(r"^\s*(?P<fence>`{3,}|~{3,})")
# An inline code span is code too: ``test_x_angle_y`` must not read as the
# operator ``_`` + ``angle``, and a literal ``$`` / ``$$`` in a span is not a
# formula marker.
INLINE_CODE = re.compile(r"`+[^`]*`+")


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
    # corrupted escape) or after one of ``FORMULA_OPERATORS`` (plus optional
    # whitespace), excluding a ``{`` that opens the argument of a
    # ``TEXT_ARGUMENT_COMMANDS`` command. It must not continue as a word.
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
    # ``{`` counts unless a text-argument command immediately precedes it
    # (one fixed-width lookbehind per command; ``re`` has no variable-width
    # lookbehind).
    not_text_argument = "".join(rf"(?<!\\{command})" for command in TEXT_ARGUMENT_COMMANDS)
    other_operators = re.escape(FORMULA_OPERATORS.replace("{", ""))
    operator = rf"(?:{not_text_argument}\{{|[{other_operators}])"
    return OrphanPatterns(
        at_chunk_start=re.compile(rf"^(?:{alternation})(?![A-Za-z])"),
        after_operator=re.compile(rf"{operator}\s*(?:{alternation})(?![A-Za-z])"),
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


def _closes_fence(text: str, open_fence: str) -> bool:
    """CommonMark: same fence character, at least as long, nothing after it."""

    fence = FENCE.match(text)
    return (
        fence is not None
        and fence.group("fence")[0] == open_fence[0]
        and len(fence.group("fence")) >= len(open_fence)
        and not text[fence.end() :].strip()
    )


def orphan_fragment_violations(data: bytes, patterns: OrphanPatterns) -> list[str]:
    # Split on every control byte (not just LF) so a fragment that follows a
    # lone CR or a form feed is still seen "at the start of a line".
    violations: list[str] = []
    in_display_math = False
    open_fence: str | None = None
    for chunk in NON_CONTROL_RUN.finditer(data):
        text = chunk.group().decode("utf-8")
        # Fenced code is skipped entirely, and a fence boundary (either way)
        # resets the display-math state: a ``$$`` shown inside a fence must not
        # open a block for the rest of the file.
        if open_fence is not None:
            if _closes_fence(text, open_fence):
                open_fence = None
                in_display_math = False
            continue
        if (fence := FENCE.match(text)) is not None:
            open_fence = fence.group("fence")
            in_display_math = False
            continue
        prose = INLINE_CODE.sub("", text)
        hit = patterns.at_chunk_start.search(prose)
        if hit is None and patterns.short_at_chunk_start is not None:
            hit = patterns.short_at_chunk_start.search(prose)
        # Operators only indicate LaTeX context when the line is a formula:
        # inline ``$...$`` on this line, or a line inside a ``$$ ... $$`` block.
        if hit is None and ("$" in prose or in_display_math):
            hit = patterns.after_operator.search(prose)
        if hit is not None:
            violations.append(f"{_line_of(data, chunk.start())}: {hit.group(0)!r} in {text[:60]!r}")
        # A line with an odd number of ``$$`` opens or closes a display block.
        if prose.count("$$") % 2 == 1:
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


def test_capability_summaries_do_not_regress_to_pre_slice_status() -> None:
    semantics = (ROOT / "docs/concepts/semantics.md").read_text(encoding="utf-8")
    vision = (ROOT / "docs/project/vision.md").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    home = (ROOT / "docs/index.md").read_text(encoding="utf-8")

    assert "`wavefunction_real` / `wavefunction_imag`" in semantics
    assert "节面几何 representation" in semantics
    assert "枚举中的占位" not in semantics
    assert "概率流线已经进入当前能力" in vision
    assert "设计中的 WebGPU、流线" not in vision
    for summary in (readme, home):
        assert "解析含时叠加态" in summary
        assert "平面切片" in summary


def test_live_installation_instructions_consume_committed_lockfiles() -> None:
    installation = (ROOT / "docs/getting-started/installation.md").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    historical = (ROOT / "VALIDATION.md").read_text(encoding="utf-8")

    for live_guide in (installation, readme, contributing):
        assert "uv sync --locked --all-groups" in live_guide
        assert "npm ci --no-audit --no-fund" in live_guide
    assert "\tuv sync --locked --all-groups" in makefile
    assert "\tcd web && npm ci --no-audit --no-fund" in makefile
    assert "仓库已经提交 `uv.lock` 与 `web/package-lock.json`" in installation
    assert "no longer instructions for the current checkout" in " ".join(historical.split())
    assert "uv sync --locked --all-groups" in historical
    assert "npm ci --no-audit --no-fund" in historical


def test_api_reference_does_not_call_the_high_n_slice_floor_a_validity_proof() -> None:
    api = (ROOT / "docs/reference/api.md").read_text(encoding="utf-8")
    status = (ROOT / "docs/project/status.md").read_text(encoding="utf-8")
    quality_gates = (ROOT / "docs/reference/quality-gates.md").read_text(encoding="utf-8")

    assert "不是高 $n$ 收敛性或物理准确性的证书" in api
    assert "花的是采样数" not in api
    multiplication = "\N{MULTIPLICATION SIGN}"
    minus_sign = "\N{MINUS SIGN}"
    en_dash = "\N{EN DASH}"
    assert f"active_terms {multiplication} resolution³" in api
    assert f"active_terms {multiplication} resolution²" in api
    assert f"active_terms {multiplication} [seed_filter_evaluations_per_term" in api
    assert f"seed_count {multiplication} (1 + 5(max_points {minus_sign} 1))" in api
    assert f"active_terms {multiplication} seed_count {multiplication}" not in api
    assert "seed_filter_evaluations_per_term = 21³" in api
    assert "八项态 11/12 边界" in quality_gates
    assert "八项态 12/13 边界" not in quality_gates
    assert "2,000,000 term-velocity evaluations" in api
    assert "100,000 serialized path samples" in api
    assert f"1{en_dash}96" in api
    assert f"1{en_dash}40" in api
    assert "1,024 term-seed" not in api
    assert "一维径向 oracle" in api
    assert "4s 在 81 点会被拒、97 点通过" in api
    assert "含非零激发 s 分量的多项态使用上述最细双网格门禁" in api
    assert "其他一般多项态仍只有质量/alias 诊断" in api
    assert "高 $n$ 花的是采样数而不是有效性" not in status
    assert "12s 以及 1s+12s 即使在 513 上限仍明确 fail-closed" in status
    assert "上限 1,500,000 term-pixel evaluations" in api


def test_visual_fixture_docs_do_not_call_the_derived_catalog_a_literal_table() -> None:
    """The superposition period is deterministic, but it is still arithmetic."""

    status = (ROOT / "docs/project/status.md").read_text(encoding="utf-8")
    fixture_gate = (ROOT / "tests/test_visual_fixtures.py").read_text(encoding="utf-8")

    assert "不经任何算术" not in status
    assert "no arithmetic reaches them" not in fixture_gate
    assert "period_au" in status
    assert "fixed hydrogenic energy gaps" in fixture_gate


def test_sampling_tutorial_describes_the_gated_adaptive_tail() -> None:
    sampling = (ROOT / "docs/tutorials/sampling.md").read_text(encoding="utf-8")

    assert "自适应扩展路径还需要专门的尾部回归测试" not in sampling
    assert "总质量、平均半径和整条 CDF" in sampling
    assert "`tests/test_sampling.py`" in sampling


def test_probability_flow_docs_cover_scale_covariance_and_discovery() -> None:
    quality = (ROOT / "docs/reference/quality-gates.md").read_text(encoding="utf-8")
    current = (ROOT / "docs/concepts/probability-current.md").read_text(encoding="utf-8")
    frontend = (ROOT / "docs/tutorials/frontend-rendering.md").read_text(encoding="utf-8")
    status = (ROOT / "docs/project/status.md").read_text(encoding="utf-8")

    assert "均仅在 $Z=1$ 下验证" not in quality
    assert "概率流 oracle 测试仅在 $Z=1$ 下验证" not in status
    assert "$(Z/a_\\mu)^3$" in current
    assert "服务端 orbital catalog 的 `3d-complex`" in frontend
    assert "`period_au=0` 的简并态不执行播放" in frontend
    assert "`aria-disabled`" in frontend
    assert "`aria-describedby`" in frontend
    assert "`slice_resolution_floor`" in frontend


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


def test_text_command_arguments_are_not_orphan_fragments() -> None:
    # ``\text{ext}``, ``\mathrm{vert}``, ``\operatorname{...}`` legitimately put
    # a fragment right after ``{``; the argument of a text-like command is
    # prose, not a corrupted escape. (``\operatorname{arg}`` is not a case:
    # ``arg`` is no fragment of any ``\[abfnrtv]...`` command.)
    patterns = corpus_orphan_patterns()
    for sample in (
        b"$N_{\\text{ext}}$\n",
        b"$\\mathrm{vert}$\n",
        b"$\\text{angle}$\n",
        b"$\\operatorname{ext}$\n",
        b"$\\mathbf{eta}$\n",
        b"$\\mathit{vert}$\n",
        b"$\\textbf{angle}$\n",
        b"$$\n\\text{ext}\n$$\n",
    ):
        assert orphan_fragment_violations(sample, patterns) == [], sample
    # A ``{`` that is not the argument of such a command is still an operator:
    # ``\frac{\theta}{2}`` -> ``\frac{heta}{2}``.
    assert orphan_fragment_violations(b"$\\frac{heta}{2}$\n", patterns) == [
        "1: '{heta' in '$\\\\frac{heta}{2}$'"
    ]


def test_fenced_code_blocks_are_not_scanned() -> None:
    # A code sample may start a line with ``eta`` / ``frac`` / ``vert``; that
    # is code, not a corrupted ``\beta`` / ``\tfrac`` / ``\rvert``.
    patterns = corpus_orphan_patterns()
    for sample in (
        b"```python\neta = 0.1\n```\n",
        b"~~~\nfrac = 1\n~~~\n",
        b"    ```text\n    vert = 2\n    ```\n",  # fence indented inside an admonition
        b"````md\n```\neta\n```\n````\n",  # a shorter fence inside a longer one
    ):
        assert orphan_fragment_violations(sample, patterns) == [], sample
    # A ``$$`` shown inside a fence must not open a display block for the rest
    # of the file (the line after the fence is prose).
    assert orphan_fragment_violations(b"```text\n$$\n```\nx = r\\cos(heta)\n", patterns) == []
    # Every fence boundary resets the display-math state, even one that
    # interrupts an unclosed ``$$`` block.
    assert orphan_fragment_violations(b"$$\nx\n```\n```\nx = r\\cos(heta)\n", patterns) == []
    # Scanning resumes after the closing fence.
    assert orphan_fragment_violations(b"```\nx\n```\nabla f$\n", patterns) == [
        "4: 'abla' in 'abla f$'"
    ]


def test_operator_fragments_tolerate_whitespace_and_every_formula_operator() -> None:
    # ``\cos(\theta)`` -> TAB + ``heta`` -> a whitespace-normalising editor
    # turns the TAB into spaces: ``( heta)``, ``=  rac{``. Every character
    # that precedes a command in a formula counts as an operator.
    patterns = corpus_orphan_patterns()
    assert orphan_fragment_violations(b"$x = ( heta)$\n", patterns) == [
        "1: '( heta' in '$x = ( heta)$'"
    ]
    assert orphan_fragment_violations(b"$x =  rac{1}{2}$\n", patterns) == [
        "1: '=  rac' in '$x =  rac{1}{2}$'"
    ]
    for sample in (
        b"$x + heta$\n",
        b"$x - heta$\n",
        b"$f(a, heta)$\n",
        b"$x^heta$\n",
        b"$x_heta$\n",
        b"$heta$\n",
        b"$x = 2/heta$\n",
    ):
        assert orphan_fragment_violations(sample, patterns), sample
    # Still only in a formula: the same text in prose stays silent.
    assert orphan_fragment_violations(b"x = ( heta), y - eta\n", patterns) == []


def test_inline_code_spans_are_not_scanned() -> None:
    # ``_`` is an operator, so a snake_case identifier such as
    # ``test_..._angle_ranges`` on a line that also carries ``$...$`` would
    # otherwise read as ``_angle``. Inline code is code, like a fenced block.
    patterns = corpus_orphan_patterns()
    sample = b"- $\\theta\\in[0,\\pi]$ convention -- `test_documented_angle_ranges`\n"
    assert orphan_fragment_violations(sample, patterns) == []
    # A ``$`` or ``$$`` inside a code span is neither a formula marker nor a
    # display-math delimiter.
    assert orphan_fragment_violations(b"`$x$` (heta)\n", patterns) == []
    assert orphan_fragment_violations(b"`$$` opens a block\nx = r\\cos(heta)\n", patterns) == []
    # Outside the span the line is still scanned.
    assert orphan_fragment_violations(b"`code` $x = ( heta)$\n", patterns) == [
        "1: '( heta' in '`code` $x = ( heta)$'"
    ]
