"""Network-free parts of the citation link checker.

``scripts/check_links.py`` does the HTTP work; everything that can be unit
tested without a socket -- pulling URLs out of a diff, turning a status code
into a verdict, deciding which results fail a run, rendering a summary --
lives here so pytest can cover it offline.

Some publishers and community sites (``BOT_HOSTS``) answer 401/403 to every
automated client. A link there is reported BLOCKED, never BROKEN, and BLOCKED
is tolerated in both modes for those hosts: the weekly sweep because a bot
filter is not evidence of rot, the pull-request gate because failing on it
would only teach people to ignore the gate. The price is that such a link is
never actually verified, so sources on those hosts should be cited by DOI --
the DOI is checked against the doi.org handle API, which does answer.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

# A URL ends at whitespace, a non-ASCII character (in Chinese prose the
# ideographic full stop U+3002 or comma U+FF0C directly follows a bare URL) or
# a Markdown/BibTeX delimiter; one level of balanced parentheses is allowed
# because DOIs such as ``10.1016/0021-9991(82)90091-2`` contain them.
_URL_PATTERN = re.compile(r"""https?://(?:(?![<>"'()\[\]{}`])[!-~]|\([^\s()]*\))+""")
_DOI_FIELD = re.compile(r"""^\s*doi\s*=\s*["{]\s*([^"}]+?)\s*["}]\s*,?\s*$""", re.IGNORECASE)
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
    """URLs and DOIs that a unified diff introduces.

    ``+`` lines contribute, ``-`` lines subtract, so a link that merely moved
    is not re-probed. A BibTeX ``doi = {...}`` field becomes its ``doi.org``
    resolver URL. File headers (``+++``/``---``) are ignored.
    """

    added: set[str] = set()
    removed: set[str] = set()
    for line in diff_text.splitlines():
        if line.startswith(("+++", "---")):
            continue
        if line.startswith("+"):
            bucket = added
        elif line.startswith("-"):
            bucket = removed
        else:
            continue
        body = line[1:]
        bucket |= extract_urls(body)
        if doi := _DOI_FIELD.match(body):
            bucket.add(f"https://doi.org/{doi.group(1)}")
    return added - removed


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


def is_bot_host(url: str) -> bool:
    return any(host in url for host in BOT_HOSTS)


def classify(url: str, status: int | None) -> str:
    """Map a probe result to ``OK`` / ``BLOCKED`` / ``SUSPECT`` / ``BROKEN``."""

    if status is not None and 200 <= status < 400:
        return "OK"
    # 429 is rate limiting, never a dead link -- the checker's own concurrency
    # provokes it against GitHub. Reporting it as a failure would be noise.
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
    success). BLOCKED is tolerated in the weekly sweep; the pull-request mode
    (``strict``) tolerates it only for ``BOT_HOSTS``, where a 403 is the
    host's policy rather than evidence about the link -- elsewhere a link
    being *added* has to be shown to work.
    """

    if verdict in {"BROKEN", "SUSPECT"}:
        return True
    if verdict == "BLOCKED":
        return strict and not is_bot_host(url)
    return False


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
