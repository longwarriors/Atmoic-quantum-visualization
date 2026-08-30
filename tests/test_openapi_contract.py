"""The committed OpenAPI fixture must be byte-for-byte the live app's schema.

``tests/fixtures/openapi.json`` is not documentation. It is the *input* to
``web/scripts/generate-api-types.mjs``, which turns it into
``web/src/api/schema.gen.ts`` -- the TypeScript types the front-end compiles
against. So the fixture sits between two halves that never meet at run time:
the Python route signatures on one side, ``tsc`` on the other.

That makes exactly one failure mode worth gating, and it is silent: a route,
a query parameter or a response model changes in ``src/quviz/api/`` and the
fixture does not, so the generated types keep describing yesterday's API and
the front-end keeps compiling against a contract the server no longer serves.
Nothing else in either suite notices -- the Python tests drive the live app and
pass, the web tests read the committed types and pass.

This test closes that by refusing any difference at all between the live app's
canonical dump and the committed bytes. Regenerate with::

    uv run python scripts/write_openapi.py

and read the diff before committing it: a surprise here is an API change, and
an API change is a front-end change.

The dump is canonical (``sort_keys``, fixed indent, ``ensure_ascii=False``) so
that the comparison is about the schema and not about dict ordering, and
``allow_nan=False`` so that a non-finite number raises here rather than being
written as the bare ``NaN`` token that no JSON parser outside Python accepts --
the same raw-text concern the API's own NaN gates carry.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "write_openapi.py"
FIXTURE = ROOT / "tests" / "fixtures" / "openapi.json"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


write_openapi = _load_script(SCRIPT)


def test_committed_openapi_fixture_is_the_live_schema_byte_for_byte() -> None:
    """The whole gate. Any drift at all, in either direction, fails here."""

    assert FIXTURE.is_file(), (
        f"{FIXTURE} does not exist; generate it with `uv run python scripts/write_openapi.py`"
    )
    # ``read_bytes`` rather than ``read_text``: on Windows text mode would
    # translate the committed LF line endings and the comparison would be
    # about newline handling instead of about the schema.
    committed = FIXTURE.read_bytes().decode("utf-8")
    live = write_openapi.canonical(write_openapi.live_document())
    assert live == committed, (
        "tests/fixtures/openapi.json is not what the live app serves. The generated TypeScript "
        "types in web/src/api/schema.gen.ts are built from this file, so the front-end is "
        "compiling against a contract the server no longer has. Regenerate with `uv run python "
        "scripts/write_openapi.py`, regenerate the types with `npm run codegen` in web/, and "
        "review both diffs as the API change they are."
    )


def test_a_mutated_schema_no_longer_matches_the_fixture() -> None:
    """Negative control: the comparison above must be able to fail.

    Without this, a ``canonical`` that returned a constant -- or a fixture
    written by the same code path that reads it back -- would pass the test
    above while comparing nothing. Here the live document is copied, one
    documented field is changed, and the canonical dump of the copy must
    differ from the committed bytes.
    """

    committed = FIXTURE.read_bytes().decode("utf-8")
    document: dict[str, Any] = json.loads(json.dumps(write_openapi.live_document()))
    info = document["info"]
    assert isinstance(info, dict) and "title" in info, document.keys()
    info["title"] = f"{info['title']} (mutated)"

    assert write_openapi.canonical(document) != committed, (
        "a mutated OpenAPI document produced the committed bytes, so the byte comparison above "
        "is not actually comparing the schema"
    )


def test_the_canonical_dump_is_sorted_indented_and_finite_only() -> None:
    """The properties the byte comparison depends on, stated as their own test.

    ``sort_keys`` is what makes the comparison insensitive to the order
    FastAPI happens to build its dicts in; without it a harmless reordering
    would read as an API change and the gate would be retrained to ignore
    diffs. ``allow_nan=False`` is what makes a non-finite value an error here
    rather than the bare ``NaN`` token in a file a JavaScript parser reads.
    """

    dumped = write_openapi.canonical({"b": 1, "a": {"d": 2, "c": 3}})
    assert dumped == '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n'

    try:
        write_openapi.canonical({"x": float("nan")})
    except ValueError:
        pass
    else:  # pragma: no cover - only reached if allow_nan was dropped
        raise AssertionError(
            "canonical() serialised a non-finite float; allow_nan=False must reject it, or the "
            "fixture can carry the bare NaN token that no JSON parser outside Python accepts"
        )


def test_point_cloud_openapi_declares_the_binary_wire_format() -> None:
    """Swagger and generated docs must not advertise QVPC/1 as JSON."""

    response = write_openapi.live_document()["paths"]["/api/orbitals/point-cloud"]["get"][
        "responses"
    ]["200"]
    assert set(response["content"]) == {"application/vnd.quviz.point-cloud"}
    assert response["content"]["application/vnd.quviz.point-cloud"]["schema"] == {
        "type": "string",
        "format": "binary",
    }
