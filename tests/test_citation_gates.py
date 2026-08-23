"""Gates that make the citation checks truthful.

Unlike ``tests/test_references.py`` this module never ``importorskip``s: the
whole suite must error loudly when the docs dependency group is missing,
because a skipped gate that nobody notices is indistinguishable from a passing
one.
"""

from __future__ import annotations

import markdown  # the docs dependency group; deliberately not importorskip


def test_docs_dependency_group_is_installed() -> None:
    # ``scripts/check.ps1``, ``make test`` and CI all run pytest with
    # ``--group docs``. If this import fails, the gate runner forgot it.
    assert hasattr(markdown, "Markdown")
