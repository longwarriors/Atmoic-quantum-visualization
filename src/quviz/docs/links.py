"""Network-free parts of the citation link checker.

``scripts/check_links.py`` does the HTTP work; everything that can be unit
tested without a socket -- pulling URLs out of a diff or a bibliography, turning a status code
into a verdict, deciding which results fail a run, rendering a summary --
lives here so pytest can cover it offline.

BLOCKED means the probe was refused for a reason that says nothing about the
link: some publishers and community sites (``BOT_HOSTS``) answer 401/403 to
every automated client, and any host may answer 429 when the checker's own
concurrency trips its rate limit. A BLOCKED link is tolerated in both modes
-- the weekly sweep because a bot filter or a rate limit is not evidence of
rot, the pull-request gate because failing on it would only teach people to
ignore the gate. The price is that such a link is never actually verified, so
sources on the bot-filter hosts should be cited by DOI -- the DOI is checked
against the doi.org handle API, which does answer. A 401/403 from any other
host is SUSPECT and fails either mode.
"""

from __future__ import annotations

import re
import urllib.parse
from collections.abc import Mapping, Sequence

from quviz.docs.bibliography import parse_bibtex

# A URL ends at whitespace, a non-ASCII character (in Chinese prose the
# ideographic full stop U+3002 or comma U+FF0C directly follows a bare URL) or
# a Markdown/BibTeX delimiter; one level of balanced parentheses is allowed
# because DOIs such as ``10.1016/0021-9991(82)90091-2`` contain them.
_URL_PATTERN = re.compile(r"""https?://(?:(?![<>"'()\[\]{}`])[!-~]|\([^\s()]*\))+""")
# Sentence punctuation and emphasis markers that end up glued to a bare URL.
_TRAILING_PUNCTUATION = ".,;:!?*_"

# Hosts known to reject automated clients. A 403 from these is not a dead link.
BOT_HOSTS = (
    "zhihu.com",
    "link.aps.org",
    "journals.aps.org",
    "sciencedirect.com",
    "pubs.acs.org",
    "cambridge.org",
    "doi.org",
)

BROKEN_STATUSES = {404, 410}
VERDICTS = ("BROKEN", "SUSPECT", "BLOCKED", "OK")

# One probed link: (bibliography key or "docs", what the probe returned, URL).
Row = tuple[str, str, str]


def extract_urls(text: str) -> set[str]:
    """Every ``http(s)`` URL in ``text``, trailing punctuation/emphasis removed."""

    return {match.group(0).rstrip(_TRAILING_PUNCTUATION) for match in _URL_PATTERN.finditer(text)}


def added_urls(diff_text: str) -> set[str]:
    """URLs that a unified diff of prose (``docs/*.md``) introduces.

    ``+`` lines contribute, ``-`` lines subtract, so a link that merely moved
    is not re-probed. File headers (``+++``/``---``) are ignored.

    This is only for prose. ``references.bib`` is *not* diffed line by line:
    a BibTeX field can share a line with other fields, sit in a single-line
    entry or wrap its value onto the next line, so a line regex for
    ``doi = {...}`` missed DOIs and the gate never probed them. The
    bibliography goes through ``added_bibliography_targets`` instead.
    """

    added: set[str] = set()
    removed: set[str] = set()
    for line in diff_text.splitlines():
        if line.startswith(("+++", "---")):
            continue
        if line.startswith("+"):
            added |= extract_urls(line[1:])
        elif line.startswith("-"):
            removed |= extract_urls(line[1:])
    return added - removed


def bibliography_targets(text: str, *, include_doi: bool = True) -> dict[str, str]:
    """Every URL (and DOI, as its ``doi.org`` resolver URL) cited in BibTeX ``text``.

    Maps each target to the first key citing it. ``text`` is parsed with the
    project's BibTeX reader, so field layout is irrelevant. Empty text -- the
    file does not exist at that revision -- has no targets.
    """

    if not text.strip():
        return {}
    targets: dict[str, str] = {}
    for key, entry in parse_bibtex(text).entries.items():
        if url := entry.fields.get("url"):
            targets.setdefault(url, key)
        if include_doi and (doi := entry.fields.get("doi")):
            targets.setdefault(f"https://doi.org/{doi}", key)
    return targets


def added_bibliography_targets(base_text: str, head_text: str) -> dict[str, str]:
    """Targets ``head_text`` cites that ``base_text`` does not, keyed by bib key.

    A target that merely moved between entries, or whose field was reformatted,
    is not new; a changed DOI or URL value is.
    """

    base = bibliography_targets(base_text)
    return {url: key for url, key in bibliography_targets(head_text).items() if url not in base}


_DOI_RESOLVER = re.compile(r"^https?://(?:dx\.)?doi\.org/(?!api/handles/)(?P<doi>10\.\S+)$")
HANDLE_API = "https://doi.org/api/handles/"


def probe_target(url: str) -> str:
    """The URL actually requested for ``url``.

    A ``doi.org`` resolver link is rewritten to the handle API, which answers
    200 for a registered DOI and 404 for an unknown one. Following the
    resolver's redirect instead lands on the publisher, whose bot filter may
    return 403 -- a verdict about the publisher's firewall, not the DOI.
    """

    if match := _DOI_RESOLVER.match(url):
        return HANDLE_API + match.group("doi")
    return url


def _hostname(url: str) -> str | None:
    """The normalised hostname of ``url``: lowercase, no trailing dot, no port/userinfo."""

    try:
        host = urllib.parse.urlsplit(url).hostname
    except ValueError:
        return None
    return host.rstrip(".").lower() if host else None


def is_bot_host(url: str) -> bool:
    """Whether ``url`` is served by a host in ``BOT_HOSTS`` or one of its subdomains.

    Only the hostname counts. This used to be a substring test over the whole
    URL, so a 403 from ``https://evil.example/x?u=doi.org`` or
    ``https://doi.org.evil.example/`` was BLOCKED and tolerated by the gate.
    """

    host = _hostname(url)
    if host is None:
        return False
    return any(host == bot or host.endswith("." + bot) for bot in BOT_HOSTS)


def classify(url: str, status: int | None) -> str:
    """Map a probe result to ``OK`` / ``BLOCKED`` / ``SUSPECT`` / ``BROKEN``."""

    if status is not None and 200 <= status < 400:
        return "OK"
    # 429 is rate limiting, never a dead link -- the checker's own concurrency
    # provokes it against GitHub. It is BLOCKED on every host, and BLOCKED is
    # tolerated in both modes (see ``fails_run``): failing on it would be noise.
    if status == 429:
        return "BLOCKED"
    if is_bot_host(url) and status in {401, 403}:
        return "BLOCKED"
    if status is None or status in BROKEN_STATUSES or status >= 500:
        return "BROKEN"
    return "SUSPECT"


def fails_run(verdict: str, url: str, *, strict: bool) -> bool:
    """Whether one result makes the run exit non-zero.

    BROKEN and SUSPECT always fail (SUSPECT used to be silently reported as
    success). BLOCKED is tolerated in both modes: it only ever means a bot
    filter on a ``BOT_HOSTS`` host or a 429 rate limit, neither of which is
    evidence about the link. The pull-request mode (``strict``) used to fail a
    429 off the bot-filter hosts, which contradicted ``classify``'s own
    reasoning; a 403 off those hosts is SUSPECT and still fails. ``url`` and
    ``strict`` no longer influence the verdict; they stay in the signature for
    the existing call sites.
    """

    del url, strict
    return verdict in {"BROKEN", "SUSPECT"}


def format_row(row: Row) -> str:
    key, shown, url = row
    return f"[{key}] {shown} {url}"


def step_summary(buckets: Mapping[str, Sequence[Row]], *, strict: bool) -> str:
    """Markdown for ``$GITHUB_STEP_SUMMARY``: counts, then every non-OK row."""

    lines = [
        "## Citation link check",
        "",
        f"{len(buckets.get('OK', ()))} ok, {len(buckets.get('BLOCKED', ()))} blocked-by-bot-filter, "
        f"{len(buckets.get('SUSPECT', ()))} suspect, {len(buckets.get('BROKEN', ()))} broken",
        "",
    ]
    for verdict in VERDICTS:
        rows = buckets.get(verdict, ())
        if verdict == "OK" or not rows:
            continue
        lines.extend([f"### {verdict} ({len(rows)})", ""])
        for row in rows:
            marker = "fails the run" if fails_run(verdict, row[2], strict=strict) else "tolerated"
            lines.append(f"- `{format_row(row)}` -- {marker}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
