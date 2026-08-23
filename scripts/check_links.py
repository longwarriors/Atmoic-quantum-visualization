"""Check that cited URLs and DOIs still resolve.

Two modes:

* the default **broad sweep** probes every ``url`` (and with ``--include-doi``
  every DOI) in ``references.bib``. It needs the network, so it is deliberately
  NOT part of ``make check`` / ``check.ps1`` -- a transient outage must not
  block local development -- and runs as the weekly ``link-check`` workflow,
  and as the ``changed-links`` job's fallback when there is no base revision
  to diff against (the first or a force push of ``master`` itself, or no
  ``origin/master`` at all). BROKEN and SUSPECT results fail the run; BLOCKED
  (a bot filter, see below, or a 429 rate limit) is tolerated.
* ``--changed-since <git-ref>`` probes only the URLs and DOIs *added* to
  ``references.bib`` and ``docs/`` since the merge base with ``<git-ref>``
  (the bibliography is compared as two parsed files, the docs as a line diff).
  This is the gate ``ci.yml`` runs on every push and pull request: a link
  being introduced has to be shown to work, so in this mode every result
  other than OK fails -- except BLOCKED, which is either a 401/403 from a
  host in ``BOT_HOSTS`` (cite such sources by DOI instead) or a 429 rate
  limit from any host; neither says anything about the link.

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

from quviz.docs.links import (
    VERDICTS,
    Row,
    added_bibliography_targets,
    added_urls,
    bibliography_targets,
    classify,
    fails_run,
    format_row,
    probe_target,
    step_summary,
)

ROOT = Path(__file__).resolve().parents[1]
BIB_NAME = "references.bib"
DOCS_DIR = "docs"
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
    # back off briefly and try again before reporting it. One that survives
    # the retries is BLOCKED and tolerated in both modes (quviz.docs.links).
    status, detail = _request(url)
    for delay in RETRY_DELAYS:
        if status != 429:
            break
        time.sleep(delay)
        status, detail = _request(url)
    return url, status, detail


def _git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=check, capture_output=True, text=True, encoding="utf-8"
    )


def _file_at(revision: str, path: str) -> str:
    """``path`` as committed at ``revision``; empty when it does not exist there."""

    result = _git("show", f"{revision}:{path}", check=False)
    if result.returncode == 0:
        return result.stdout
    if "does not exist in" in result.stderr or "exists on disk, but not in" in result.stderr:
        return ""
    raise subprocess.CalledProcessError(
        result.returncode, result.args, result.stdout, result.stderr
    )


def _changed_targets(git_ref: str) -> dict[str, str]:
    """URLs/DOIs added since the merge base with ``git_ref``, labelled by bib key.

    ``references.bib`` is compared as two parsed bibliographies (the merge
    base's and HEAD's), never as a line diff: a ``doi`` field in a
    single-line entry, on a line shared with other fields, or with its value
    wrapped onto the next line is a target like any other. ``docs/`` is prose,
    so its links are pulled from the line diff.
    """

    base = _git("merge-base", git_ref, "HEAD").stdout.strip()
    head_bib = _file_at("HEAD", BIB_NAME)
    targets = added_bibliography_targets(_file_at(base, BIB_NAME), head_bib)
    known = bibliography_targets(head_bib)
    docs_diff = _git("diff", base, "HEAD", "--", DOCS_DIR).stdout
    for url in added_urls(docs_diff):
        targets.setdefault(url, known.get(url, "docs"))
    return dict(sorted(targets.items()))


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
        targets = bibliography_targets(
            (ROOT / BIB_NAME).read_text(encoding="utf-8"), include_doi=args.include_doi
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_probe, targets))

    buckets: dict[str, list[Row]] = {verdict: [] for verdict in VERDICTS}
    for url, status, detail in sorted(results):
        shown = str(status) if status is not None else detail
        buckets[classify(url, status)].append((targets[url], shown, url))

    failed = False
    for verdict in VERDICTS:
        rows = buckets[verdict]
        if not rows:
            continue
        print(f"{verdict} ({len(rows)})")
        # Healthy links are summarised; problems are always listed in full.
        for row in rows if verdict != "OK" else []:
            fails = fails_run(verdict, row[2], strict=strict)
            failed = failed or fails
            print(f"  {format_row(row)}" + ("" if fails else "  (tolerated)"))

    print(
        f"\nsummary: {len(buckets['OK'])} ok, {len(buckets['BLOCKED'])} blocked-by-bot-filter, "
        f"{len(buckets['SUSPECT'])} suspect, {len(buckets['BROKEN'])} broken"
    )
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write(step_summary(buckets, strict=strict))

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
