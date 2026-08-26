from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quviz.api.app import create_app

client = TestClient(create_app(mount_frontend=False))


def test_health_and_catalog() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    catalog = client.get("/api/orbitals/catalog")
    assert catalog.status_code == 200
    assert any(item["id"] == "2pz" for item in catalog.json())


def test_invalid_quantum_numbers_return_422() -> None:
    response = client.get("/api/orbitals/metadata?n=2&l=1&m=2")
    assert response.status_code == 422
    assert "|m| <= l" in response.json()["detail"]


def test_point_cloud_route_returns_binary_contract() -> None:
    response = client.get("/api/orbitals/point-cloud?n=1&l=0&m=0&basis=real&samples=1000&seed=5")
    assert response.status_code == 200
    assert response.headers["x-quviz-format"] == "QVPC/1"
    assert response.content[:4] == b"QVPC"
    assert len(response.content) == 16 + 1_000 * 5 * 4


def test_root_and_metadata_contract() -> None:
    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["name"] == "QuViz"

    response = client.get("/api/orbitals/metadata?n=2&l=1&m=1&basis=complex")
    assert response.status_code == 200
    payload = response.json()
    assert payload["state"]["basis"] == "complex"
    assert payload["observable"] == "probability_density"
    assert payload["representation"] == "point_cloud"


def test_isosurface_route_returns_indexed_phase_mesh() -> None:
    response = client.get(
        "/api/orbitals/isosurface?n=1&l=0&m=0&basis=real&resolution=49&probability_mass=0.8"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["grid_resolution"] == 49
    assert len(payload["vertices"]) == len(payload["phase"])
    assert len(payload["faces"]) > 0
    assert abs(payload["captured_probability_mass"] - 0.8) < 0.02


def test_invalid_isosurface_quantum_numbers_return_422() -> None:
    response = client.get("/api/orbitals/isosurface?n=2&l=1&m=2&resolution=49")
    assert response.status_code == 422


def test_openapi_describes_metadata_and_isosurface_contracts() -> None:
    schema = client.get("/openapi.json").json()
    schemas = schema["components"]["schemas"]
    assert "OrbitalMetadata" in schemas
    assert "IsosurfacePayload" in schemas
    properties = schemas["IsosurfacePayload"]["properties"]
    assert "finite_grid_density_integral" in properties
    assert "grid_spacing_bohr" in properties


def test_current_field_route_returns_streamlines_of_the_current_observable() -> None:
    response = client.get("/api/orbitals/current-field?n=3&l=2&m=2&basis=complex&seed_count=12")
    assert response.status_code == 200
    payload = response.json()

    assert payload["metadata"]["observable"] == "probability_current"
    assert payload["metadata"]["representation"] == "streamlines"
    assert len(payload["lines"]) == len(payload["speed"]) > 0
    assert payload["max_speed"] > 0.0
    assert payload["continuity_residual"] < 1e-3


def test_current_field_route_reports_zero_flow_for_a_real_orbital() -> None:
    response = client.get("/api/orbitals/current-field?n=2&l=1&m=1&basis=real&seed_count=8")
    assert response.status_code == 200
    payload = response.json()

    assert payload["lines"] == []
    assert payload["max_speed"] == 0.0
    assert any("real" in warning.lower() for warning in payload["metadata"]["warnings"])


def test_current_field_route_rejects_invalid_quantum_numbers() -> None:
    response = client.get("/api/orbitals/current-field?n=2&l=1&m=2")
    assert response.status_code == 422


def test_openapi_describes_the_current_field_contract() -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert "CurrentFieldPayload" in schemas
    properties = schemas["CurrentFieldPayload"]["properties"]
    for field in (
        "lines",
        "speed",
        "continuity_residual",
        "continuity_absolute_residual",
        "continuity_scale",
        "continuity_scale_kind",
        "continuity_probe_count",
        "arc_step_bohr",
        "seed_density_floor",
    ):
        assert field in properties


BOHR_PAIR = "1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"


def test_superposition_catalog_includes_a_degenerate_control() -> None:
    entries = client.get("/api/superposition/catalog").json()
    ids = {entry["id"] for entry in entries}
    assert {"1s-2pz", "2s-2pz"} <= ids
    control = next(entry for entry in entries if entry["id"] == "2s-2pz")
    assert control["period_au"] == 0.0


def test_superposition_isosurface_route_carries_time_coefficients_and_mass_scale() -> None:
    response = client.get(
        f"/api/superposition/isosurface?terms={BOHR_PAIR}&time=3.5&resolution=49&a_mu=0.5"
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["metadata"]["observable"] == "probability_density"
    assert payload["metadata"]["time_au"] == 3.5
    assert payload["metadata"]["is_stationary"] is False
    assert payload["metadata"]["z"] == 1.0
    assert payload["metadata"]["a_mu"] == 0.5
    assert payload["metadata"]["reduced_mass_ratio"] == 2.0
    assert payload["metadata"]["energy_expectation_hartree"] == pytest.approx(-0.625)
    assert len(payload["metadata"]["terms"]) == 2
    assert len(payload["vertices"]) == len(payload["phase"]) > 0


def test_superposition_current_route_reports_the_continuity_residual() -> None:
    response = client.get(
        f"/api/superposition/current-field?terms={BOHR_PAIR}&time=2.0&seed_count=8"
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["metadata"]["representation"] == "streamlines"
    assert payload["density_rate_scale"] > 0.0
    assert payload["continuity_residual"] < 1e-2
    assert payload["continuity_scale_kind"] == "transition_coherence"
    assert payload["continuity_phase_count"] >= 4


def test_degenerate_superposition_route_warns_that_nothing_moves() -> None:
    degenerate = "2,0,0,0.7071067811865476;2,1,0,0.7071067811865476"
    payload = client.get(f"/api/superposition/isosurface?terms={degenerate}&resolution=49").json()

    assert payload["metadata"]["is_stationary"] is True
    assert any("stationary" in w for w in payload["metadata"]["warnings"])


def test_superposition_route_removes_zero_terms_before_state_level_checks() -> None:
    terms = "1,0,0,1.0;1,0,0,0.0;2,1,0,-0.0,0.0"
    response = client.get(
        "/api/superposition/isosurface", params={"terms": terms, "resolution": 49}
    )

    assert response.status_code == 200
    metadata = response.json()["metadata"]
    assert metadata["terms"] == [
        {"n": 1, "l": 0, "m": 0, "coefficient_real": 1.0, "coefficient_imag": 0.0}
    ]
    assert metadata["is_stationary"] is True


@pytest.mark.parametrize(
    "terms",
    [
        "1,0,0,nan",
        "1,0,0,inf",
        "1,0,0,-inf",
        "1,0,0,0,nan",
        "1,0,0,0,inf",
        "1,0,0,0,-inf",
    ],
)
def test_superposition_route_rejects_non_finite_coefficients_as_422(terms: str) -> None:
    response = client.get(
        "/api/superposition/isosurface", params={"terms": terms, "resolution": 49}
    )

    assert response.status_code == 422
    assert "coefficient must be finite" in response.json()["detail"]


@pytest.mark.parametrize(
    "terms",
    [
        "1,0,0,0.5;2,1,0,0.5",  # not normalized
        "1,0,0,0.7071067811865476;1,0,0,0.7071067811865476",  # duplicate non-zero
        "1,0,0,1e308",  # finite, but squaring it must not escape as a 500
        "2,1,2,1.0",  # |m| > l
        "nonsense",  # unparsable
        "1,0,0",  # too few fields
    ],
)
def test_superposition_route_rejects_bad_term_specs(terms: str) -> None:
    assert (
        client.get(f"/api/superposition/isosurface?terms={terms}&resolution=49").status_code == 422
    )


def test_openapi_describes_the_superposition_contracts() -> None:
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert "SuperpositionIsosurfacePayload" in schemas
    assert "SuperpositionCurrentPayload" in schemas
    metadata = schemas["SuperpositionMetadata"]["properties"]
    for field in (
        "terms",
        "z",
        "a_mu",
        "reduced_mass_ratio",
        "time_au",
        "energy_expectation_hartree",
        "is_stationary",
    ):
        assert field in metadata
    surface = schemas["SuperpositionIsosurfacePayload"]["properties"]
    for field in (
        "finite_box_tail_mass_upper_bound",
        "finite_box_mass_variation_upper_bound",
        "finite_grid_phase_variation_bound",
        "finite_grid_aliasing_variation_lower_bound",
        "finite_grid_mass_error_lower_bound",
        "finite_grid_reporting_tolerance",
        "finite_grid_mass_status",
    ):
        assert field in surface
