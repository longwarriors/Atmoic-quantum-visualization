"""Pin validation for ``source-audit`` bibliography entries.

``docs/references/source-policy.md`` says a source-code audit *must* record
the revision it audited. The previous gate only asked for a non-empty
``commit`` or ``version`` field on a github.com URL, so ``commit = {latest}``
or a commit that contradicted the SHA in the URL passed. This module makes
the pin mean something:

* every ``source-audit`` ``url`` must carry an ``http://`` or ``https://``
  scheme -- a scheme-less ``github.com/...`` has no hostname and would
  otherwise escape every code-host rule below;
* the URL's authority must be well-formed *before* any host or path rule
  looks at it: ``urllib.parse.urlsplit`` is RFC 3986-shaped, so a URL can
  carry a valid ``https`` scheme while ``hostname`` is still ``None``
  (``https:///owner/repo``, a run of ``/`` other than exactly two after the
  scheme) or hold a backslash where a WHATWG-conformant browser accepts one
  as a path/authority separator (``github.com\\owner`` resolves to host
  ``github.com``, path ``/owner``) -- both used to make ``is_code_host``
  false and route straight past every rule below to the non-code-host check,
  which passes on a ``urldate`` alone even though a browser resolves the same
  spelling onto a moving branch on a real code host;
* the host is normalised the way a browser resolves it before it is compared
  with the code-host list (lowercase, userinfo and port dropped, percent-escapes
  decoded, IDNA-mapped to ASCII and only *then* trailing dots stripped, so the
  ideographic and full-width full stops IDNA turns into ``.`` are stripped
  too), and the path is percent-decoded once *before* it is split on ``/``
  and its ``.``/``..`` segments are resolved -- so ``github.com.``,
  ``github.com。``, ``GitHub.com``, ``github%2Ecom``,
  ``tree/refs%2Fheads%2Fmaster`` and ``tree/v1.0/../master`` meet exactly the
  rules their canonical spellings meet;
* an entry whose ``url`` is on a code host must name a repository (at least
  ``/owner/repo``, or ``/group/subgroup/repo`` on GitLab); issue,
  pull-request, discussion and wiki pages are not source and are rejected,
  and so is any deeper path that is not one of the pin forms this module
  understands (``blob``/``tree``/``commit``/``raw``/``src`` paths, release
  tags, ``tags``): ``/releases/latest``, ``/archive/...``, ``/actions`` and
  the like are moving targets, not auditable revisions;
* such an entry needs a ``commit`` that is a 7-40 character *lowercase* hex
  SHA, and a SHA written into the URL must be lowercase too -- an upper-case
  SHA is rejected rather than silently read as a tag name;
* if the URL itself names a SHA (``blob``/``tree``/``commit``/``raw``/``src``
  paths), that SHA and the ``commit`` field must agree (one is a prefix of the
  other);
* if the URL names a branch -- explicitly (``refs/heads/<name>``,
  ``src/branch/<name>``, Gitea's ``raw``/``media`` variants of it), by any
  other ref namespace (``refs/pull/...``, ``refs/remotes/...``) or by a
  conventional branch name such as ``main``, ``master``, ``HEAD``,
  ``develop`` or ``trunk`` -- it is rejected outright, ``version`` field or
  not: a branch moves, so nothing in the entry pins what was audited;
* if the URL names a tag, or a ref that cannot be told from one, a
  ``version`` field is required and it must equal the ref the URL names, up
  to one leading ``v`` on either side (``2.0.1`` matches ``v2.0.1``;
  ``2.0.1`` does not match ``v2.0.10``);
* a ``source-audit`` entry that is *not* on a code host must record an ISO
  ``urldate`` (access date) when it has a URL, or a ``doi`` when it has none.

``refs/heads/<branch>`` and ``refs/tags/<tag>`` path forms (GitHub raw and
blob URLs since 2024) name ``<branch>`` / ``<tag>``. A branch name containing
``/`` cannot be told apart from the file path that follows it, so only its
first segment is compared.

The URL-vs-commit consistency check cannot tell a tag from an unconventionally
named branch, and it cannot verify that the SHA exists upstream: that is what
``git ls-remote`` is for at review time. A code-host URL without any ref (a bare repository link)
is accepted as long as the ``commit`` field is present -- the field, not the
URL, is the pin in that case.
"""

from __future__ import annotations

import contextlib
import re
from collections.abc import Iterable
from typing import Literal
from urllib.parse import unquote, urlsplit

from quviz.docs.bibliography import BibEntry, keywords

CODE_HOSTS = ("github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "gitee.com")
RAW_HOSTS = ("githubusercontent.com",)
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{7,40}$")
_HEX_ANY_CASE = re.compile(r"^[0-9a-fA-F]{7,40}$")
URLDATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SOURCE_AUDIT_KEYWORD = "source-audit"
# Top-level repository paths that are discussion about the code, not the code.
NON_SOURCE_PATHS = frozenset(
    {"issues", "pull", "pulls", "pull-requests", "merge_requests", "discussions", "wiki"}
)
_REF_MARKERS = frozenset({"blob", "tree", "commit", "commits", "raw", "src", "media"})
# Gitea / Forgejo page kinds whose next segment says what the ref is
# (``src/branch/main``, ``raw/tag/v1``, ``media/commit/<sha>``).
_GITEA_MARKERS = frozenset({"src", "raw", "media"})
# Conventional names of a repository's moving branch; a URL naming one of these
# pins nothing, whatever the version field says.
BRANCH_NAMES = frozenset({"head", "main", "master", "develop", "development", "dev", "trunk"})
_PIN_FORMS = (
    "/owner/repo, a blob/tree/commit/commits/raw/src/media path with a revision, "
    "releases/tag/<tag>, releases/download/<tag>/..., tags/<tag> (GitLab: -/releases/<tag>)"
)

RefKind = Literal["sha", "tag", "branch", "ref"]
# Code points the IDNA mapping (RFC 3490 §3.1) treats as the label separator.
_IDNA_DOTS = str.maketrans(
    {
        "\N{IDEOGRAPHIC FULL STOP}": ".",
        "\N{FULLWIDTH FULL STOP}": ".",
        "\N{HALFWIDTH IDEOGRAPHIC FULL STOP}": ".",
    }
)


def _host(url: str) -> str:
    """The hostname as a browser would resolve it.

    ``urlsplit().hostname`` already drops userinfo and the port and lowercases.
    On top of that: percent-escapes in the host are decoded (``github%2Ecom``),
    the name is IDNA-mapped to ASCII so ``github.com`` spelled in full-width
    letters (U+FF47 ...) is ``github.com``, while a genuine look-alike such as
    ``gíthub.com`` stays ``xn--gthub-zsa.com``, and *then* trailing dots (the
    fully-qualified spelling ``github.com.``, which GitHub answers with a
    redirect to the canonical host) are stripped.

    The order matters: IDNA maps the ideographic full stop U+3002, the
    full-width full stop U+FF0E and the half-width ideographic full stop
    U+FF61 to the ASCII label separator, so a browser resolves ``github.com。``
    as ``github.com.`` and then ``github.com``. Stripping before the mapping
    left that dot in place, the host came out as ``github.com.`` and matched
    no code host at all. The three are also folded by hand first, because the
    IDNA codec refuses an empty label (``github.com。。``) and would leave the
    original spelling -- with its unstripped non-ASCII dots -- behind.
    """

    host = unquote(urlsplit(url).hostname or "").lower().translate(_IDNA_DOTS)
    with contextlib.suppress(UnicodeError):
        host = host.encode("idna").decode("ascii").lower()
    return host.rstrip(".")


def _host_in(host: str, hosts: Iterable[str]) -> bool:
    """``host`` is one of ``hosts`` or a subdomain of one (never a look-alike)."""

    return any(host == h or host.endswith("." + h) for h in hosts)


def _segments(url: str) -> list[str]:
    """The path split on ``/`` *after* one round of percent-decoding, dot segments removed.

    GitHub serves ``/tree/refs%2Fheads%2Fmaster`` as ``/tree/refs/heads/master``,
    so an encoded slash is a separator, not part of a ref name: decoding first
    and splitting afterwards turns it into the same segments the branch rules
    already reject. Decoding happens exactly once, as on the server, so
    ``%252F`` stays the literal ``%2F``.

    A browser removes ``.`` and ``..`` segments (also spelled ``%2e``) before
    the request leaves it, so ``/tree/v1.0/../master`` reaches GitHub as
    ``/tree/master``; the gate used to read ``v1.0`` from the unresolved path
    and accept a ``version = {v1.0}`` pin on what is really the branch.
    """

    resolved: list[str] = []
    for part in unquote(urlsplit(url).path).split("/"):
        if part == "..":
            if resolved:
                resolved.pop()
        elif part and part != ".":
            resolved.append(part)
    return resolved


def _authority_malformed(url: str) -> bool:
    """Whether ``url`` lacks the one authority a browser would resolve it to.

    WHATWG's special-scheme rules disagree with :mod:`urllib.parse` on two
    points that both let an ``http(s)`` URL through the scheme guard while
    still having no reliable host:

    * a run of ``/`` (or ``\\``) other than exactly two right after the
      scheme still reaches an authority for a special scheme like ``https``
      -- ``https:///x``, ``https:////x`` and ``https:x`` (no slash at all)
      all resolve to host ``x`` in a browser -- but ``urlsplit`` treats
      anything other than exactly ``//`` as "no authority", so ``hostname``
      is ``None`` and the URL would otherwise fall through to the
      non-code-host rules as if it had no recognisable host at all;
    * ``\\`` is accepted as a slash in the *authority* and *path* states for
      a special scheme, so ``github.com\\owner`` resolves to host
      ``github.com``, path ``/owner`` -- but ``urlsplit`` reads it as an
      ordinary path character, so the backslash and everything after it
      become part of the host string and match no code host.

    No legitimate bibliography URL needs an empty authority or a backslash,
    so both are treated as a hard error rather than routed as an ordinary
    web page: the caller must never read "hostname didn't match" as "this is
    not a code host" without first checking the authority parsed at all.
    """

    return "\\" in url or not urlsplit(url).hostname


def is_code_host(url: str) -> bool:
    return _host_in(_host(url), CODE_HOSTS + RAW_HOSTS)


def _is_gitlab(url: str) -> bool:
    return _host_in(_host(url), ("gitlab.com",))


def _page_path(url: str) -> list[str]:
    """The path segments after the repository (after GitLab's ``-`` separator).

    Only GitLab separates owner/(sub)groups/repo from the page kind with a
    ``-`` segment; on every other host ``-`` is an ordinary directory name.
    """

    segments = _segments(url)
    gitlab = _is_gitlab(url)
    if gitlab and "-" in segments[2:]:
        return segments[segments.index("-", 2) + 1 :]
    rest = segments[2:]
    known = _REF_MARKERS | {"releases", "tags"} | NON_SOURCE_PATHS
    if gitlab and not any(part in known for part in rest):
        return []  # /group/subgroup/repo without a page kind
    return rest


def _is_pin_form(rest: list[str], *, gitlab: bool) -> bool:
    """Whether the page path names a revision this module can validate."""

    if not rest:
        return True
    kind, following = rest[0], rest[1:]
    if kind in _REF_MARKERS or kind == "tags":
        return bool(following)
    if kind == "releases":
        if gitlab:
            return bool(following) and following[0] != "permalink"
        return len(following) >= 2 and following[0] in {"tag", "download"}
    return False


def repository_problem(url: str) -> str | None:
    """Why a code-host URL is not a repository or a pinned revision inside one."""

    segments = _segments(url)
    if len(segments) < 2:
        return "is not source: it names no repository (expected at least /owner/repo)"
    if _host_in(_host(url), RAW_HOSTS):
        if len(segments) < 4:
            return "is not source: a raw URL is /owner/repo/<revision>/<path>"
        return None
    rest = _page_path(url)
    if rest and rest[0] in NON_SOURCE_PATHS:
        return f"is a {rest[0]} page, not source"
    if not _is_pin_form(rest, gitlab=_is_gitlab(url)):
        return (
            f"is not source at a fixed revision: /{'/'.join(rest)} is none of {_PIN_FORMS}; "
            "a moving target (releases/latest, archive/..., a listing page) cannot be audited"
        )
    return None


def _named_ref(segments: list[str]) -> tuple[RefKind, str]:
    """The ref named by the path segments after a ``blob``/``tree``/raw marker.

    ``refs/heads/<name>`` is a branch and ``refs/tags/<name>`` a tag. Any other
    ``refs/...`` path is a ref namespace -- ``refs/pull/<n>/head``,
    ``refs/remotes/...``, ``refs/notes/...`` -- and those move, so they are
    reported as a branch named after the namespace; the gate used to read the
    bare word ``refs`` as a tag-like ref and accept ``version = {refs}``.
    """

    if segments[0] == "refs":
        if len(segments) >= 3 and segments[1] in {"heads", "tags"}:
            return ("tag" if segments[1] == "tags" else "branch"), segments[2]
        return "branch", "/".join(segments[:3])
    return "ref", segments[0]


def url_ref(url: str) -> tuple[RefKind, str] | None:
    """The revision a code-host URL names, if any.

    Returns ``("sha", <hex>)`` (case preserved, so the caller can insist on
    lowercase), ``("tag", <name>)`` for explicit tag paths, ``("branch",
    <name>)`` for explicit branch paths (``refs/heads/``, ``src/branch/``), or
    ``("ref", <name>)`` when the path names a tag or branch indistinguishably.
    Only the ambiguous ``ref`` kind is promoted to ``sha`` when the name is
    hex: an explicit tag called ``20240512`` stays a tag.
    """

    found: tuple[RefKind, str] | None = None
    if _host_in(_host(url), RAW_HOSTS):
        # raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
        segments = _segments(url)
        if len(segments) > 2:
            found = _named_ref(segments[2:])
    else:
        # Only the page path is searched: an owner or repository called
        # ``blob``, ``tree``, ``releases``, ``src`` ... is a name, not a marker.
        segments = _page_path(url)
        for index, segment in enumerate(segments):
            following = segments[index + 1 :]
            if (
                segment == "releases"
                and len(following) >= 2
                and following[0] in {"tag", "download"}
            ):
                found = "tag", following[1]
                break
            if (
                segment in _GITEA_MARKERS
                and len(following) >= 2
                and following[0] in {"commit", "branch", "tag"}
            ):
                # Gitea / Forgejo: src|raw|media / branch|tag|commit / <name>.
                kinds: dict[str, RefKind] = {"commit": "ref", "branch": "branch", "tag": "tag"}
                found = kinds[following[0]], following[1]
                break
            if segment == "releases" and following and _is_gitlab(url):
                found = "tag", following[0]  # GitLab: /-/releases/<tag>
                break
            if segment in _REF_MARKERS and following:
                found = _named_ref(following)
                break
            if segment == "tags" and following:
                found = "tag", following[0]
                break
    if found is None:
        return None
    kind, name = found
    if kind == "ref" and _HEX_ANY_CASE.match(name):
        return "sha", name
    return kind, name


def _sha_consistent(url_sha: str, commit: str) -> bool:
    return url_sha.startswith(commit) or commit.startswith(url_sha)


def _normalise_version(value: str) -> str:
    return value[1:] if value.startswith("v") else value


def _validate_code_host(entry: BibEntry, url: str) -> list[str]:
    key = entry.key
    problem = repository_problem(url)
    if problem:
        return [f"{key}: URL {url} {problem}"]
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
    if kind == "branch" or (kind == "ref" and name.lower() in BRANCH_NAMES):
        messages.append(
            f"{key}: URL names the branch {name!r}, which moves; pin a commit SHA or a tag "
            "in the URL"
        )
        return messages
    if kind == "sha":
        if not COMMIT_PATTERN.match(name):
            messages.append(f"{key}: URL SHA {name!r} must be lowercase hex")
        elif commit and COMMIT_PATTERN.match(commit) and not _sha_consistent(name, commit):
            messages.append(f"{key}: URL pins {name} but the commit field says {commit}")
        return messages
    version = entry.fields.get("version", "").strip()
    if not version:
        messages.append(
            f"{key}: URL names the {kind} {name!r} rather than a SHA; a version field "
            "is required alongside commit"
        )
    elif _normalise_version(version) != _normalise_version(name):
        messages.append(f"{key}: version {version!r} does not match the URL {kind} {name!r}")
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
        if SOURCE_AUDIT_KEYWORD not in keywords(entry):
            continue
        url = entry.fields.get("url", "").strip()
        if url and urlsplit(url).scheme not in {"http", "https"}:
            messages.append(f"{entry.key}: url {url!r} must start with http:// or https://")
        elif url and _authority_malformed(url):
            # Allow-list on a successfully normalised host: an authority that
            # did not parse is a hard error, never "not a code host".
            messages.append(
                f"{entry.key}: URL {url} is not a well-formed http(s) address "
                "(empty/ambiguous host or backslash); a browser would resolve it elsewhere"
            )
        elif url and is_code_host(url):
            messages.extend(_validate_code_host(entry, url))
        else:
            messages.extend(_validate_other(entry, url))
    return messages
