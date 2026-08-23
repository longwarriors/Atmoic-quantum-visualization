"""Gates that make the citation checks truthful.

Unlike ``tests/test_references.py`` this module never ``importorskip``s: the
whole suite must error loudly when the docs dependency group is missing,
because a skipped gate that nobody notices is indistinguishable from a passing
one.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import markdown  # the docs dependency group; deliberately not importorskip
import pytest

from quviz.docs.bibliography import BibEntry, parse_bibtex_file
from quviz.docs.pins import validate_source_pins
from quviz.docs.scan import cited_keys_in, strip_non_prose

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_reference_index.py"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


render_reference_index = _load_script(SCRIPT)


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


# --- the generated index must be LF on every platform, and --check must see CRLF ---


def test_index_is_written_with_lf_line_endings_on_every_platform(tmp_path: Path) -> None:
    # On Windows a text-mode write turns every LF into CRLF, and the byte-level
    # docs gate (tests/test_docs_integrity.py) then rejects the generated file.
    rendered = render_reference_index.render(parse_bibtex_file(ROOT / "references.bib"))
    path = tmp_path / "references" / "index.md"
    render_reference_index.write_index(path, rendered)
    data = path.read_bytes()
    assert b"\r" not in data
    assert data == rendered.encode("utf-8")


def test_check_reports_a_crlf_copy_of_the_current_index_as_stale(tmp_path: Path) -> None:
    # Universal-newline reading would make a CRLF index compare equal and pass
    # --check while the docs gate fails on the same bytes.
    rendered = render_reference_index.render(parse_bibtex_file(ROOT / "references.bib"))
    path = tmp_path / "index.md"
    path.write_bytes(rendered.replace("\n", "\r\n").encode("utf-8"))
    assert not render_reference_index.index_is_current(path, rendered)
    path.write_bytes(rendered.encode("utf-8"))
    assert render_reference_index.index_is_current(path, rendered)
    assert not render_reference_index.index_is_current(tmp_path / "missing.md", rendered)


# --- C2: source-audit entries must be pinned, and the pin must be coherent ---

SHA = "a351de1adbcdd14bb4d12dd50dff534fd0cb595f"
OTHER_SHA = "ed6684735f63f3678a1538790de9bc342ac8d799"


def _entry(key: str, **fields: str) -> BibEntry:
    fields.setdefault("keywords", "source-audit,software")
    return BibEntry(entry_type="software", key=key, fields=fields, authors=())


def test_commit_placeholder_is_rejected() -> None:
    entry = _entry("x", url=f"https://github.com/o/r/blob/{SHA}/f.py", commit="{latest}")
    messages = validate_source_pins([entry])
    assert len(messages) == 1
    assert "x" in messages[0] and "hex" in messages[0]


def test_url_sha_must_match_commit_field() -> None:
    entry = _entry("x", url=f"https://github.com/o/r/blob/{SHA}/f.py", commit=OTHER_SHA)
    messages = validate_source_pins([entry])
    assert len(messages) == 1
    assert SHA[:12] in messages[0] and OTHER_SHA[:12] in messages[0]


def test_gitlab_entry_without_commit_is_rejected() -> None:
    entry = _entry("x", url="https://gitlab.com/o/r/-/blob/main/f.py")
    messages = validate_source_pins([entry])
    assert any("commit" in message for message in messages)


def test_blob_url_with_matching_sha_passes() -> None:
    entry = _entry("x", url=f"https://github.com/o/r/blob/{SHA}/f.py", commit=SHA)
    assert validate_source_pins([entry]) == []


def test_abbreviated_commit_consistent_with_url_sha_passes() -> None:
    entry = _entry("x", url=f"https://github.com/o/r/tree/{SHA}", commit=SHA[:12])
    assert validate_source_pins([entry]) == []


def test_tag_url_requires_a_version_field_naming_the_tag() -> None:
    url = "https://github.com/o/r/releases/tag/2.0.0"
    assert any("version" in m for m in validate_source_pins([_entry("x", url=url, commit=SHA)]))
    mismatched = _entry("x", url=url, commit=SHA, version="1.0.0")
    assert any("version" in m for m in validate_source_pins([mismatched]))
    assert validate_source_pins([_entry("x", url=url, commit=SHA, version="2.0.0")]) == []


def test_branch_url_is_treated_like_a_tag_and_needs_version() -> None:
    entry = _entry("x", url="https://github.com/o/r/tree/main", commit=SHA)
    assert any("version" in m for m in validate_source_pins([entry]))


def test_gitlab_tag_and_codeberg_commit_urls_are_understood() -> None:
    gitlab = _entry("g", url="https://gitlab.com/o/r/-/tags/v1.2", commit=SHA, version="v1.2")
    codeberg = _entry("c", url=f"https://codeberg.org/o/r/src/commit/{SHA}/f.py", commit=SHA)
    assert validate_source_pins([gitlab, codeberg]) == []
    wrong = _entry("c", url=f"https://codeberg.org/o/r/src/commit/{SHA}/f.py", commit=OTHER_SHA)
    assert validate_source_pins([wrong]) != []


def test_non_code_host_source_audit_needs_an_access_date() -> None:
    article = _entry("a", url="https://example.org/post", keywords="source-audit,teaching")
    assert any("urldate" in m for m in validate_source_pins([article]))
    dated = _entry(
        "a", url="https://example.org/post", urldate="2026-08-22", keywords="source-audit"
    )
    assert validate_source_pins([dated]) == []
    malformed = _entry(
        "a", url="https://example.org/post", urldate="Aug 2026", keywords="source-audit"
    )
    assert any("urldate" in m for m in validate_source_pins([malformed]))


def test_source_audit_without_url_needs_a_doi() -> None:
    bare = _entry("p", keywords="source-audit,chemistry")
    assert any("doi" in m for m in validate_source_pins([bare]))
    paper = _entry("p", keywords="source-audit,chemistry", doi="10.1021/ed084p1882")
    assert validate_source_pins([paper]) == []


def test_entries_not_tagged_source_audit_are_ignored() -> None:
    entry = _entry("x", url="https://github.com/o/r", keywords="software,visualization")
    assert validate_source_pins([entry]) == []


def test_repository_bibliography_has_coherent_source_pins() -> None:
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    assert validate_source_pins(bibliography.entries.values()) == []
