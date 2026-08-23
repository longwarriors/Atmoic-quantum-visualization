from __future__ import annotations

from pathlib import Path

import pytest

from quviz.docs.bibliography import parse_bibtex, parse_bibtex_file
from quviz.docs.scan import cited_keys_in_tree

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

    orphans = sorted(
        key
        for key, entry in bibliography.entries.items()
        if key not in used
        and "tooling" not in {v.strip() for v in entry.fields.get("keywords", "").split(",")}
    )
    assert not orphans, f"bibliography entries nobody cites: {orphans}"


# Commit-pin coherence for source-audit entries lives in
# tests/test_citation_gates.py (quviz.docs.pins.validate_source_pins); the
# github-only "non-empty commit or version" check that used to sit here let
# ``commit = {latest}`` through.
