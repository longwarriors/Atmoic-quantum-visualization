from __future__ import annotations

from math import tau

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from quviz.api import routes as routes_module
from quviz.api.app import create_app
from quviz.conventions import BasisKind, PrincipalPlane, SliceObservable
from quviz.errors import ScientificComputationError
from quviz.physics import finite_box as finite_box_module
from quviz.physics import superposition as superposition_module
from quviz.scene import builders as builders_module

client = TestClient(create_app(mount_frontend=False))


def test_health_and_catalog() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    catalog = client.get("/api/orbitals/catalog")
    assert catalog.status_code == 200
    assert any(item["id"] == "2pz" for item in catalog.json())
    assert all(item["z"] == 1.0 for item in catalog.json())


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


def test_point_cloud_route_maps_unrepresentable_scales_to_422() -> None:
    response = client.get(
        "/api/orbitals/point-cloud",
        params={"n": 1, "l": 0, "m": 0, "z": 1e-300, "samples": 1_000},
    )

    assert response.status_code == 422
    assert "QVPC float32 positions" in response.json()["detail"]


@pytest.mark.parametrize(
    ("path", "params"),
    [
        (
            "/api/orbitals/point-cloud",
            {"n": 1, "l": 0, "m": 0, "z": 1e-38, "samples": 1_000},
        ),
        (
            "/api/orbitals/current-field",
            {"n": 3, "l": 2, "m": 2, "z": 1e-103, "seed_count": 1},
        ),
    ],
)
def test_unrepresentable_positive_scales_are_scientific_422_not_500(
    path: str, params: dict[str, object]
) -> None:
    fail_safe_client = TestClient(create_app(mount_frontend=False), raise_server_exceptions=False)
    response = fail_safe_client.get(path, params=params)

    assert response.status_code == 422
    assert response.json()["detail"]


def test_tiny_common_scale_with_representable_current_is_not_rejected() -> None:
    response = client.get(
        "/api/superposition/current-field",
        params={
            "terms": "2,1,1,1",
            "basis": "complex",
            "z": 1e-160,
            "a_mu": 1e-160,
            "seed_count": 1,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["seed_count"] == 1
    assert payload["max_speed"] > 0.0
    assert payload["continuity_scale"] > 0.0


@pytest.mark.parametrize(
    ("path", "params", "builder_name"),
    [
        (
            "/api/orbitals/point-cloud",
            {"n": 1, "l": 0, "m": 0, "samples": 1_000},
            "_point_cloud_bytes",
        ),
        (
            "/api/orbitals/isosurface",
            {"n": 1, "l": 0, "m": 0, "resolution": 49},
            "_cached_isosurface",
        ),
        (
            "/api/orbitals/current-field",
            {"n": 1, "l": 0, "m": 0, "seed_count": 1},
            "_cached_current_field",
        ),
        (
            "/api/orbitals/slice",
            {"n": 1, "l": 0, "m": 0, "resolution": 65},
            "build_slice",
        ),
        (
            "/api/superposition/isosurface",
            {"terms": "1,0,0,1", "resolution": 49},
            "_cached_superposition_isosurface",
        ),
        (
            "/api/superposition/current-field",
            {"terms": "1,0,0,1", "seed_count": 1},
            "_cached_superposition_current",
        ),
        (
            "/api/superposition/slice",
            {"terms": "1,0,0,1", "resolution": 65},
            "build_superposition_slice",
        ),
    ],
)
def test_scientific_floating_point_failures_are_explained_as_422(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    params: dict[str, object],
    builder_name: str,
) -> None:
    def failed_builder(*args: object, **kwargs: object) -> None:
        raise FloatingPointError("numeric sentinel")

    monkeypatch.setattr(routes_module, builder_name, failed_builder)
    response = client.get(path, params=params)

    assert response.status_code == 422
    assert response.json()["detail"] == "numeric sentinel"


def test_unexpected_programming_errors_are_not_relabelled_as_scientific_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("programming sentinel")

    monkeypatch.setattr(routes_module, "_point_cloud_bytes", broken_builder)
    fail_safe_client = TestClient(create_app(mount_frontend=False), raise_server_exceptions=False)
    response = fail_safe_client.get(
        "/api/orbitals/point-cloud", params={"n": 1, "l": 0, "m": 0, "samples": 1_000}
    )

    assert response.status_code == 500


def test_runtime_subclasses_are_not_blanket_mapped_to_scientific_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def recursive_builder(*args: object, **kwargs: object) -> None:
        raise RecursionError("programming recursion sentinel")

    monkeypatch.setattr(routes_module, "_point_cloud_bytes", recursive_builder)
    fail_safe_client = TestClient(create_app(mount_frontend=False), raise_server_exceptions=False)
    response = fail_safe_client.get(
        "/api/orbitals/point-cloud", params={"n": 1, "l": 0, "m": 0, "samples": 1_000}
    )

    assert response.status_code == 500


def test_named_scientific_computation_failures_remain_explanatory_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refused_builder(*args: object, **kwargs: object) -> None:
        raise ScientificComputationError("scientific convergence sentinel")

    monkeypatch.setattr(routes_module, "_point_cloud_bytes", refused_builder)
    response = client.get(
        "/api/orbitals/point-cloud", params={"n": 1, "l": 0, "m": 0, "samples": 1_000}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "scientific convergence sentinel"


def test_extreme_slice_scale_has_a_readable_scientific_refusal() -> None:
    response = client.get(
        "/api/superposition/slice",
        params={"terms": "1,0,0,1", "resolution": 65, "a_mu": 1e-300},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "cannot be represented in float64" in detail
    assert "Result too large" not in detail


def test_power_boundary_slice_scale_has_a_readable_scientific_refusal() -> None:
    response = client.get(
        "/api/superposition/slice",
        params={
            "terms": "1,0,0,1",
            "z": 10.0,
            "a_mu": 6.27893936364686e-205,
            "resolution": 65,
        },
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail == "density must have a positive finite integral"
    assert "Result too large" not in detail


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


def test_isosurface_float32_surface_collapse_is_an_explanatory_422() -> None:
    response = client.get(
        "/api/orbitals/isosurface",
        params={"n": 1, "l": 0, "m": 0, "z": 1e-20},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail.startswith("isosurface extraction failed at the computed density level:")
    assert "No surface found" in detail


def test_isosurface_extraction_runtime_subclasses_remain_server_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def recursive_extractor(*args: object, **kwargs: object) -> None:
        raise RecursionError("extractor recursion sentinel")

    monkeypatch.setattr(builders_module, "marching_cubes", recursive_extractor)
    routes_module._cached_isosurface.cache_clear()
    fail_safe_client = TestClient(create_app(mount_frontend=False), raise_server_exceptions=False)
    try:
        response = fail_safe_client.get(
            "/api/orbitals/isosurface",
            params={"n": 1, "l": 0, "m": 0, "z": 1.234567, "resolution": 51},
        )
    finally:
        routes_module._cached_isosurface.cache_clear()

    assert response.status_code == 500


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
    openapi = client.get("/openapi.json").json()
    schemas = openapi["components"]["schemas"]
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
    eigen_parameters = openapi["paths"]["/api/orbitals/current-field"]["get"]["parameters"]
    super_parameters = openapi["paths"]["/api/superposition/current-field"]["get"]["parameters"]
    assert (
        next(item for item in eigen_parameters if item["name"] == "seed_count")["schema"]["maximum"]
        == 96
    )
    assert (
        next(item for item in super_parameters if item["name"] == "seed_count")["schema"]["maximum"]
        == 40
    )


BOHR_PAIR = "1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"


@pytest.mark.parametrize(
    ("path", "params"),
    [
        (
            "/api/orbitals/current-field",
            {"n": 3, "l": 2, "m": 2, "basis": "complex", "seed_count": 1},
        ),
        (
            "/api/superposition/current-field",
            {"terms": BOHR_PAIR, "time": 0.0, "seed_count": 1},
        ),
    ],
)
@pytest.mark.parametrize("arc_step", [5e-324, 1e308], ids=["subnormal", "too-large"])
def test_current_field_routes_reject_arc_steps_outside_dimensionless_contract(
    path: str,
    params: dict[str, object],
    arc_step: float,
) -> None:
    fail_safe_client = TestClient(create_app(mount_frontend=False), raise_server_exceptions=False)
    response = fail_safe_client.get(path, params={**params, "arc_step": arc_step})

    assert response.status_code == 422
    assert "arc_step / support_length" in response.json()["detail"]


@pytest.mark.parametrize(
    ("path", "params", "arc_step"),
    [
        (
            "/api/orbitals/current-field",
            {"n": 3, "l": 2, "m": 2, "basis": "complex", "seed_count": 1},
            0.27,
        ),
        (
            "/api/superposition/current-field",
            {"terms": BOHR_PAIR, "time": 0.0, "seed_count": 1},
            0.03,
        ),
        (
            "/api/superposition/current-field",
            {"terms": "1,0,0,1.0", "time": 0.0, "seed_count": 1, "a_mu": 0.01},
            0.01 / 4_096.0,
        ),
        (
            "/api/orbitals/current-field",
            {"n": 6, "l": 0, "m": 0, "basis": "complex", "seed_count": 1},
            36.0 / 8.0,
        ),
    ],
)
def test_current_field_routes_accept_explicit_dimensionless_arc_step(
    path: str,
    params: dict[str, object],
    arc_step: float,
) -> None:
    response = client.get(path, params={**params, "arc_step": arc_step})

    assert response.status_code == 200
    assert response.json()["arc_step_bohr"] == pytest.approx(arc_step)


def test_superposition_catalog_includes_a_degenerate_control() -> None:
    entries = client.get("/api/superposition/catalog").json()
    ids = {entry["id"] for entry in entries}
    assert {"1s-2pz", "2s-2pz"} <= ids
    control = next(entry for entry in entries if entry["id"] == "2s-2pz")
    assert control["period_au"] == 0.0

    one_s_three_d = next(entry for entry in entries if entry["id"] == "1s-3dz2")
    energy_1 = -1.0 / (2.0 * 1**2)
    energy_3 = -1.0 / (2.0 * 3**2)
    assert one_s_three_d["period_au"] == pytest.approx(tau / abs(energy_3 - energy_1))


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
    degenerate = "2,1,0,0.7071067811865476;2,1,1,0.7071067811865476"
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


@pytest.mark.parametrize(
    "terms",
    [
        ",1,0,0,1",
        "1,0,0,1,",
        "1,,0,0,1",
        "1,0,,0,1",
        "1,0,0,,1",
        ";1,0,0,1",
        "1,0,0,1;",
    ],
    ids=[
        "leading-field",
        "trailing-field",
        "empty-l",
        "empty-m",
        "empty-real",
        "leading-term",
        "trailing-term",
    ],
)
@pytest.mark.parametrize(
    ("path", "extra"),
    [
        ("/api/superposition/isosurface", {"resolution": 49}),
        ("/api/superposition/current-field", {"seed_count": 1}),
        ("/api/superposition/slice", {"resolution": 65}),
    ],
    ids=["isosurface", "current-field", "slice"],
)
def test_every_superposition_route_rejects_empty_grammar_fields(
    path: str, extra: dict[str, int], terms: str
) -> None:
    response = client.get(path, params={"terms": terms, **extra})

    assert response.status_code == 422
    assert "empty" in response.json()["detail"] or "malformed" in response.json()["detail"]


EIGHT_NORMALIZED_TERMS = ";".join(
    f"{n},{l},{m},0.3535533905932738"
    for n, l, m in (
        (1, 0, 0),
        (2, 1, -1),
        (2, 1, 0),
        (2, 1, 1),
        (3, 1, -1),
        (3, 1, 0),
        (3, 1, 1),
        (3, 2, 0),
    )
)


def test_term_length_and_count_boundaries_are_enforced_before_building(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before term preflight completed")

    monkeypatch.setattr(routes_module, "_cached_superposition_isosurface", forbidden_builder)

    exactly_512 = "1,0,0,1".ljust(routes_module._MAXIMUM_TERM_SPEC_LENGTH)
    state = routes_module._parse_superposition(exactly_512, BasisKind.COMPLEX, maximum_n=4)
    assert len(state.terms) == 1
    assert len(EIGHT_NORMALIZED_TERMS.split(";")) == routes_module._MAXIMUM_SUPERPOSITION_TERMS
    assert (
        len(routes_module._parse_superposition(EIGHT_NORMALIZED_TERMS, BasisKind.COMPLEX).terms)
        == routes_module._MAXIMUM_SUPERPOSITION_TERMS
    )

    too_long = client.get(
        "/api/superposition/isosurface",
        params={"terms": "1,0,0,1".ljust(513), "resolution": 49},
    )
    assert too_long.status_code == 422

    nine_terms = ";".join(["1,0,0,1"] + ["1,0,0,0"] * 8)
    too_many = client.get(
        "/api/superposition/isosurface", params={"terms": nine_terms, "resolution": 49}
    )
    assert too_many.status_code == 422
    assert "got 9" in too_many.json()["detail"]


@pytest.mark.parametrize(
    ("path", "params", "cached_builder", "expected_limit"),
    [
        (
            "/api/superposition/isosurface",
            {"terms": "5,0,0,1", "resolution": 49},
            "_cached_superposition_isosurface",
            4,
        ),
        (
            "/api/superposition/current-field",
            {"terms": "7,0,0,1", "seed_count": 1},
            "_cached_superposition_current",
            6,
        ),
        (
            "/api/superposition/slice",
            {"terms": "13,0,0,1", "resolution": 65},
            "build_superposition_slice",
            12,
        ),
    ],
    ids=["isosurface", "current-field", "slice"],
)
def test_endpoint_quantum_number_caps_run_before_builders(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    params: dict[str, object],
    cached_builder: str,
    expected_limit: int,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before quantum-number preflight completed")

    monkeypatch.setattr(routes_module, cached_builder, forbidden_builder)
    response = client.get(path, params=params)

    assert response.status_code == 422
    assert f"n <= {expected_limit}" in response.json()["detail"]


def test_combined_work_budget_runs_before_the_isosurface_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before workload preflight completed")

    monkeypatch.setattr(routes_module, "_cached_superposition_isosurface", forbidden_builder)
    response = client.get(
        "/api/superposition/isosurface",
        params={"terms": EIGHT_NORMALIZED_TERMS, "resolution": 81},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert str(8 * (81**3 + 81**3)) in detail
    assert str(routes_module._ISOSURFACE_WORK_LIMIT) in detail


def test_slice_work_budget_rejects_the_largest_shape_before_the_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before workload preflight completed")

    monkeypatch.setattr(routes_module, "build_superposition_slice", forbidden_builder)
    response = client.get(
        "/api/superposition/slice",
        params={"terms": EIGHT_NORMALIZED_TERMS, "resolution": 513},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert str(8 * 513**2) in detail
    assert str(routes_module._SLICE_WORK_LIMIT) in detail


def test_named_work_budget_accepts_the_limit_and_rejects_limit_plus_one() -> None:
    routes_module._enforce_request_workload(
        "boundary",
        active_terms=1,
        work_per_term=routes_module._SLICE_WORK_LIMIT,
        limit=routes_module._SLICE_WORK_LIMIT,
        unit="test units",
    )

    with pytest.raises(HTTPException) as captured:
        routes_module._enforce_request_workload(
            "boundary",
            active_terms=1,
            work_per_term=routes_module._SLICE_WORK_LIMIT + 1,
            limit=routes_module._SLICE_WORK_LIMIT,
            unit="test units",
        )

    assert captured.value.status_code == 422
    assert str(routes_module._SLICE_WORK_LIMIT + 1) in captured.value.detail
    assert str(routes_module._SLICE_WORK_LIMIT) in captured.value.detail


def test_eigenstate_current_output_budget_runs_before_the_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before workload preflight completed")

    monkeypatch.setattr(routes_module, "_cached_current_field", forbidden_builder)
    response = client.get(
        "/api/orbitals/current-field",
        params={
            "n": 3,
            "l": 2,
            "m": 2,
            "basis": "complex",
            "seed_count": 96,
            "arc_step": 9.0 / 4_096.0,
        },
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert str(96 * 4_096) in detail
    assert str(routes_module._CURRENT_FIELD_PATH_SAMPLE_LIMIT) in detail
    assert "path samples" in detail


def test_superposition_current_rk4_budget_runs_before_the_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before workload preflight completed")

    monkeypatch.setattr(routes_module, "_cached_superposition_current", forbidden_builder)
    response = client.get(
        "/api/superposition/current-field",
        params={"terms": EIGHT_NORMALIZED_TERMS, "seed_count": 24},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert str(routes_module._CURRENT_FIELD_WORK_LIMIT) in detail
    assert "term-velocity evaluations" in detail


def test_current_work_estimate_counts_the_initial_and_five_rk4_stage_evaluations() -> None:
    estimate = routes_module.CurrentFieldWorkEstimate(
        active_terms=2,
        requested_seeds=24,
        max_points_per_line=2_497,
    )

    assert estimate.serialized_path_samples == 24 * 2_497
    assert estimate.velocity_evaluations_per_term == 24 * (1 + 5 * (2_497 - 1))
    assert estimate.term_velocity_evaluations == 2 * 24 * (1 + 5 * (2_497 - 1))


def test_each_current_work_limit_accepts_its_boundary_and_rejects_one_more() -> None:
    for operation, limit, unit in (
        ("evaluation boundary", routes_module._CURRENT_FIELD_WORK_LIMIT, "evaluations"),
        ("output boundary", routes_module._CURRENT_FIELD_PATH_SAMPLE_LIMIT, "samples"),
    ):
        routes_module._enforce_request_workload(
            operation,
            active_terms=1,
            work_per_term=limit,
            limit=limit,
            unit=unit,
        )
        with pytest.raises(HTTPException, match=str(limit)):
            routes_module._enforce_request_workload(
                operation,
                active_terms=1,
                work_per_term=limit + 1,
                limit=limit,
                unit=unit,
            )


def test_two_term_catalog_isosurface_reaches_builder_under_the_adaptive_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reached_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("two-term catalog request reached the builder")

    monkeypatch.setattr(routes_module, "_cached_superposition_isosurface", reached_builder)

    with pytest.raises(AssertionError, match="two-term catalog request reached the builder"):
        client.get(
            "/api/superposition/isosurface",
            params={
                "terms": "2,0,0,0.7071067811865476;2,1,0,0.7071067811865476",
                "basis": "real",
            },
        )

    state = routes_module._parse_superposition(
        "2,0,0,0.7071067811865476;2,1,0,0.7071067811865476",
        BasisKind.REAL,
        maximum_n=4,
    )
    estimate = builders_module.estimate_superposition_isosurface_workload(
        state,
        resolution=65,
        probability_mass=0.9,
    )
    assert estimate.resolutions == (129, 137, 137)
    assert estimate.term_voxel_evaluations == 14_578_790
    assert estimate.term_voxel_evaluations <= routes_module._ADAPTIVE_ISOSURFACE_WORK_LIMIT


def test_isosurface_estimate_matches_real_full_grid_term_evaluations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The preflight schedule must equal the cubic arrays the real builder evaluates."""

    epsilon = 1e-3
    coefficient = np.sqrt(1.0 - epsilon**2)
    state = routes_module._parse_superposition(
        f"2,0,0,{coefficient};2,1,0,{epsilon}",
        BasisKind.REAL,
        maximum_n=4,
    )
    estimate = builders_module.estimate_superposition_isosurface_workload(
        state,
        resolution=81,
        probability_mass=0.9,
    )
    observed_full_grid_resolutions: list[int] = []
    real_wavefunction = superposition_module.hydrogenic_wavefunction
    assert finite_box_module.hydrogenic_wavefunction is real_wavefunction

    def recording_wavefunction(
        n: int,
        l: int,
        m: int,
        r: object,
        theta: object,
        phi: object,
        **kwargs: object,
    ) -> np.ndarray:
        radius = np.asarray(r)
        if radius.ndim == 3 and radius.shape == (radius.shape[0],) * 3:
            observed_full_grid_resolutions.append(int(radius.shape[0]))
        return np.asarray(real_wavefunction(n, l, m, r, theta, phi, **kwargs))

    # Mesh construction evaluates the whole state through the superposition
    # module, while the final finite-grid diagnostic evaluates every component
    # through its own imported alias. Recording both observes every actual
    # term-grid evaluation without replacing either production algorithm.
    monkeypatch.setattr(superposition_module, "hydrogenic_wavefunction", recording_wavefunction)
    monkeypatch.setattr(finite_box_module, "hydrogenic_wavefunction", recording_wavefunction)

    payload = builders_module.build_superposition_isosurface(
        state,
        resolution=81,
        probability_mass=0.9,
    )

    expected_resolutions = tuple(
        resolution for resolution in estimate.resolutions for _term in range(estimate.active_terms)
    )
    assert tuple(observed_full_grid_resolutions) == expected_resolutions
    assert sum(value**3 for value in observed_full_grid_resolutions) == (
        estimate.term_voxel_evaluations
    )
    assert payload.grid_resolution == estimate.general_topology_resolutions[-1]


def test_three_term_adaptive_isosurface_work_fails_before_the_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_builder(*args: object, **kwargs: object) -> None:
        raise AssertionError("builder was called before adaptive workload preflight completed")

    monkeypatch.setattr(routes_module, "_cached_superposition_isosurface", forbidden_builder)
    coefficient = 1.0 / 3.0**0.5
    terms = ";".join(
        (
            f"2,0,0,{coefficient}",
            f"2,1,0,{coefficient}",
            f"2,1,1,{coefficient}",
        )
    )
    response = client.get(
        "/api/superposition/isosurface",
        params={"terms": terms, "basis": "real", "resolution": 81},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert str(3 * (129**3 + 137**3 + 137**3)) in detail
    assert str(routes_module._ADAPTIVE_ISOSURFACE_WORK_LIMIT) in detail


def test_ordinary_isosurface_work_includes_the_final_mass_diagnostic_grid() -> None:
    state = routes_module._parse_superposition(
        "2,1,0,0.7071067811865476;2,1,1,0.7071067811865476",
        BasisKind.REAL,
        maximum_n=4,
    )

    estimate = builders_module.estimate_superposition_isosurface_workload(
        state, resolution=81, probability_mass=0.9
    )

    assert estimate.resolutions == (81, 81)
    assert estimate.general_topology_resolutions == ()
    assert estimate.term_voxel_evaluations == 2 * (81**3 + 81**3)
    assert not estimate.uses_adaptive_isosurface_budget
    assert not estimate.requires_general_topology_convergence


@pytest.mark.parametrize(
    ("required_resolution", "expected_resolutions"),
    [
        (97, (97, 129, 129)),
        (129, (129, 129)),
    ],
)
def test_single_excited_s_work_bounds_selected_level_rebuild_and_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    required_resolution: int,
    expected_resolutions: tuple[int, ...],
) -> None:
    state = routes_module._parse_superposition("4,0,0,1", BasisKind.REAL, maximum_n=4)
    monkeypatch.setattr(builders_module, "superposition_extent", lambda _state: 10.0)
    monkeypatch.setattr(
        builders_module,
        "_s_isosurface_resolution_requirement",
        lambda *args, **kwargs: (required_resolution, 7),
    )

    estimate = builders_module.estimate_superposition_isosurface_workload(
        state, resolution=81, probability_mass=0.5
    )

    assert estimate.resolutions == expected_resolutions
    assert estimate.term_voxel_evaluations == sum(value**3 for value in expected_resolutions)
    assert estimate.general_topology_resolutions == ()
    assert estimate.uses_adaptive_isosurface_budget
    assert not estimate.requires_general_topology_convergence


def test_single_excited_s_work_rejects_the_first_resolution_above_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = routes_module._parse_superposition("4,0,0,1", BasisKind.REAL, maximum_n=4)
    monkeypatch.setattr(builders_module, "superposition_extent", lambda _state: 10.0)
    monkeypatch.setattr(
        builders_module,
        "_s_isosurface_resolution_requirement",
        lambda *args, **kwargs: (131, 7),
    )

    with pytest.raises(ValueError, match="exceeding the validated adaptive cap 129"):
        builders_module.estimate_superposition_isosurface_workload(
            state, resolution=81, probability_mass=0.5
        )


@pytest.mark.parametrize(
    ("required_resolution", "expected_topology_resolutions"),
    [
        (49, (129, 137)),
        (123, (129, 137)),
        (131, (131, 137)),
        (137, (129, 137)),
    ],
)
def test_general_excited_s_work_covers_the_used_meshes_and_final_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    required_resolution: int,
    expected_topology_resolutions: tuple[int, ...],
) -> None:
    coefficient = 1.0 / 2.0**0.5
    state = routes_module._parse_superposition(
        f"2,0,0,{coefficient};2,1,0,{coefficient}",
        BasisKind.REAL,
        maximum_n=4,
    )
    monkeypatch.setattr(builders_module, "superposition_extent", lambda _state: 10.0)
    monkeypatch.setattr(
        builders_module,
        "_s_isosurface_resolution_requirement",
        lambda *args, **kwargs: (required_resolution, 3),
    )

    estimate = builders_module.estimate_superposition_isosurface_workload(
        state, resolution=49, probability_mass=0.5
    )

    assert estimate.general_topology_resolutions == expected_topology_resolutions
    assert estimate.resolutions == (
        *expected_topology_resolutions,
        expected_topology_resolutions[-1],
    )
    assert estimate.term_voxel_evaluations == 2 * sum(value**3 for value in estimate.resolutions)
    assert estimate.uses_adaptive_isosurface_budget
    assert estimate.requires_general_topology_convergence


@pytest.mark.parametrize(
    ("path", "seed_count"),
    [
        ("/api/orbitals/current-field", 97),
        ("/api/superposition/current-field", 41),
    ],
)
def test_current_field_seed_ceilings_are_enforced(path: str, seed_count: int) -> None:
    response = client.get(path, params={"seed_count": seed_count})

    assert response.status_code == 422


def test_slice_route_uses_the_isolated_public_builder_without_a_second_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    routes_module.build_slice.cache_clear()
    public_builder = routes_module.build_slice
    call_count = 0

    def tracked_builder(*args: object, **kwargs: object) -> object:
        nonlocal call_count
        call_count += 1
        return public_builder(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(routes_module, "build_slice", tracked_builder)
    arguments = {
        "n": 1,
        "l": 0,
        "m": 0,
        "z": 1.0,
        "a_mu": 1.0,
        "basis": BasisKind.REAL,
        "plane": PrincipalPlane.XZ,
        "observable": SliceObservable.PROBABILITY_DENSITY,
        "resolution": 65,
    }
    try:
        first = routes_module.orbital_slice(**arguments)
        expected = first.values[0]
        first.values[0] = 12345.0
        first.metadata.warnings.append("caller mutation")

        second = routes_module.orbital_slice(**arguments)

        assert second is not first
        assert second.values is not first.values
        assert second.metadata is not first.metadata
        assert second.values[0] == expected
        assert "caller mutation" not in second.metadata.warnings
        assert call_count == 2
    finally:
        public_builder.cache_clear()


def test_openapi_describes_the_superposition_contracts() -> None:
    openapi = client.get("/openapi.json").json()
    schemas = openapi["components"]["schemas"]
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

    for path in (
        "/api/superposition/isosurface",
        "/api/superposition/current-field",
        "/api/superposition/slice",
    ):
        parameters = openapi["paths"][path]["get"]["parameters"]
        terms = next(parameter for parameter in parameters if parameter["name"] == "terms")
        assert terms["schema"]["minLength"] == 1
        assert terms["schema"]["maxLength"] == routes_module._MAXIMUM_TERM_SPEC_LENGTH
