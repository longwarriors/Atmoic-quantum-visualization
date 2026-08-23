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
    fails_run,
    format_row,
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


def test_extract_urls_stops_at_cjk_punctuation_and_strips_emphasis() -> None:
    # The docs are Chinese: a bare URL is routinely followed by the ideographic
    # full stop (U+3002) or comma (U+FF0C), which used to be glued onto the URL
    # and probed as part of it.
    text = (
        "见 https://example.org/a。然后 https://example.org/b，还有（https://example.org/c）"  # noqa: RUF001
        "以及 *https://example.org/d* 和 _https://example.org/e_ 与 https://example.org/%E4%B8%AD。"
    )
    assert extract_urls(text) == {
        "https://example.org/a",
        "https://example.org/b",
        "https://example.org/c",
        "https://example.org/d",
        "https://example.org/e",
        "https://example.org/%E4%B8%AD",
    }


def test_classify_verdicts() -> None:
    assert classify("https://example.org", 200) == "OK"
    assert classify("https://example.org", 301) == "OK"
    assert classify("https://example.org", 404) == "BROKEN"
    assert classify("https://example.org", 503) == "BROKEN"
    assert classify("https://example.org", None) == "BROKEN"
    assert classify("https://example.org", 429) == "BLOCKED"
    assert classify("https://www.zhihu.com/q", 403) == "BLOCKED"
    assert classify("https://example.org", 403) == "SUSPECT"


def test_weekly_sweep_fails_on_broken_and_suspect_but_tolerates_blocked() -> None:
    assert fails_run("BROKEN", "https://example.org", strict=False)
    assert fails_run("SUSPECT", "https://example.org", strict=False)
    assert not fails_run("BLOCKED", "https://example.org", strict=False)
    assert not fails_run("BLOCKED", "https://www.zhihu.com/q", strict=False)
    assert not fails_run("OK", "https://example.org", strict=False)


def test_changed_links_mode_tolerates_blocked_on_every_host() -> None:
    # A newly added zhihu/APS/ScienceDirect/ACS/Cambridge link answers 403 to
    # every bot; failing the pull request on that would just teach people to
    # ignore the gate. Those sources should be cited by DOI instead.
    assert not fails_run("BLOCKED", "https://www.zhihu.com/question/1", strict=True)
    assert not fails_run("BLOCKED", "https://journals.aps.org/prl/abstract/10.1103/x", strict=True)
    assert not fails_run("BLOCKED", "https://www.sciencedirect.com/science/article/x", strict=True)
    assert not fails_run("BLOCKED", "https://pubs.acs.org/doi/10.1021/x", strict=True)
    assert not fails_run("BLOCKED", "https://www.cambridge.org/core/x", strict=True)
    # Off the bot-filter hosts the only way to be BLOCKED is a 429, which the
    # checker's own concurrency provokes (GitHub in particular). Rate limiting
    # says nothing about the link, so it is tolerated in the pull-request mode
    # too; it used to fail the run there, contradicting classify()'s comment.
    assert classify("https://github.com/o/r", 429) == "BLOCKED"
    assert not fails_run("BLOCKED", "https://github.com/o/r", strict=True)
    # Anything else that is not OK still fails a pull request.
    assert fails_run("SUSPECT", "https://www.zhihu.com/question/1", strict=True)
    assert fails_run("SUSPECT", "https://github.com/o/r", strict=True)
    assert fails_run("BROKEN", "https://www.zhihu.com/question/1", strict=True)
    assert not fails_run("OK", "https://github.com/o/r", strict=True)


def test_a_403_off_the_bot_filter_hosts_is_suspect_so_it_still_fails_strict_mode() -> None:
    # Tolerating BLOCKED everywhere must not let a real 403 through: off
    # BOT_HOSTS a 403 is SUSPECT, never BLOCKED.
    url = "https://github.com/o/r"
    assert classify(url, 403) == "SUSPECT"
    assert fails_run(classify(url, 403), url, strict=True)
    assert fails_run(classify(url, 403), url, strict=False)


def test_step_summary_lists_problems_and_counts() -> None:
    buckets = {
        "OK": [("a", "200", "https://ok.example")],
        "BLOCKED": [("d", "403", "https://www.zhihu.com/q"), ("e", "429", "https://github.com/x")],
        "SUSPECT": [("b", "403", "https://suspect.example")],
        "BROKEN": [("c", "404", "https://broken.example")],
    }
    summary = step_summary(buckets, strict=True)
    assert "[c] 404 https://broken.example" in summary
    assert "[b] 403 https://suspect.example" in summary
    assert "https://ok.example" not in summary
    assert "1 ok" in summary and "2 blocked" in summary and "1 broken" in summary
    zhihu_line = next(line for line in summary.splitlines() if "zhihu" in line)
    github_line = next(line for line in summary.splitlines() if "github" in line)
    suspect_line = next(line for line in summary.splitlines() if "suspect.example" in line)
    assert "tolerated" in zhihu_line and "fails" not in zhihu_line
    assert "tolerated" in github_line and "fails" not in github_line
    assert "fails the run" in suspect_line
    assert format_row(("c", "404", "https://broken.example")) == "[c] 404 https://broken.example"


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
