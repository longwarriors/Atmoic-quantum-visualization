"""Gates that make the citation checks truthful.

Nothing here ``importorskip``s: the docs dependency group is mandatory on
every runner and ``tests/conftest.py`` fails the session on any skip, so a
missing group errors loudly instead of silently dropping a gate.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import markdown
import pytest

from quviz.docs.bibliography import BibEntry, keywords, parse_bibtex, parse_bibtex_file
from quviz.docs.pins import _host_in, is_code_host, url_ref, validate_source_pins
from quviz.docs.scan import cited_keys_in, cited_keys_in_tree, orphan_keys, strip_non_prose

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_reference_index.py"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


render_reference_index = _load_script(SCRIPT)


def _entry(key: str, **fields: str) -> BibEntry:
    fields.setdefault("keywords", "source-audit,software")
    return BibEntry(entry_type="software", key=key, fields=fields, authors=())


# --- C3: the orphan / unknown-key scan must only see prose -----------------


def test_key_only_inside_backtick_fence_is_not_cited() -> None:
    text = "Prose.\n\n```markdown\nSee [@fenced-only].\n```\n\nMore prose.\n"
    assert cited_keys_in(text) == set()


def test_key_only_inside_tilde_fence_is_not_cited() -> None:
    text = "~~~\n[@tilde-only, p. 1]\n~~~\n"
    assert cited_keys_in(text) == set()


def test_key_only_inside_a_block_html_comment_is_not_cited() -> None:
    # A comment that starts a line (up to three spaces in) is a raw HTML block
    # to python-markdown: stashed before inline patterns run, never a citation.
    text = (
        "<!-- TODO cite [@commented-out] -->\n<!--\n[@multi-line]\n-->\n   <!-- [@indented] -->\n"
    )
    assert cited_keys_in(text) == set()


def test_key_inside_an_inline_html_comment_is_cited_because_the_build_sees_it() -> None:
    # Only *block-level* comments are removed at build time. A comment inside a
    # prose line stays in the paragraph and the citation pattern (which runs
    # before the inline-HTML pattern) processes it -- so the scanner must too,
    # or an unknown key there would fail mkdocs while the scan stays green.
    text = "Prose <!-- TODO cite [@commented-out] --> continues.\n"
    assert cited_keys_in(text) == {"commented-out"}
    tail = "<!-- block --> tail [@after-comment]\n"
    assert cited_keys_in(tail) == {"after-comment"}
    unclosed = "<!-- never closed [@literal]\nmore\n"
    assert cited_keys_in(unclosed) == {"literal"}


def test_key_only_inside_inline_code_is_not_cited() -> None:
    text = "Write `[@code-only]` to cite, or ``[@double-tick]`` with doubled ticks.\n"
    assert cited_keys_in(text) == set()


def test_key_in_prose_is_cited() -> None:
    text = "See [@prose-key, p. 4] and [@another; @third, §2].\n"
    assert cited_keys_in(text) == {"prose-key", "another", "third"}


def test_prose_citation_survives_surrounding_non_prose() -> None:
    text = (
        "```\n[@fenced]\n```\n"
        "<!-- [@hidden] -->\n"
        "Real claim [@real] here. And `[@code]`.\n"
        "<pre>\n[@raw]\n</pre>\n"
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


def test_unclosed_fence_is_not_a_fence_so_its_lines_stay_prose() -> None:
    # superfences only stores a fence once it sees the closing run; without
    # one the opener is ordinary paragraph text and every later citation is
    # processed at build time. The scanner used to swallow the document here.
    text = "Prose [@before].\n```\n[@inside]\nstill inside [@still]\n"
    assert cited_keys_in(text) == {"before", "inside", "still"}


def test_fence_follows_superfences_closing_and_indentation_rules() -> None:
    # The closer is the same run as the opener: a longer run does not close.
    assert cited_keys_in("```\n[@a]\n````\n[@b]\n```\nafter [@c]\n") == {"c"}
    # A non-blank line indented less than the opener abandons the fence.
    assert cited_keys_in("  ```\n[@a]\n  ```\nlater [@b]\n") == {"b"}
    assert cited_keys_in("  ```\n    [@a]\n  ```\nlater [@b]\n") == {"b"}
    # The abandoning line is consumed, not re-read as an opener.
    assert cited_keys_in("  ```\n  x\n```\n[@a]\n```\n[@b]\n") == {"a", "b"}
    # Blockquote markers count as prefix, and tildes never close backticks.
    assert cited_keys_in("> ```\n> [@a]\n> ```\nlater [@b]\n") == {"b"}
    assert cited_keys_in("~~~\n[@a]\n```\nlater [@b]\n") == {"a", "b"}


def test_strip_non_prose_preserves_line_count() -> None:
    text = "a\n```\nb\nc\n```\n<!-- x\ny -->\nd <!-- x\ny --> e `f`\n<div>\n<p>z</p>\n</div> t\n"
    assert strip_non_prose(text).count("\n") == text.count("\n")


# --- (a) raw HTML blocks never reach the inline patterns at build time --------


@pytest.mark.parametrize(
    "text",
    [
        "<pre>\n[@k]\n</pre>\n",
        "<pre>[@k]</pre>\n",
        "<script>\nvar a = '[@k]';\n</script>\n",
        "<style>\n/* [@k] */\n</style>\n",
        "<div>\n[@k]\n</div>\n",
        '<div markdown="0">\n[@k]\n</div>\n',
        "<details>\n<summary>x</summary>\n[@k]\n</details>\n",
        "<p>\n[@k]\n</p>\n",
        "   <div>\n[@k]\n</div>\n",
        "<DIV>\n[@k]\n</DIV>\n",
        '<div\n  class="x">\n[@k]\n</div>\n',
        "<div>\n<div>\n</div>\n[@k]\n</div>\n",
        "<pre>\n</div>\n[@k]\n</pre>\n",
        "<table><tr><td>[@k]</td></tr></table>\n",
        "para\n<pre>\n[@k]\n</pre>\n",
        "<div>\n[@k]\n\nmore\n",
    ],
)
def test_key_inside_a_block_level_html_element_is_not_cited(text: str) -> None:
    assert cited_keys_in(text) == set()


@pytest.mark.parametrize(
    "text",
    [
        '<div markdown="1">\n[@k]\n</div>\n',
        "<div markdown>\n[@k]\n</div>\n",
        '<div markdown="block">\n[@k]\n</div>\n',
        "<span>[@k]</span>\n",
        "text <div>[@k]</div>\n",
        "<div>x</div> tail [@k]\n",
        "<div>x</div>\n\n[@k]\n",
        "<div/>\n[@k]\n",
        "<hr>\n[@k]\n",
        "```\n<div>\n```\n[@k]\n",
        "- <div>\n  [@k]\n  </div>\n",
    ],
)
def test_key_outside_or_inside_a_markdown_enabled_html_element_is_cited(text: str) -> None:
    assert cited_keys_in(text) == {"k"}


def test_block_level_tag_list_matches_the_installed_python_markdown() -> None:
    from markdown.util import BLOCK_LEVEL_ELEMENTS

    from quviz.docs.scan import BLOCK_TAGS

    # ``hr`` is void: it cannot contain a citation, so the scanner skips it.
    assert BLOCK_TAGS | {"hr"} == set(BLOCK_LEVEL_ELEMENTS)


# --- (b) a backtick run on a list-marker line is a code span, not a fence ---


def test_backticks_on_a_list_marker_line_behave_as_a_code_span_like_the_build() -> None:
    # superfences only opens a fence after whitespace / blockquote markers, so
    # ``- ``` `` is paragraph text; python-markdown then pairs the backtick
    # runs into one multi-line code span. Same outcome as a fence when closed...
    assert cited_keys_in("- ```\n  [@inside]\n  ```\nlater [@later]\n") == {"later"}
    assert cited_keys_in("1. ```python\n   [@inside]\n   ```\n") == set()
    # ...but tildes never pair, and an unclosed run is literal text.
    assert cited_keys_in("- ~~~\n  [@tilde]\n  ~~~\n") == {"tilde"}
    assert cited_keys_in("- ```\n  [@inside]\n\nlater [@later]\n") == {"inside", "later"}


# --- (c) a code span never crosses a blank line ----------------------------


def test_code_span_cannot_swallow_citations_across_a_blank_line() -> None:
    # python-markdown splits blocks on blank lines before inline patterns run,
    # so a stray backtick cannot pair with one paragraphs away.
    text = "A stray ` here.\n\nReal claim [@real].\n\nAnother stray ` there.\n"
    assert cited_keys_in(text) == {"real"}
    assert cited_keys_in("a `b\n\nc [@k] d` e\n") == {"k"}
    assert cited_keys_in("a `b\nc [@k] d` e\n") == set()


# --- the scanner agrees with python-markdown + the citation extension --------


def _build(text: str, bib_path: Path) -> str:
    from quviz.docs.citations import CitationExtension

    md = markdown.Markdown(
        extensions=[
            "md_in_html",
            "admonition",
            "pymdownx.superfences",
            CitationExtension(bib_file=str(bib_path)),
        ]
    )
    return md.convert(text)


@pytest.mark.parametrize(
    ("text", "cited"),
    [
        ("Prose <!-- [@k] --> continues.\n", True),
        ("<!-- [@k] -->\n", False),
        ("<pre>\n[@k]\n</pre>\n", False),
        ('<div markdown="1">\n[@k]\n</div>\n', True),
        ("<details>\n[@k]\n</details>\n", False),
        ("a `b\n\nc [@k] d` e\n", True),
        ("a `b\nc [@k] d` e\n", False),
        ("- ```\n  [@k]\n  ```\n", False),
        ("- ~~~\n  [@k]\n  ~~~\n", True),
        ("- ```\n  x\n\n[@k]\n", True),
        ("```\nx\n[@k]\n", True),
        ("```\nx\n````\n[@k]\n", True),
        ("```\nx\n````\n[@k]\n```\n", False),
        ("  ```\nx\n  ```\n[@k]\n", True),
        ("  ```\n    [@k]\n  ```\n", False),
        ("> ```\n> [@k]\n> ```\n", False),
        ("!!! note\n\n    ```\n    [@k]\n    ```\n", False),
        ("<div>x</div> tail [@k]\n", True),
        ("<div/>\n[@k]\n", True),
        ("<!-- x --> tail [@k]\n", True),
        ("<!-- unclosed [@k]\n", True),
    ],
)
def test_scanner_matches_the_markdown_build(tmp_path: Path, text: str, cited: bool) -> None:
    bib = tmp_path / "b.bib"
    bib.write_text("@online{k, title={T}, author={A B}, year={2020}}\n", encoding="utf-8")
    html = _build(text, bib)
    assert ("quviz-citation" in html) is cited, html
    assert (cited_keys_in(text) == {"k"}) is cited


def test_malformed_citation_in_prose_still_raises() -> None:
    with pytest.raises(ValueError, match="malformed"):
        cited_keys_in("See [@bad key].\n")


def test_orphan_check_reports_an_entry_cited_only_inside_a_code_block(tmp_path: Path) -> None:
    # The same helpers drive scripts/render_reference_index.py, pins.py and
    # tests/test_bibliography.py, so the gate cannot drift between them.
    bibliography = parse_bibtex(
        "@online{only-fenced, title={A}, url={https://example.invalid/a}}\n"
        "@online{cited-for-real, title={B}, url={https://example.invalid/b}}\n"
        "@online{build-tool, title={C}, keywords={software, tooling}}\n"
    )
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "page.md").write_text(
        "Prose cites [@cited-for-real].\n\n```markdown\nExample: [@only-fenced]\n```\n",
        encoding="utf-8",
    )
    used = cited_keys_in_tree(docs)
    assert used == {"cited-for-real"}
    assert orphan_keys(bibliography, used) == ["only-fenced"]


def test_keywords_are_split_and_stripped() -> None:
    entry = _entry("x", keywords=" software, tooling ,,visualization")
    assert keywords(entry) == {"software", "tooling", "visualization"}
    assert keywords(_entry("y", keywords="")) == set()
    assert keywords(BibEntry("online", "z", {}, ())) == set()


def test_check_mode_passes_against_the_repository_in_process() -> None:
    # In-process twin of the ``--check`` gate: the index, the orphan scan and
    # the pin validation all run against the real bibliography and docs.
    assert render_reference_index.main(["--check"]) == 0


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


# (a) SHAs are lowercase in the URL and in the commit field; the two are not
# silently compared as if the upper-case one were a tag.
@pytest.mark.parametrize(
    ("url_sha", "commit"),
    [
        (SHA.upper(), SHA),
        (SHA[:20].upper() + SHA[20:], SHA),
        (SHA, SHA.upper()),
        (SHA, SHA[:12].upper()),
    ],
)
def test_upper_or_mixed_case_sha_is_rejected_with_a_lowercase_message(
    url_sha: str, commit: str
) -> None:
    entry = _entry("x", url=f"https://github.com/o/r/blob/{url_sha}/f.py", commit=commit)
    messages = validate_source_pins([entry])
    assert len(messages) == 1, messages
    assert "lowercase" in messages[0]
    assert "version" not in messages[0]


def test_url_ref_reads_an_upper_case_sha_as_a_sha_not_a_tag() -> None:
    assert url_ref(f"https://github.com/o/r/blob/{SHA.upper()}/f.py") == ("sha", SHA.upper())


# (b) every source-audit URL needs an http(s) scheme: a scheme-less code-host
# URL has no hostname, so it used to fall through to the non-code-host rules.
@pytest.mark.parametrize(
    "url",
    [
        f"github.com/o/r/blob/{SHA}/f.py",
        f"//github.com/o/r/blob/{SHA}/f.py",
        f"ftp://github.com/o/r/blob/{SHA}/f.py",
        "example.org/post",
        "mailto:someone@example.org",
    ],
)
def test_source_audit_url_without_http_scheme_is_rejected(url: str) -> None:
    entry = _entry("x", url=url, commit=SHA, urldate="2026-08-22")
    messages = validate_source_pins([entry])
    assert len(messages) == 1, messages
    assert "http://" in messages[0] and "https://" in messages[0]


# (c) version vs tag is an equality up to one leading "v", not a substring test.
@pytest.mark.parametrize(
    ("tag", "version", "ok"),
    [
        ("v2.0.1", "0", False),
        ("v2.0.10", "2.0.1", False),
        ("2.0.10", "2.0.1", False),
        ("v2.0.1", "2.0.1", True),
        ("2.0.1", "v2.0.1", True),
        ("v2.0.1", "v2.0.1", True),
        ("2.0.1", "2.0.1", True),
        ("release-2", "2", False),
    ],
)
def test_version_must_equal_the_tag_up_to_a_leading_v(tag: str, version: str, ok: bool) -> None:
    entry = _entry(
        "x", url=f"https://github.com/o/r/releases/tag/{tag}", commit=SHA, version=version
    )
    messages = validate_source_pins([entry])
    assert (messages == []) is ok, messages
    if not ok:
        assert "version" in messages[0] and tag in messages[0]


# (d) an explicit tag path is a tag even when its name happens to be hex.
@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/o/r/releases/tag/20240512",
        "https://gitlab.com/o/r/-/tags/20240512",
        "https://bitbucket.org/o/r/src/tag/20240512/f.py",
        "https://github.com/o/r/blob/refs/tags/20240512/f.py",
    ],
)
def test_hex_looking_tag_name_on_an_explicit_tag_path_stays_a_tag(url: str) -> None:
    assert url_ref(url) == ("tag", "20240512")
    pinned = _entry("x", url=url, commit=SHA, version="20240512")
    assert validate_source_pins([pinned]) == []
    unversioned = _entry("x", url=url, commit=SHA)
    assert any("version" in m for m in validate_source_pins([unversioned]))


# (e) refs/heads/<branch> and refs/tags/<tag> paths name <branch> / <tag>, not "refs".
@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/o/r/blob/refs/heads/main/f.py", ("ref", "main")),
        ("https://github.com/o/r/tree/refs/tags/v1.2", ("tag", "v1.2")),
        ("https://raw.githubusercontent.com/o/r/refs/heads/main/f.py", ("ref", "main")),
        ("https://raw.githubusercontent.com/o/r/refs/tags/v1.2/f.py", ("tag", "v1.2")),
        (f"https://raw.githubusercontent.com/o/r/{SHA}/f.py", ("sha", SHA)),
        ("https://github.com/o/r/blob/refs/f.py", ("ref", "refs")),
    ],
)
def test_refs_heads_and_refs_tags_paths_name_the_branch_or_tag(
    url: str, expected: tuple[str, str]
) -> None:
    assert url_ref(url) == expected


def test_refs_heads_branch_url_validates_against_the_branch_name() -> None:
    url = "https://raw.githubusercontent.com/o/r/refs/heads/main/f.py"
    assert validate_source_pins([_entry("x", url=url, commit=SHA, version="main")]) == []
    messages = validate_source_pins([_entry("x", url=url, commit=SHA)])
    assert len(messages) == 1 and "'main'" in messages[0] and "'refs'" not in messages[0]
    tagged = "https://github.com/o/r/blob/refs/tags/v1.2/f.py"
    assert validate_source_pins([_entry("x", url=tagged, commit=SHA, version="1.2")]) == []


# (f) a code-host URL must name a repository, and discussion pages are not source.
@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/Solara570",
        "https://github.com/",
        "https://github.com",
        "https://raw.githubusercontent.com/o",
        "https://github.com/o/r/issues/12",
        "https://github.com/o/r/pull/5/files",
        "https://github.com/o/r/pulls",
        "https://github.com/o/r/discussions/3",
        "https://github.com/o/r/wiki/Home",
        "https://gitlab.com/o/r/-/issues/12",
        "https://gitlab.com/o/r/-/merge_requests/7",
        "https://bitbucket.org/o/r/pull-requests/9",
    ],
)
def test_code_host_url_that_is_not_source_is_rejected(url: str) -> None:
    messages = validate_source_pins([_entry("x", url=url, commit=SHA)])
    assert len(messages) == 1, messages
    assert "x:" in messages[0] and "source" in messages[0]


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/o/r",
        "https://github.com/o/r/",
        "https://gitlab.com/group/subgroup/r",
        f"https://github.com/o/r/blob/{SHA}/docs/issues/README.md",
    ],
)
def test_bare_repository_and_file_urls_are_still_accepted(url: str) -> None:
    assert validate_source_pins([_entry("x", url=url, commit=SHA)]) == []


def test_host_suffix_match_is_shared_and_exact() -> None:
    assert is_code_host("https://github.com/o/r")
    assert is_code_host("https://raw.githubusercontent.com/o/r/x/f.py")
    assert is_code_host("https://sub.gitlab.com/o/r")
    assert not is_code_host("https://notgithub.com/o/r")
    assert not is_code_host("https://github.com.evil.example/o/r")
    assert _host_in("a.b.c", ("b.c",)) and not _host_in("ab.c", ("b.c",))
