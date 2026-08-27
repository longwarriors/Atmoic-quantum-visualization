"""Regenerate ``tests/fixtures/openapi.json`` from the live FastAPI app.

Run it whenever a route, a query parameter or a response model changes::

    uv run python scripts/write_openapi.py

The file it writes is the one *input* the front-end's type generation has:
``web/scripts/generate-api-types.mjs`` reads it and writes
``web/src/api/schema.gen.ts``, which is what ``tsc`` holds the front-end to. So
this file is a build artefact of the Python API and a source of the TypeScript
build at the same time, and it is committed for exactly that reason -- the two
halves never meet at run time, and a generator that reached a running server
would make the front-end build depend on one.

``tests/test_openapi_contract.py`` compares the live app's canonical dump to
the committed bytes and fails on any difference, so the fixture cannot drift
behind the API silently; ``web/src/api/schema.gen.test.ts`` compares the
committed types to what this fixture generates, so the types cannot drift
behind the fixture either. Between them the chain
``routes -> openapi.json -> schema.gen.ts`` has no unwatched link.

The dump is canonical so that the byte comparison is about the schema and not
about incidental formatting:

* ``sort_keys=True`` -- FastAPI builds the document from dicts whose insertion
  order follows the order routes and models happen to be declared in; sorting
  makes a reordering a no-op instead of a spurious API-change diff.
* ``indent=2`` -- a readable diff is the whole point of committing it.
* ``ensure_ascii=False`` -- a docstring with a non-ASCII character stays
  readable rather than becoming an escape soup, and UTF-8 is what both readers
  use.
* ``allow_nan=False`` -- Python's ``json`` writes the bare tokens ``NaN`` /
  ``Infinity`` by default, which no JSON parser outside Python accepts. A
  non-finite value in a schema (a default, an example, a bound) must raise
  here rather than land in a file that Node then fails to parse. This is the
  same raw-text concern the API's own NaN gates carry.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from quviz.api.app import create_app

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "openapi.json"


def live_document() -> dict[str, Any]:
    """The OpenAPI document of the app as it is configured for the API tests.

    ``mount_frontend=False`` because the static-file mount is a deployment
    detail with no schema of its own: whether ``web/dist`` happens to exist in
    the checkout that runs this must not change the generated types.
    """

    return create_app(mount_frontend=False).openapi()


def canonical(document: Mapping[str, Any]) -> str:
    """``document`` as the exact text the fixture holds, trailing newline included."""

    text = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    return f"{text}\n"


def main() -> None:
    # ``newline="\n"`` because the default on Windows translates to CRLF, and
    # .gitattributes checks this tree out with LF: without it every
    # regeneration on Windows would rewrite the whole file.
    FIXTURE.write_text(canonical(live_document()), encoding="utf-8", newline="\n")
    print(f"{FIXTURE} ({FIXTURE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
