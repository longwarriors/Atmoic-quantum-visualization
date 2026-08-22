from __future__ import annotations

from fastapi.testclient import TestClient

from quviz.api.app import create_app


client = TestClient(create_app())


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
    response = client.get(
        "/api/orbitals/point-cloud?n=1&l=0&m=0&basis=real&samples=1000&seed=5"
    )
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
        "/api/orbitals/isosurface?n=1&l=0&m=0&basis=real&resolution=24&probability_mass=0.8"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["grid_resolution"] == 24
    assert len(payload["vertices"]) == len(payload["phase"])
    assert len(payload["faces"]) > 0
    assert abs(payload["captured_probability_mass"] - 0.8) < 0.02


def test_invalid_isosurface_quantum_numbers_return_422() -> None:
    response = client.get("/api/orbitals/isosurface?n=2&l=1&m=2&resolution=24")
    assert response.status_code == 422
