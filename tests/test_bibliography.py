from __future__ import annotations

from pathlib import Path

import pytest

from quviz.docs.bibliography import parse_bibtex, parse_bibtex_file

ROOT = Path(__file__).resolve().parents[1]


def test_canonical_bibliography_has_expected_sources() -> None:
    bibliography = parse_bibtex_file(ROOT / "references.bib")
    assert len(bibliography.entries) >= 20
    stark = bibliography.entries["stodolna2013stark"]
    assert stark.fields["doi"] == "10.1103/PhysRevLett.110.213001"
    assert stark.authors[0].last_names == ("Stodolna",)
    assert bibliography.entries["scipy-sph-harm-y"].authors[0].literal == "SciPy Community"


def test_duplicate_keys_are_rejected() -> None:
    text = "@online{x, title={A}}\n@online{x, title={B}}"
    with pytest.raises(ValueError, match="duplicate"):
        parse_bibtex(text)


def test_all_documentation_citation_keys_exist() -> None:
    import re

    bibliography = parse_bibtex_file(ROOT / "references.bib")
    known = set(bibliography.entries)
    used: set[str] = set()
    for path in (ROOT / "docs").rglob("*.md"):
        for group in re.findall(r"\[@([^\]]+)\]", path.read_text(encoding="utf-8")):
            used.update(part.strip().lstrip("@") for part in group.split(";"))
    assert used
    assert used <= known


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
