"""Check that cited URLs and DOIs still resolve.

Two modes:

* the default **broad sweep** probes every ``url`` (and with ``--include-doi``
  every DOI) in ``references.bib``. It needs the network, so it is deliberately
  NOT part of ``make check`` / ``check.ps1`` -- a transient outage must not
  block local development -- and runs as the weekly ``link-check`` workflow.
  BROKEN and SUSPECT results fail the run; BLOCKED (a bot filter, see below)
  is tolerated.
* ``--changed-since <git-ref>`` probes only the URLs and DOIs *added* to
  ``references.bib`` and ``docs/`` since the merge base with ``<git-ref>``.
  This is the pull-request gate in ``ci.yml``: a link being introduced has to
  be shown to work, so in this mode *any* result other than OK fails.

The gap the sweep closes is real. Between 2026-08-22 and 2026-08-23 the
point-group table host ``symmetry.jacobs-university.de`` was already dead --
the university had been renamed and the whole domain retired -- while every
existing gate stayed green, because nothing in the pipeline ever made an HTTP
request.

Some publishers and community sites refuse automated clients outright. Those
are reported as BLOCKED rather than BROKEN: a 403 from a bot filter is not
evidence that a human cannot reach the page, and treating it as a failure in
the weekly sweep would train people to ignore this check.

Known limitation: ``urllib`` follows redirects, and the final 200 is what gets
classified. A URL that now redirects to a generic landing page ("this project
has moved", a publisher's home page, a soft-404) is therefore still reported
OK. Content-level checks are out of scope here; the human review of a new
citation remains responsible for confirming the page says what is cited.

DOIs are checked against the doi.org handle API (200 = registered, 404 = no
such DOI) rather than by following the resolver into the publisher site, so
a publisher bot filter cannot masquerade as a verdict about the DOI.

When ``$GITHUB_STEP_SUMMARY`` is set, a Markdown summary is appended to it.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from quviz.docs.bibliography import parse_bibtex_file
from quviz.docs.links import (
    VERDICTS,
    added_urls,
    classify,
    failing_verdicts,
    probe_target,
    step_summary,
)

ROOT = Path(__file__).resolve().parents[1]
BIB_PATH = ROOT / "references.bib"
CHANGED_PATHS = ("references.bib", "docs")
TIMEOUT = 30
RETRY_DELAYS = (3, 6)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _request(url: str) -> tuple[int | None, str]:
    request = urllib.request.Request(
        probe_target(url), headers={"User-Agent": USER_AGENT}, method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, "ok"
    except urllib.error.HTTPError as exc:
        return exc.code, "http-error"
    except urllib.error.URLError as exc:
        return None, f"unreachable: {exc.reason}"
    except Exception as exc:  # pragma: no cover - defensive
        return None, f"error: {type(exc).__name__}: {exc}"


def _probe(url: str) -> tuple[str, int | None, str]:
    # 429 is usually this script's own concurrency (GitHub in particular);
    # back off briefly and try again before reporting it.
    status, detail = _request(url)
    for delay in RETRY_DELAYS:
        if status != 429:
            break
        time.sleep(delay)
        status, detail = _request(url)
    return url, status, detail


def _bibliography_targets(include_doi: bool) -> dict[str, str]:
    """Every cited URL (and optionally DOI) mapped to the first key citing it."""

    bibliography = parse_bibtex_file(BIB_PATH)
    targets: dict[str, str] = {}
    for key, entry in bibliography.entries.items():
        if url := entry.fields.get("url"):
            targets.setdefault(url, key)
        if include_doi and (doi := entry.fields.get("doi")):
            targets.setdefault(f"https://doi.org/{doi}", key)
    return targets


def _changed_targets(git_ref: str) -> dict[str, str]:
    """URLs/DOIs added since the merge base with ``git_ref``, labelled by bib key."""

    diff = subprocess.run(
        ["git", "diff", f"{git_ref}...HEAD", "--", *CHANGED_PATHS],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    known = _bibliography_targets(include_doi=True)
    return {url: known.get(url, "docs") for url in sorted(added_urls(diff))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--include-doi",
        action="store_true",
        help="broad sweep only: also check every DOI against the doi.org handle API",
    )
    parser.add_argument(
        "--changed-since",
        metavar="GIT_REF",
        help=(
            "probe only the URLs/DOIs added to references.bib and docs/ since the merge "
            "base with GIT_REF; every non-OK result fails"
        ),
    )
    args = parser.parse_args()
    strict = args.changed_since is not None

    if strict:
        targets = _changed_targets(args.changed_since)
        if not targets:
            print(f"no new links since {args.changed_since}; nothing to probe")
            return 0
        print(f"probing {len(targets)} link(s) added since {args.changed_since}")
    else:
        targets = _bibliography_targets(args.include_doi)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_probe, targets))

    buckets: dict[str, list[str]] = {verdict: [] for verdict in VERDICTS}
    for url, status, detail in sorted(results):
        verdict = classify(url, status, detail)
        shown = status if status is not None else detail
        buckets[verdict].append(f"  [{targets[url]}] {shown} {url}")

    failing = failing_verdicts(strict=strict)
    for verdict in VERDICTS:
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
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write(step_summary(buckets, failing=failing))

    failed = [verdict for verdict in VERDICTS if verdict in failing and buckets[verdict]]
    if failed:
        if strict:
            print("\nA newly added link must resolve cleanly; fix or replace it before merging.")
        else:
            print(
                "\nBROKEN links must be repointed or replaced with an archival citation; "
                "SUSPECT links need a human look (and a BOT_HOSTS entry if it is a bot filter)."
            )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
