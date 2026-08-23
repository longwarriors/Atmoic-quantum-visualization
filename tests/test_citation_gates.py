"""Gates that make the citation checks truthful.

Unlike ``tests/test_references.py`` this module never ``importorskip``s: the
whole suite must error loudly when the docs dependency group is missing,
because a skipped gate that nobody notices is indistinguishable from a passing
one.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import markdown  # the docs dependency group; deliberately not importorskip
import pytest

from quviz.docs.scan import cited_keys_in, strip_non_prose

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_reference_index.py"


def test_docs_dependency_group_is_installed() -> None:
    # ``scripts/check.ps1``, ``make test`` and CI all run pytest with
    # ``--group docs``. If this import fails, the gate runner forgot it.
    assert hasattr(markdown, "Markdown")


# --- C3: the orphan / unknown-key scan must only see prose -----------------


def test_key_only_inside_backtick_fence_is_not_cited() -> None:
    text = "Prose.\n\n```markdown\nSee [@fenced-only].\n```\n\nMore prose.\n"
    assert cited_keys_in(text) == set()


def test_key_only_inside_tilde_fence_is_not_cited() -> None:
    text = "~~~\n[@tilde-only, p. 1]\n~~~\n"
    assert cited_keys_in(text) == set()


def test_key_only_inside_html_comment_is_not_cited() -> None:
    text = "Prose <!-- TODO cite [@commented-out] --> continues.\n<!--\n[@multi-line]\n-->\n"
    assert cited_keys_in(text) == set()


def test_key_only_inside_inline_code_is_not_cited() -> None:
    text = "Write `[@code-only]` to cite, or ``[@double-tick]`` with doubled ticks.\n"
    assert cited_keys_in(text) == set()


def test_key_in_prose_is_cited() -> None:
    text = "See [@prose-key, p. 4] and [@another; @third, §2].\n"
    assert cited_keys_in(text) == {"prose-key", "another", "third"}


def test_prose_citation_survives_surrounding_non_prose() -> None:
    text = (
        "```\n[@fenced]\n```\n"
        "Real claim [@real] here. <!-- [@hidden] --> And `[@code]`.\n"
        "~~~python\n[@fenced2]\n~~~\n"
    )
    assert cited_keys_in(text) == {"real"}


def test_escaped_citation_is_literal_text_not_a_citation() -> None:
    # The documented escape used by cite-sources.md / source-policy.md.
    text = r"The syntax is [\@key] or [\@key, locator]." + "\n"
    assert cited_keys_in(text) == set()


def test_fence_indented_inside_an_admonition_is_stripped() -> None:
    # python-markdown de-indents admonition bodies before parsing fences, so an
    # indented fence is still a fence, not an indented code block.
    text = (
        '!!! note "Example"\n\n    ```markdown\n    [@indented-fence]\n    ```\n\nProse [@kept].\n'
    )
    assert cited_keys_in(text) == {"kept"}


def test_unclosed_fence_swallows_the_rest_of_the_document() -> None:
    text = "Prose [@before].\n```\n[@inside]\nstill inside [@still]\n"
    assert cited_keys_in(text) == {"before"}


def test_strip_non_prose_preserves_line_count() -> None:
    text = "a\n```\nb\nc\n```\nd <!-- x\ny --> e `f`\n"
    assert strip_non_prose(text).count("\n") == text.count("\n")


def test_malformed_citation_in_prose_still_raises() -> None:
    with pytest.raises(ValueError, match="malformed"):
        cited_keys_in("See [@bad key].\n")


def test_orphan_check_reports_an_entry_cited_only_inside_a_code_block(tmp_path: Path) -> None:
    bib = tmp_path / "refs.bib"
    bib.write_text(
        "@online{only-fenced, title={A}, url={https://example.invalid/a}}\n"
        "@online{cited-for-real, title={B}, url={https://example.invalid/b}}\n",
        encoding="utf-8",
    )
    docs = tmp_path / "docs"
    (docs / "references").mkdir(parents=True)
    (docs / "page.md").write_text(
        "Prose cites [@cited-for-real].\n\n```markdown\nExample: [@only-fenced]\n```\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--check",
            "--bib",
            str(bib),
            "--docs",
            str(docs),
            "--output",
            str(docs / "references" / "index.md"),
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "orphan" in result.stderr
    assert "only-fenced" in result.stderr
    assert "cited-for-real" not in result.stderr
