"""Offline tests for scripts/check_links.py's pure parts.

Nothing here touches the network: the probe itself is exercised by the
scheduled workflow and by the pull-request job, not by pytest.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest

from quviz.docs.links import (
    added_bibliography_targets,
    added_urls,
    bibliography_targets,
    classify,
    extract_urls,
    fails_run,
    format_row,
    is_bot_host,
    is_loopback_url,
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
        "见 https://example.org/old。\n"
        "新 https://example.org/new。\n"
        "本地 http://127.0.0.1:5173/、http://localhost:8000/ 与 http://[::1]:8001/。\n",
        encoding="utf-8",
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


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:5173/",
        "https://127.42.7.9/path",
        "http://127.255.255.255/",
        "http://[::1]:8001/",
        "http://[0:0:0:0:0:0:0:1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://localhost/",
        "HTTP://LOCALHOST.:8000/",
        "http://%6cocalhost:8000/",
    ],
)
def test_loopback_urls_are_identified_from_the_parsed_normalized_hostname(url: str) -> None:
    assert is_loopback_url(url), url


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1.example.org/",
        "https://localhost.example.org/",
        "https://notlocalhost/",
        "https://localhost@evil.example/",
        "https://127.0.0.1@evil.example/",
        "https://evil.example/?next=http://127.0.0.1:8000/",
        "https://evil.example/#localhost",
        "https://localhost%2eevil.example/",
        "https://128.0.0.1/",
        "https://[::2]/",
        "not a url mentioning localhost and 127.0.0.1",
        "",
    ],
)
def test_loopback_strings_outside_the_actual_hostname_cannot_bypass_probing(url: str) -> None:
    assert not is_loopback_url(url), url


def test_changed_targets_does_not_exempt_a_loopback_bibliography_source(tmp_path: Path) -> None:
    """Only tutorial addresses are local; a citation still needs a real source."""

    check_links = _load_script(SCRIPT)
    repo = tmp_path / "repo"
    (repo / "docs").mkdir(parents=True)
    _git(repo, "init", "-q")
    (repo / "docs" / "a.md").write_text("base\n", encoding="utf-8")
    base = _commit_all(repo, "base")
    (repo / "references.bib").write_text(
        "@online{invalid, url={http://127.0.0.2/source}}\n", encoding="utf-8"
    )
    (repo / "docs" / "a.md").write_text(
        "base\nlocal http://127.0.0.1:5173/\nexternal https://example.org/new\n",
        encoding="utf-8",
    )
    _commit_all(repo, "head")
    check_links.ROOT = repo

    assert check_links._changed_targets(base) == {
        "http://127.0.0.2/source": "invalid",
        "https://example.org/new": "docs",
    }


def _localised_git(
    *, present: bool, stderr: str = "fatal: 路径 'references.bib' 不存在于 'abc'\n"
) -> tuple[Callable[..., subprocess.CompletedProcess[str]], list[tuple[str, ...]]]:
    """A ``_git`` whose diagnostics are not English and whose exit codes are git's.

    ``git cat-file -e`` answers 0 / 1 for "does the object exist"; ``git show``
    of an absent path fails with 128 and a translated message.
    """

    calls: list[tuple[str, ...]] = []

    def fake(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        argv = ["git", *args]
        if args[:2] == ("cat-file", "-e"):
            spec = args[2]
            exists = spec.endswith("^{commit}") or present
            return subprocess.CompletedProcess(
                argv, 0 if exists else 1, "", "" if exists else stderr
            )
        if args[0] == "show":
            if present:
                return subprocess.CompletedProcess(
                    argv, 0, "@online{k, url={https://x.example}}\n", ""
                )
            if check:
                raise subprocess.CalledProcessError(128, argv, "", stderr)
            return subprocess.CompletedProcess(argv, 128, "", stderr)
        raise AssertionError(f"unexpected git call {args}")

    return fake, calls


def test_file_at_reports_an_absent_file_by_exit_code_not_by_message_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A localised git (LANG=zh_CN, de_DE ...) translates "does not exist in";
    # substring-matching the English text raised CalledProcessError instead
    # of returning the empty bibliography the merge base really has.
    check_links = _load_script(SCRIPT)
    fake, calls = _localised_git(present=False)
    monkeypatch.setattr(check_links, "_git", fake)
    assert check_links._file_at("abc", "references.bib") == ""
    assert ("cat-file", "-e", "abc:references.bib") in calls
    assert not any(call[0] == "show" for call in calls), calls


def test_file_at_returns_the_committed_content_when_the_file_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    check_links = _load_script(SCRIPT)
    fake, _calls = _localised_git(present=True)
    monkeypatch.setattr(check_links, "_git", fake)
    assert check_links._file_at("abc", "references.bib").startswith("@online{k,")


def test_file_at_still_fails_loudly_on_an_unknown_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Only a *missing path* is "empty"; a revision git cannot resolve is an
    # error, not an empty bibliography that would make every link look new.
    check_links = _load_script(SCRIPT)

    def fake(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        argv = ["git", *args]
        if args[:2] == ("cat-file", "-e"):
            return subprocess.CompletedProcess(argv, 128, "", "fatal: 无效的对象名 'nope'\n")
        raise AssertionError(f"unexpected git call {args}")

    monkeypatch.setattr(check_links, "_git", fake)
    with pytest.raises(subprocess.CalledProcessError):
        check_links._file_at("nope", "references.bib")


def test_file_at_against_real_git_does_not_read_the_message(tmp_path: Path) -> None:
    # Real git, asked for a path absent at one revision and present at the
    # next, with its messages forced to a non-English locale where one is
    # installed (git falls back to English otherwise -- the fake above is
    # what pins the contract; this shows the exit codes are what git emits).
    check_links = _load_script(SCRIPT)
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    (repo / "x.txt").write_text("x\n", encoding="utf-8")
    base = _commit_all(repo, "base")
    (repo / "references.bib").write_text("@online{k, url={https://x.example}}\n", encoding="utf-8")
    head = _commit_all(repo, "head")
    check_links.ROOT = repo
    with pytest.MonkeyPatch.context() as env:
        env.setenv("LC_ALL", "zh_CN.UTF-8")
        env.setenv("LANG", "zh_CN.UTF-8")
        env.setenv("LANGUAGE", "zh_CN")
        assert check_links._file_at(base, "references.bib") == ""
        assert check_links._file_at(head, "references.bib").startswith("@online{k,")
        with pytest.raises(subprocess.CalledProcessError):
            check_links._file_at("no-such-revision", "references.bib")


HUNK = "diff --git a/docs/a.md b/docs/a.md\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n"


def test_added_urls_ignores_diff_headers_that_start_with_plus() -> None:
    diff = (
        "diff --git a/docs/https://not-a-link.example b/docs/https://not-a-link.example\n"
        "--- a/docs/https://not-a-link.example\n"
        "+++ b/docs/https://not-a-link.example\n"
        "@@ -1 +1 @@\n"
        "+Prose.\n"
    )
    assert added_urls(diff) == set()
    # Lines outside any hunk are never content, whatever they start with.
    assert added_urls("+https://example.org/no-hunk\n") == set()


def test_added_urls_treats_a_moved_url_as_unchanged() -> None:
    diff = HUNK + "-See <https://example.org/moved>.\n+Moved: <https://example.org/moved>.\n"
    assert added_urls(diff) == set()


def test_added_urls_reads_markdown_links_with_balanced_parentheses() -> None:
    diff = HUNK + (
        "+[DOI](https://doi.org/10.1016/0021-9991(82)90091-2) and [x](https://a.example/p).\n"
    )
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


def test_added_urls_keeps_a_prose_line_that_begins_with_plus_signs() -> None:
    # A docs line that itself starts with ``++`` shows up in the diff as
    # ``+++ ...``, and one starting with ``--`` as ``--- ...``. Only the file
    # header -- the ``---``/``+++`` pair before a file's first ``@@`` hunk --
    # is a header; inside a hunk those prefixes are content, so a link on such
    # a line used to be dropped and never probed.
    diff = (
        "diff --git a/docs/a.md b/docs/a.md\n"
        "index ebe83d1..19ce168 100644\n"
        "--- a/docs/a.md\n"
        "+++ b/docs/a.md\n"
        "@@ -1,2 +1,4 @@\n"
        " # A\n"
        "+++ 见 https://example.org/plus-plus。\n"
        "++++ https://example.org/triple-plus\n"
        "--- https://example.org/moved\n"
        "+-- https://example.org/moved\n"
        "diff --git a/docs/new.md b/docs/new.md\n"
        "new file mode 100644\n"
        "index 0000000..c85f884\n"
        "--- /dev/null\n"
        "+++ b/docs/new.md\n"
        "@@ -0,0 +1 @@\n"
        "+++ https://example.org/in-new-file\n"
        "\\ No newline at end of file\n"
    )
    assert added_urls(diff) == {
        "https://example.org/plus-plus",
        "https://example.org/triple-plus",
        "https://example.org/in-new-file",
    }
