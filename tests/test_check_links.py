"""Offline tests for scripts/check_links.py's pure parts.

Nothing here touches the network: the probe itself is exercised by the
scheduled workflow and by the pull-request job, not by pytest.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from quviz.docs.links import (
    added_urls,
    classify,
    extract_urls,
    failing_verdicts,
    probe_target,
    step_summary,
)

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check_links.py"


def test_added_urls_collects_only_added_bib_urls_and_dois() -> None:
    diff = (
        "diff --git a/references.bib b/references.bib\n"
        "--- a/references.bib\n"
        "+++ b/references.bib\n"
        "@@ -1,3 +1,6 @@\n"
        " @online{kept,\n"
        "   url = {https://example.org/context-line},\n"
        "+@article{new,\n"
        "+  doi = {10.1016/0021-9991(82)90091-2},\n"
        "+  url = {https://example.org/new},\n"
        "-  url = {https://example.org/removed},\n"
    )
    assert added_urls(diff) == {
        "https://example.org/new",
        "https://doi.org/10.1016/0021-9991(82)90091-2",
    }


def test_added_urls_ignores_diff_headers_that_start_with_plus() -> None:
    diff = "+++ b/docs/https://not-a-link.example\n+Prose.\n"
    assert added_urls(diff) == set()


def test_added_urls_treats_a_moved_url_as_unchanged() -> None:
    diff = "-See <https://example.org/moved>.\n+Moved: <https://example.org/moved>.\n"
    assert added_urls(diff) == set()


def test_added_urls_reads_markdown_links_with_balanced_parentheses() -> None:
    diff = "+[DOI](https://doi.org/10.1016/0021-9991(82)90091-2) and [x](https://a.example/p).\n"
    assert added_urls(diff) == {
        "https://doi.org/10.1016/0021-9991(82)90091-2",
        "https://a.example/p",
    }


def test_extract_urls_strips_trailing_punctuation_but_keeps_dotted_paths() -> None:
    text = "See https://dlmf.nist.gov/14.30. Or https://example.org/a, then `https://x.example/y`."
    assert extract_urls(text) == {
        "https://dlmf.nist.gov/14.30",
        "https://example.org/a",
        "https://x.example/y",
    }


def test_doi_links_are_probed_through_the_handle_api_not_the_publisher() -> None:
    # doi.org redirects into publisher sites whose bot filters answer 403, which
    # says nothing about whether the DOI exists. The handle API answers 200 for
    # a registered DOI and 404 for an unknown one.
    assert (
        probe_target("https://doi.org/10.1021/ed072p505")
        == "https://doi.org/api/handles/10.1021/ed072p505"
    )
    assert (
        probe_target("https://doi.org/api/handles/10.1/x") == "https://doi.org/api/handles/10.1/x"
    )
    assert probe_target("https://dx.doi.org/10.1/x") == "https://doi.org/api/handles/10.1/x"
    assert probe_target("https://example.org/doi/10.1/x") == "https://example.org/doi/10.1/x"


def test_classify_verdicts() -> None:
    assert classify("https://example.org", 200, "ok") == "OK"
    assert classify("https://example.org", 301, "ok") == "OK"
    assert classify("https://example.org", 404, "http-error") == "BROKEN"
    assert classify("https://example.org", 503, "http-error") == "BROKEN"
    assert classify("https://example.org", None, "unreachable: timeout") == "BROKEN"
    assert classify("https://example.org", 429, "http-error") == "BLOCKED"
    assert classify("https://www.zhihu.com/q", 403, "http-error") == "BLOCKED"
    assert classify("https://example.org", 403, "http-error") == "SUSPECT"


def test_weekly_sweep_fails_on_broken_and_suspect_but_tolerates_blocked() -> None:
    assert failing_verdicts(strict=False) == {"BROKEN", "SUSPECT"}


def test_changed_links_mode_fails_on_anything_that_is_not_ok() -> None:
    assert failing_verdicts(strict=True) == {"BROKEN", "SUSPECT", "BLOCKED"}


def test_step_summary_lists_problems_and_counts() -> None:
    buckets = {
        "OK": ["  [a] 200 https://ok.example"],
        "BLOCKED": [],
        "SUSPECT": ["  [b] 403 https://suspect.example"],
        "BROKEN": ["  [c] 404 https://broken.example"],
    }
    summary = step_summary(buckets, failing={"BROKEN", "SUSPECT"})
    assert "https://broken.example" in summary
    assert "https://suspect.example" in summary
    assert "https://ok.example" not in summary
    assert "1 ok" in summary and "1 broken" in summary


def test_changed_since_with_no_new_links_exits_zero_without_probing() -> None:
    # HEAD...HEAD is an empty diff, so the script must finish without a single
    # network request. If it ever probes here the test becomes network-bound.
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--changed-since", "HEAD"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no new links" in result.stdout
