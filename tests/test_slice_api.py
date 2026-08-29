"""HTTP contract for the two slice routes.

The builders own the physics; this file owns what crosses the wire. Three
things are gated here and nowhere else.

**The raw text must be JSON.** Python's ``json`` writes the bare ``NaN``,
``Infinity`` and ``-Infinity`` tokens that ``JSON.parse`` in a browser refuses,
and whether they reach the wire is a property of the *response class*, not of
the payload: the pinned Starlette renders with ``allow_nan=False``, so today a
non-finite sample is a server-side error rather than a token, but any custom
encoder, any ``JSONResponse`` subclass, or a downgrade puts the tokens back.
A slice is the payload where that would happen unnoticed -- ``resolution**2``
samples, many of them at cancellation magnitudes -- so the gate reads
``response.text`` rather than ``response.json()``: the latter is Python's
permissive parser and accepts exactly the bytes that break the front-end. The
negative control for this gate is a permissive encoder, not a stray ``nan``.

**Every expected scientific refusal must arrive as a 422.** Domain and numerical
failures can arise below the route (for example from the parity, resolution and
term-spec guards); a route that let one escape would answer 500, while an
unexpected programming error must not be hidden by a blanket catch.

**``a_mu`` is exposed here and only here.** ``/api/orbitals/slice`` is the sole
eigenstate route that takes the reduced-mass Bohr length, so this file is the
only place that can prove the value reaches the metadata rather than being
accepted and dropped.
"""

from __future__ import annotations

import json
from typing import Any, NoReturn

import pytest
from fastapi.testclient import TestClient

from quviz.api.app import create_app

client = TestClient(create_app(mount_frontend=False))

SMALL = 65
BOHR_PAIR = "1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"

EIGENSTATE_SLICE = "/api/orbitals/slice"
SUPERPOSITION_SLICE = "/api/superposition/slice"

#: A 2p_z phase slice: the case whose masked samples would carry cancellation
#: residue, and whose values are therefore the most likely to be non-finite.
EIGENSTATE_CELL: dict[str, Any] = {
    "n": 2,
    "l": 1,
    "m": 0,
    "basis": "real",
    "plane": "xz",
    "observable": "phase",
    "resolution": SMALL,
}
SUPERPOSITION_CELL: dict[str, Any] = {
    "terms": BOHR_PAIR,
    "time": 3.5,
    "basis": "complex",
    "plane": "xz",
    "observable": "phase",
    "resolution": SMALL,
}


def _reject_json_constant(token: str) -> NoReturn:
    """Fail loudly instead of silently parsing a token JSON does not define."""

    raise AssertionError(
        f"the response body carries the bare {token!r} token, which Python's json accepts "
        "and no JSON parser outside Python does"
    )


@pytest.mark.parametrize(
    ("path", "params"),
    [(EIGENSTATE_SLICE, EIGENSTATE_CELL), (SUPERPOSITION_SLICE, SUPERPOSITION_CELL)],
    ids=["eigenstate", "superposition"],
)
def test_slice_routes_serve_a_slice_payload(path: str, params: dict[str, Any]) -> None:
    response = client.get(path, params=params)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["metadata"]["representation"] == "slice"
    assert payload["plane"] == "xz"
    assert payload["slice_observable"] == "phase"
    resolution = int(params["resolution"])
    assert payload["resolution"] == resolution
    assert len(payload["values"]) == resolution * resolution
    assert payload["layout"] == "row_major_v_rows_u_columns"
    assert payload["normal"] == [0.0, -1.0, 0.0]
    assert len(payload["valid_mask"]) == resolution * resolution


@pytest.mark.parametrize(
    ("path", "params"),
    [(EIGENSTATE_SLICE, EIGENSTATE_CELL), (SUPERPOSITION_SLICE, SUPERPOSITION_CELL)],
    ids=["eigenstate", "superposition"],
)
def test_slice_response_text_is_parsable_json_with_no_nan_tokens(
    path: str, params: dict[str, Any]
) -> None:
    """The load-bearing gate: read the bytes, not Python's forgiving parser."""

    response = client.get(path, params=params)

    assert response.status_code == 200, response.text
    assert "NaN" not in response.text
    assert "Infinity" not in response.text
    parsed = json.loads(response.text, parse_constant=_reject_json_constant)
    resolution = int(params["resolution"])
    assert len(parsed["values"]) == resolution * resolution


@pytest.mark.parametrize(
    ("path", "params"),
    [
        (EIGENSTATE_SLICE, {**EIGENSTATE_CELL, "plane": "xy"}),
        (EIGENSTATE_SLICE, {**EIGENSTATE_CELL, "observable": "wavefunction_imag"}),
        (SUPERPOSITION_SLICE, {**SUPERPOSITION_CELL, "observable": "probability_density"}),
    ],
    ids=["fully-masked-plane", "imaginary-part-of-a-real-orbital", "superposition-density"],
)
def test_degenerate_slices_still_serialize_without_nan(path: str, params: dict[str, Any]) -> None:
    """The zero-amplitude and identically-zero fields are where NaN would appear."""

    response = client.get(path, params=params)

    assert response.status_code == 200, response.text
    assert "NaN" not in response.text
    assert "Infinity" not in response.text
    json.loads(response.text, parse_constant=_reject_json_constant)


def test_even_resolution_is_refused_with_the_parity_reason() -> None:
    """66 clears the floor, so only the builder's parity guard can refuse it."""

    response = client.get(EIGENSTATE_SLICE, params={**EIGENSTATE_CELL, "resolution": 66})

    assert response.status_code == 422
    assert "odd" in response.json()["detail"]


def test_resolution_below_the_shell_floor_is_refused_by_the_builder() -> None:
    """65 is odd and inside the query bounds; the 16n+17 floor is what binds."""

    response = client.get(
        EIGENSTATE_SLICE,
        params={**EIGENSTATE_CELL, "n": 6, "l": 0, "m": 0, "resolution": 65},
    )

    assert response.status_code == 422
    assert "at least 113" in response.json()["detail"]


@pytest.mark.parametrize("resolution", [63, 515], ids=["under-floor", "over-ceiling"])
def test_resolutions_outside_the_query_bounds_are_refused_by_fastapi(resolution: int) -> None:
    response = client.get(EIGENSTATE_SLICE, params={**EIGENSTATE_CELL, "resolution": resolution})

    assert response.status_code == 422


@pytest.mark.parametrize(
    "override",
    [
        {"m": 2},
        {"plane": "xw"},
        {"observable": "probability_current"},
        {"observable": "wavefunction"},
    ],
    ids=["m-exceeds-l", "unknown-plane", "vector-observable", "unsplit-wavefunction"],
)
def test_the_eigenstate_slice_route_refuses_impossible_requests(
    override: dict[str, Any],
) -> None:
    response = client.get(EIGENSTATE_SLICE, params={**EIGENSTATE_CELL, **override})

    assert response.status_code == 422


@pytest.mark.parametrize(
    "terms",
    [
        "nonsense",
        "1,0,0",
        "1,0,0,0.5;2,1,0,0.5",
        "2,1,2,1.0",
        "1,0,0,nan",
    ],
    ids=["unparsable", "too-few-fields", "unnormalized", "m-exceeds-l", "non-finite"],
)
def test_the_superposition_slice_route_refuses_bad_term_specs(terms: str) -> None:
    response = client.get(SUPERPOSITION_SLICE, params={**SUPERPOSITION_CELL, "terms": terms})

    assert response.status_code == 422


@pytest.mark.parametrize(
    "override",
    [{"plane": "zz"}, {"observable": "streamlines"}, {"resolution": 130}],
    ids=["unknown-plane", "unknown-observable", "even-resolution"],
)
def test_the_superposition_slice_route_refuses_impossible_requests(
    override: dict[str, Any],
) -> None:
    response = client.get(SUPERPOSITION_SLICE, params={**SUPERPOSITION_CELL, **override})

    assert response.status_code == 422


def test_catalog_publishes_the_exact_first_accepted_superposition_slice_grid() -> None:
    entries = client.get("/api/superposition/catalog").json()
    floors = {entry["id"]: entry["slice_resolution_floor"] for entry in entries}

    assert floors == {
        "1s-2pz": 65,
        "2s-2pz": 65,
        "1s-3dz2": 103,
        "2pplus-2pminus": 65,
    }
    mixed = next(entry for entry in entries if entry["id"] == "1s-3dz2")
    base = {
        **SUPERPOSITION_CELL,
        "terms": mixed["terms"],
        "observable": "probability_density",
    }
    below = client.get(SUPERPOSITION_SLICE, params={**base, "resolution": 101})
    first = client.get(SUPERPOSITION_SLICE, params={**base, "resolution": 103})

    assert below.status_code == 422
    assert "at least 103" in below.json()["detail"]
    assert first.status_code == 200, first.text
    assert first.json()["resolution"] == 103


def test_a_mu_reaches_the_metadata_of_the_eigenstate_slice() -> None:
    """A muonic length must report a muonic energy, not the m_e number.

    ``/api/orbitals/slice`` is the only eigenstate route exposing ``a_mu``, so a
    route that accepted the parameter and dropped it would be invisible
    everywhere else in the suite.
    """

    cell = {**EIGENSTATE_CELL, "n": 1, "l": 0, "m": 0, "observable": "probability_density"}
    default = client.get(EIGENSTATE_SLICE, params=cell)
    muonic = client.get(EIGENSTATE_SLICE, params={**cell, "a_mu": 0.5})

    assert default.status_code == muonic.status_code == 200
    assert default.json()["metadata"]["energy_hartree"] == pytest.approx(-0.5)
    assert muonic.json()["metadata"]["energy_hartree"] == pytest.approx(-1.0)
    assert muonic.json()["metadata"]["state"]["a_mu"] == 0.5
    # The shorter length also contracts the derived extent, so a_mu is not
    # merely being echoed back into the metadata.
    assert muonic.json()["extent_bohr"] < default.json()["extent_bohr"]


def test_openapi_describes_the_slice_contracts() -> None:
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert EIGENSTATE_SLICE in paths
    assert SUPERPOSITION_SLICE in paths

    schemas = schema["components"]["schemas"]
    assert "SlicePayload" in schemas
    assert "SuperpositionSlicePayload" in schemas
    properties = schemas["SlicePayload"]["properties"]
    for field in (
        "plane",
        "slice_observable",
        "origin_bohr",
        "u_axis",
        "v_axis",
        "normal",
        "extent_bohr",
        "spacing_bohr",
        "resolution",
        "layout",
        "value_unit",
        "values",
        "valid_mask",
        "masked_value_sentinel",
        "phase_mask_relative_amplitude",
        "phase_mask_amplitude_scale",
        "phase_mask_amplitude_threshold",
        "phase_mask_numeric_floor",
        "max_amplitude_on_plane",
        "phase_masked_fraction",
    ):
        assert field in properties

    eigenstate_params = {
        parameter["name"] for parameter in paths[EIGENSTATE_SLICE]["get"]["parameters"]
    }
    assert {"n", "l", "m", "z", "a_mu", "basis", "plane", "observable", "resolution"} == (
        eigenstate_params
    )
    superposition_params = {
        parameter["name"] for parameter in paths[SUPERPOSITION_SLICE]["get"]["parameters"]
    }
    assert {"terms", "time", "basis", "z", "a_mu", "plane", "observable", "resolution"} == (
        superposition_params
    )
