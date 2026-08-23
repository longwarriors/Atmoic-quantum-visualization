"""Offline tests for scripts/check_links.py's pure parts.

Nothing here touches the network: the probe itself is exercised by the
scheduled workflow and by the pull-request job, not by pytest.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType

from quviz.docs.links import (
    added_bibliography_targets,
    added_urls,
    bibliography_targets,
    classify,
    extract_urls,
    fails_run,
    format_row,
    is_bot_host,
    probe_target,
    step_summary,
)

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check_links.py"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_added_urls_collects_only_added_urls() -> None:
    diff = (
        "diff --git a/docs/a.md b/docs/a.md\n"
        "--- a/docs/a.md\n"
        "+++ b/docs/a.md\n"
        "@@ -1,3 +1,6 @@\n"
        " Context <https://example.org/context-line>.\n"
        "+New <https://example.org/new>.\n"
        "-Removed <https://example.org/removed>.\n"
    )
    assert added_urls(diff) == {"https://example.org/new"}


def test_bibliography_targets_maps_every_url_and_doi_to_the_first_citing_key() -> None:
    text = (
        "@online{a, url = {https://example.org/a}}\n"
        "@article{b, doi = {10.1/b}, url = {https://example.org/a}}\n"
        '@article{c, doi = "10.1/c"}\n'
    )
    assert bibliography_targets(text) == {
        "https://example.org/a": "a",
        "https://doi.org/10.1/b": "b",
        "https://doi.org/10.1/c": "c",
    }
    assert bibliography_targets(text, include_doi=False) == {"https://example.org/a": "a"}
    # ``references.bib`` may not exist at the base revision at all.
    assert bibliography_targets("") == {}


def test_added_bibliography_targets_sees_a_doi_whatever_the_field_layout() -> None:
    # The changed-target set used to be built by regexing ``+`` lines of the
    # diff for ``doi = {...}`` on a line of its own, so a DOI in a single-line
    # entry, on a line shared with other fields, or whose value wrapped onto
    # the next line never entered the set and was never probed.
    base = "@online{kept,\n  url = {https://example.org/kept},\n}\n"
    head = base + (
        "@article{one, title={T}, doi={10.1/one}}\n"
        "@article{two,\n  year={2020}, doi={10.1/two},\n}\n"
        "@article{three,\n  doi =\n    {10.1/three},\n}\n"
        "@online{four,\n  url =\n    {https://example.org/four},\n}\n"
    )
    assert added_bibliography_targets(base, head) == {
        "https://doi.org/10.1/one": "one",
        "https://doi.org/10.1/two": "two",
        "https://doi.org/10.1/three": "three",
        "https://example.org/four": "four",
    }


def test_added_bibliography_targets_ignores_moved_or_removed_targets() -> None:
    base = (
        "@online{a, url = {https://example.org/a}}\n"
        "@article{b, doi = {10.1/b}}\n"
        "@online{gone, url = {https://example.org/gone}}\n"
    )
    # ``a``'s URL moves to another key, ``b``'s DOI is reformatted, ``gone``
    # is deleted: nothing new is cited, so nothing is probed.
    head = "@online{a2, url = {https://example.org/a}}\n@article{b,\n  doi = {10.1/b},\n}\n"
    assert added_bibliography_targets(base, head) == {}
    # A changed DOI value is a new target.
    assert added_bibliography_targets(base, base.replace("10.1/b", "10.1/b2")) == {
        "https://doi.org/10.1/b2": "b"
    }
    # No bibliography at the base revision: every target is new.
    assert added_bibliography_targets("", "@article{b, doi = {10.1/b}}\n") == {
        "https://doi.org/10.1/b": "b"
    }


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.org", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.strip()


def _commit_all(repo: Path, message: str) -> str:
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def test_changed_targets_reads_the_bibliography_with_the_parser(tmp_path: Path) -> None:
    # End-to-end through the script's own git plumbing (no network: the
    # probe is not called). At the base revision references.bib does not
    # exist; HEAD adds a single-line entry, a line with two fields, a wrapped
    # value, a docs link, and a bibliography URL that docs already cited
    # (new to the bibliography, so it is probed).
    check_links = _load_script(SCRIPT)
    repo = tmp_path / "repo"
    (repo / "docs").mkdir(parents=True)
    _git(repo, "init", "-q")
    (repo / "docs" / "a.md").write_text("见 https://example.org/old。\n", encoding="utf-8")
    base = _commit_all(repo, "base")
    (repo / "references.bib").write_text(
        "@article{one, title={T}, doi={10.1/one}}\n"
        "@article{two,\n  year={2020}, doi={10.1/two},\n}\n"
        "@article{three,\n  doi =\n    {10.1/three},\n}\n"
        "@online{old, url = {https://example.org/old}}\n",
        encoding="utf-8",
    )
    (repo / "docs" / "a.md").write_text(
        "见 https://example.org/old。\n新 https://example.org/new。\n", encoding="utf-8"
    )
    _commit_all(repo, "head")
    check_links.ROOT = repo
    assert check_links._changed_targets(base) == {
        "https://doi.org/10.1/one": "one",
        "https://doi.org/10.1/two": "two",
        "https://doi.org/10.1/three": "three",
        "https://example.org/old": "old",
        "https://example.org/new": "docs",
    }
    # Nothing changed since HEAD itself.
    assert check_links._changed_targets("HEAD") == {}


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


def test_bot_host_is_decided_by_the_hostname_not_by_a_substring_of_the_url() -> None:
    # The decision used to be ``any(host in url for host in BOT_HOSTS)``: a 403
    # from any URL whose path, query or a longer hostname merely *contained*
    # a bot-filter host was BLOCKED and tolerated, which let an unverified
    # link through the pull-request gate.
    smuggled = (
        "https://evil.example/x?u=doi.org",
        "https://doi.org.evil.example/",
        "https://evil.example/journals.aps.org/paper",
        "https://notzhihu.com/q",
        "https://doi.org@evil.example/",
        "https://evil.example/#doi.org",
    )
    for url in smuggled:
        assert not is_bot_host(url), url
        assert classify(url, 403) == "SUSPECT", url
        assert fails_run(classify(url, 403), url, strict=True), url
        assert fails_run(classify(url, 403), url, strict=False), url
    # The listed hosts, their subdomains, and trivial hostname variants still match.
    legitimate = (
        "https://doi.org/10.1021/ed072p505",
        "https://dx.doi.org/10.1021/ed072p505",
        "https://journals.aps.org/prl/abstract/10.1103/x",
        "https://link.aps.org/doi/10.1103/x",
        "https://www.zhihu.com/question/1",
        "https://zhuanlan.zhihu.com/p/1",
        "https://www.sciencedirect.com/science/article/x",
        "https://pubs.acs.org/doi/10.1021/x",
        "https://www.cambridge.org/core/x",
        "https://DOI.ORG/10.1/x",
        "https://doi.org./10.1/x",
        "http://doi.org:80/10.1/x",
    )
    for url in legitimate:
        assert is_bot_host(url), url
        assert classify(url, 403) == "BLOCKED", url
    # A ``BOT_HOSTS`` entry is a bare hostname; a subdomain match needs the dot
    # boundary, so the registered host is never a suffix of an unrelated one.
    assert not is_bot_host("https://fakecambridge.org/")
    assert not is_bot_host("not a url")
    assert not is_bot_host("")


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
