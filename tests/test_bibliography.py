from __future__ import annotations

from pathlib import Path

import pytest

from quviz.docs.bibliography import (
    parse_bibtex,
    parse_bibtex_file,
    required_field_problems,
)
from quviz.docs.scan import cited_keys_in_tree, orphan_keys

ROOT = Path(__file__).resolve().parents[1]


def test_canonical_bibliography_has_expected_sources() -> None:
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    assert len(bibliography.entries) >= 20
    stark = bibliography.entries["stodolna2013stark"]
    assert stark.fields["doi"] == "10.1103/PhysRevLett.110.213001"
    assert stark.authors[0].last_names == ("Stodolna",)
    assert bibliography.entries["scipy-sph-harm-y"].authors[0].literal == "SciPy Community"
    tully = bibliography.entries["tully2013pointillist"]
    assert tully.authors[0].first_names == ("Shane", "P.")
    assert tully.authors[-1].first_names == ("Przemyslaw",)


def test_canonical_entries_have_type_required_and_persistent_metadata() -> None:
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    assert required_field_problems(bibliography) == []


def test_required_metadata_is_entry_type_aware() -> None:
    incomplete = parse_bibtex(
        """
        @article{paper, author={A. Author}, title={Paper}, year={2026},
          doi={10.1/example}, keywords={physics}}
        @online{page, author={{Docs Team}}, title={Docs},
          url={https://example.test}, keywords={software}}
        @misc{typo, author={A. Author}, title={Wrong type},
          url={https://example.test}, keywords={software}}
        """
    )
    assert required_field_problems(incomplete) == [
        "paper (article): missing journal",
        "paper (article): missing volume",
        "paper (article): missing pages",
        "page (online): missing urldate",
        "typo: unsupported entry type 'misc'",
    ]


def test_generated_index_emits_every_canonical_field() -> None:
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    rendered = (ROOT / "docs/references/index.md").read_text(encoding="utf-8")
    type_labels = {
        "article": "Journal article",
        "book": "Book",
        "incollection": "Book chapter",
        "online": "Online resource",
        "software": "Software",
    }
    for key, entry in bibliography.entries.items():
        start = rendered.index(f'<a id="{key}"></a>')
        next_entry = rendered.find('<a id="', start + 1)
        block = rendered[start:] if next_entry < 0 else rendered[start:next_entry]
        assert f"| **Type** | {type_labels[entry.entry_type]} |" in block
        assert entry.fields["title"] in block
        for field, value in entry.fields.items():
            if field == "author":
                for person in entry.authors:
                    expected = person.literal or " ".join(person.last_names)
                    assert expected in block, (key, field, expected)
            elif field == "keywords":
                for tag in value.split(","):
                    assert f"`{tag.strip()}`" in block, (key, field, tag)
            else:
                assert value.replace(r"\&", "&") in block, (key, field, value)


def test_duplicate_keys_are_rejected() -> None:
    text = "@online{x, title={A}}\n@online{x, title={B}}"
    with pytest.raises(ValueError, match="duplicate"):
        parse_bibtex(text)


def _cited_keys() -> set[str]:
    """Scan docs with the same prose-only scanner the index script uses."""

    return cited_keys_in_tree(ROOT / "docs", exclude=(ROOT / "docs" / "references" / "index.md",))


def test_all_documentation_citation_keys_exist() -> None:
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    used = _cited_keys()
    assert used
    assert used <= set(bibliography.entries)


def test_generated_reference_index_is_current_without_markdown_dependency() -> None:
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "scripts/render_reference_index.py", "--check"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_every_bibliography_entry_is_cited_or_marked_tooling() -> None:
    # The gate previously only checked used <= known, so an entry nobody cites
    # (and therefore nobody reviews) stayed invisible. Build-tooling entries are
    # exempt because they document the toolchain, not a scientific claim.
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    used = _cited_keys()

    orphans = orphan_keys(bibliography, used)
    assert not orphans, f"bibliography entries nobody cites: {orphans}"


# Commit-pin coherence for source-audit entries lives in
# tests/test_citation_gates.py (quviz.docs.pins.validate_source_pins); the
# github-only "non-empty commit or version" check that used to sit here let
# ``commit = {latest}`` through.
