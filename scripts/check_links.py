"""Check that every cited URL and DOI still resolves.

Deliberately NOT part of ``make check`` / ``check.ps1``: it needs the network,
so a transient outage must not block local development or a code review. It
runs as its own scheduled CI job.

The gap this closes is real. Between 2026-08-22 and 2026-08-23 the point-group
table host ``symmetry.jacobs-university.de`` was already dead -- the university
had been renamed and the whole domain retired -- while every existing gate
stayed green, because nothing in the pipeline ever made an HTTP request.

Some publishers and community sites refuse automated clients outright. Those
are reported as BLOCKED rather than BROKEN: a 403 from a bot filter is not
evidence that a human cannot reach the page, and treating it as a failure would
train people to ignore this check.
"""

from __future__ import annotations

import argparse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from quviz.docs.bibliography import parse_bibtex_file

ROOT = Path(__file__).resolve().parents[1]
BIB_PATH = ROOT / "references.bib"
TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

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


def _probe(url: str) -> tuple[str, int | None, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return url, response.status, "ok"
    except urllib.error.HTTPError as exc:
        return url, exc.code, "http-error"
    except urllib.error.URLError as exc:
        return url, None, f"unreachable: {exc.reason}"
    except Exception as exc:  # pragma: no cover - defensive
        return url, None, f"error: {type(exc).__name__}: {exc}"


def classify(url: str, status: int | None, detail: str) -> str:
    if status is not None and 200 <= status < 400:
        return "OK"
    # 429 is rate limiting, never a dead link -- this checker's own concurrency
    # provokes it against GitHub. Reporting it as a failure would be noise.
    if status == 429:
        return "BLOCKED"
    if any(host in url for host in BOT_HOSTS) and status in {401, 403}:
        return "BLOCKED"
    if status is None or status in BROKEN_STATUSES or status >= 500:
        return "BROKEN"
    return "SUSPECT"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--include-doi",
        action="store_true",
        help="also resolve every DOI through doi.org",
    )
    args = parser.parse_args()

    bibliography = parse_bibtex_file(BIB_PATH)
    targets: dict[str, str] = {}
    for key, entry in bibliography.entries.items():
        if url := entry.fields.get("url"):
            targets.setdefault(url, key)
        if args.include_doi and (doi := entry.fields.get("doi")):
            targets.setdefault(f"https://doi.org/{doi}", key)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_probe, targets))

    buckets: dict[str, list[str]] = {"OK": [], "BLOCKED": [], "SUSPECT": [], "BROKEN": []}
    for url, status, detail in sorted(results):
        verdict = classify(url, status, detail)
        shown = status if status is not None else detail
        buckets[verdict].append(f"  [{targets[url]}] {shown} {url}")

    for verdict in ("BROKEN", "SUSPECT", "BLOCKED", "OK"):
        rows = buckets[verdict]
        if not rows:
            continue
        print(f"{verdict} ({len(rows)})")
        # Healthy links are summarised; problems are always listed in full.
        print("\n".join(rows if verdict != "OK" else rows[:0]))

    print(
        f"\nsummary: {len(buckets['OK'])} ok, {len(buckets['BLOCKED'])} blocked-by-bot-filter, "
        f"{len(buckets['SUSPECT'])} suspect, {len(buckets['BROKEN'])} broken"
    )
    if buckets["BROKEN"]:
        print("\nBROKEN links must be repointed or replaced with an archival citation.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
