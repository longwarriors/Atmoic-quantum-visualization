"""Pin validation for ``source-audit`` bibliography entries.

``docs/references/source-policy.md`` says a source-code audit *must* record
the revision it audited. The previous gate only asked for a non-empty
``commit`` or ``version`` field on a github.com URL, so ``commit = {latest}``
or a commit that contradicted the SHA in the URL passed. This module makes
the pin mean something:

* an entry tagged ``source-audit`` whose ``url`` is on a code host needs a
  ``commit`` that is a 7-40 character lowercase hex SHA;
* if the URL itself names a SHA (``blob``/``tree``/``commit``/``raw``/``src``
  paths), that SHA and the ``commit`` field must agree (one is a prefix of the
  other);
* if the URL names a tag or branch instead, a ``version`` field is required
  and it must appear in the ref the URL names;
* a ``source-audit`` entry that is *not* on a code host must record an ISO
  ``urldate`` (access date) when it has a URL, or a ``doi`` when it has none.

The URL-vs-commit consistency check cannot tell a tag from a branch, and it
cannot verify that the SHA exists upstream: that is what ``git ls-remote`` is
for at review time. A code-host URL without any ref (a bare repository link)
is accepted as long as the ``commit`` field is present -- the field, not the
URL, is the pin in that case.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Literal
from urllib.parse import unquote, urlsplit

from quviz.docs.bibliography import BibEntry

CODE_HOSTS = ("github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "gitee.com")
RAW_HOSTS = ("githubusercontent.com",)
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{7,40}$")
URLDATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SOURCE_AUDIT_KEYWORD = "source-audit"

RefKind = Literal["sha", "tag", "ref"]


def _keywords(entry: BibEntry) -> set[str]:
    return {value.strip() for value in entry.fields.get("keywords", "").split(",")}


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def is_code_host(url: str) -> bool:
    host = _host(url)
    return any(host == h or host.endswith("." + h) for h in CODE_HOSTS + RAW_HOSTS)


def url_ref(url: str) -> tuple[RefKind, str] | None:
    """The revision a code-host URL names, if any.

    Returns ``("sha", <hex>)``, ``("tag", <name>)`` for explicit tag paths, or
    ``("ref", <name>)`` when the path names a tag or branch indistinguishably.
    """

    split = urlsplit(url)
    segments = [unquote(part) for part in split.path.split("/") if part]
    host = (split.hostname or "").lower()
    ref: str | None = None
    kind: RefKind = "ref"
    if any(host == h or host.endswith("." + h) for h in RAW_HOSTS):
        # raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
        ref = segments[2] if len(segments) > 2 else None
    else:
        for index, segment in enumerate(segments):
            following = segments[index + 1 :]
            if (
                segment == "releases"
                and len(following) >= 2
                and following[0] in {"tag", "download"}
            ):
                ref, kind = following[1], "tag"
                break
            if (
                segment == "src"
                and len(following) >= 2
                and following[0] in {"commit", "branch", "tag"}
            ):
                ref = following[1]
                kind = "tag" if following[0] == "tag" else "ref"
                break
            if segment in {"blob", "tree", "commit", "commits", "raw", "src"} and following:
                ref = following[0]
                break
            if segment == "tags" and following:
                ref, kind = following[0], "tag"
                break
    if ref is None:
        return None
    if COMMIT_PATTERN.match(ref):
        return "sha", ref
    return kind, ref


def _sha_consistent(url_sha: str, commit: str) -> bool:
    return url_sha.startswith(commit) or commit.startswith(url_sha)


def _validate_code_host(entry: BibEntry, url: str) -> list[str]:
    key = entry.key
    messages: list[str] = []
    commit = entry.fields.get("commit", "").strip()
    if not commit:
        messages.append(f"{key}: source-audit entry on a code host must record a commit field")
    elif not COMMIT_PATTERN.match(commit):
        messages.append(f"{key}: commit {commit!r} is not a 7-40 character lowercase hex SHA")
    ref = url_ref(url)
    if ref is None:
        return messages
    kind, name = ref
    if kind == "sha":
        if commit and COMMIT_PATTERN.match(commit) and not _sha_consistent(name, commit):
            messages.append(f"{key}: URL pins {name} but the commit field says {commit}")
        return messages
    version = entry.fields.get("version", "").strip()
    if not version:
        messages.append(
            f"{key}: URL names the {kind} {name!r} rather than a SHA; a version field "
            "is required alongside commit"
        )
    elif version not in name:
        messages.append(f"{key}: version {version!r} does not appear in the URL ref {name!r}")
    return messages


def _validate_other(entry: BibEntry, url: str) -> list[str]:
    key = entry.key
    if url:
        urldate = entry.fields.get("urldate", "").strip()
        if not urldate:
            return [f"{key}: source-audit entry with a web URL must record urldate (access date)"]
        if not URLDATE_PATTERN.match(urldate):
            return [f"{key}: urldate {urldate!r} must be an ISO date (YYYY-MM-DD)"]
        return []
    if not entry.fields.get("doi", "").strip():
        return [f"{key}: source-audit entry without a URL must carry a doi"]
    return []


def validate_source_pins(entries: Iterable[BibEntry]) -> list[str]:
    """Every reason a ``source-audit`` entry's pin is missing or incoherent.

    An empty list means every audited source is pinned and self-consistent.
    """

    messages: list[str] = []
    for entry in entries:
        if SOURCE_AUDIT_KEYWORD not in _keywords(entry):
            continue
        url = entry.fields.get("url", "").strip()
        if url and is_code_host(url):
            messages.extend(_validate_code_host(entry, url))
        else:
            messages.extend(_validate_other(entry, url))
    return messages
