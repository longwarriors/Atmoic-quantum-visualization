from __future__ import annotations

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
    for field in ("lines", "speed", "continuity_residual", "arc_step_bohr", "seed_density_floor"):
        assert field in properties
