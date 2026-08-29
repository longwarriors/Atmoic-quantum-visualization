"""Cross-field scene-contract gates for JSON geometry payloads."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene.builders import orbital_metadata, superposition_metadata
from quviz.scene.models import (
    CurrentFieldPayload,
    IsosurfacePayload,
    SuperpositionCurrentPayload,
    SuperpositionIsosurfacePayload,
    SuperpositionMetadata,
    SuperpositionTermSpec,
)


def _orbital_metadata(observable: ObservableKind, representation: RepresentationKind) -> Any:
    return orbital_metadata(
        2,
        1,
        1,
        z=1.0,
        basis=BasisKind.COMPLEX,
        observable=observable,
        representation=representation,
    )


def _superposition_metadata(observable: ObservableKind, representation: RepresentationKind) -> Any:
    state = SuperpositionState((SuperpositionTerm(2, 1, 1, 1.0 + 0.0j),))
    return superposition_metadata(
        state,
        time=0.0,
        observable=observable,
        representation=representation,
    )


def _surface_payloads() -> list[tuple[type[BaseModel], dict[str, Any]]]:
    geometry: dict[str, Any] = {
        "vertices": [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        "normals": [[0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]],
        "faces": [[0, 1, 2]],
        "phase": [0.0, 0.1, -0.1],
        "density_level": 0.2,
        "requested_probability_mass": 0.8,
        "captured_probability_mass": 0.8,
        "finite_grid_density_integral": 1.0,
        "grid_resolution": 49,
        "grid_spacing_bohr": 0.1,
        "extent_bohr": 2.4,
    }
    orbital = {
        **deepcopy(geometry),
        "metadata": _orbital_metadata(
            ObservableKind.PROBABILITY_DENSITY, RepresentationKind.ISOSURFACE
        ),
    }
    superposition = {
        **deepcopy(geometry),
        "metadata": _superposition_metadata(
            ObservableKind.PROBABILITY_DENSITY, RepresentationKind.ISOSURFACE
        ),
        "finite_box_tail_mass_upper_bound": 1e-6,
        "finite_box_mass_variation_upper_bound": 1e-6,
        "finite_grid_phase_variation_bound": 1e-6,
        "finite_grid_aliasing_variation_lower_bound": 0.0,
        "finite_grid_mass_error_lower_bound": 0.0,
        "finite_grid_reporting_tolerance": 1e-4,
        "finite_grid_mass_status": "no_error_above_tolerance_proven",
    }
    return [
        (IsosurfacePayload, orbital),
        (SuperpositionIsosurfacePayload, superposition),
    ]


@pytest.mark.parametrize(("model", "payload"), _surface_payloads())
@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("normals", [[0.0, 0.0, 1.0]], "one row per vertex"),
        (
            "normals",
            [[0.0, 0.0, 1.0]] * 4,
            "one row per vertex",
        ),
        ("phase", [0.0], "one value per vertex"),
        ("phase", [0.0, 0.1, -0.1, 0.2], "one value per vertex"),
        # With three vertices, index == vertex_count is the first invalid value.
        # This kills a `<`/`<=` boundary mutation that a far-away index cannot.
        ("faces", [[0, 1, 3]], "outside"),
        ("faces", [[-1, 1, 2]], "outside"),
        ("vertices", [[0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], "three components"),
        (
            "vertices",
            [[0.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            "three components",
        ),
        (
            "vertices",
            [[0.0, 0.0, float("nan")], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            "finite",
        ),
        ("extent_bohr", float("inf"), "finite"),
    ],
)
def test_surface_payloads_reject_geometry_that_a_gpu_cannot_consume(
    model: type[BaseModel], payload: dict[str, Any], field: str, value: Any, message: str
) -> None:
    model.model_validate(payload)
    malformed = deepcopy(payload)
    malformed[field] = value

    with pytest.raises(ValidationError, match=message):
        model.model_validate(malformed)


def _current_payloads() -> list[tuple[type[BaseModel], dict[str, Any]]]:
    geometry: dict[str, Any] = {
        "lines": [[[0.0, 0.0, 0.0], [0.1, 0.0, 0.0], [0.2, 0.0, 0.0]]],
        "speed": [[0.1, 0.2, 0.3]],
        "seed_count": 1,
        "max_speed": 0.3,
        "arc_step_bohr": 0.1,
        "seed_density_floor": 1e-6,
        "extent_bohr": 2.4,
        "continuity_residual": 1e-6,
        "continuity_absolute_residual": 1e-7,
        "continuity_scale": 0.1,
        "continuity_probe_count": 8,
    }
    orbital = {
        **deepcopy(geometry),
        "metadata": _orbital_metadata(
            ObservableKind.PROBABILITY_CURRENT, RepresentationKind.STREAMLINES
        ),
        "continuity_scale_kind": "stationary_current",
    }
    superposition = {
        **deepcopy(geometry),
        "metadata": _superposition_metadata(
            ObservableKind.PROBABILITY_CURRENT, RepresentationKind.STREAMLINES
        ),
        "continuity_scale_kind": "transition_coherence",
        "continuity_phase_count": 4,
        "density_rate_scale": 0.01,
    }
    return [
        (CurrentFieldPayload, orbital),
        (SuperpositionCurrentPayload, superposition),
    ]


@pytest.mark.parametrize(("model", "payload"), _current_payloads())
@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("seed_count", 2, "number of returned lines"),
        ("seed_count", 0, "number of returned lines"),
        ("speed", [], "one row per line"),
        ("speed", [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3]], "one row per line"),
        ("speed", [[0.1]], "one value per line vertex"),
        ("speed", [[0.1, 0.2, 0.3, 0.4]], "one value per line vertex"),
        ("speed", [[0.1, -0.2, 0.3]], "non-negative"),
        ("lines", [[[0.0, 0.0, 0.0]]], "at least two vertices"),
        ("max_speed", 9.0, "maximum speed value"),
        ("max_speed", 0.3000001, "maximum speed value"),
        ("max_speed", 0.2999999, "maximum speed value"),
        ("continuity_scale", float("inf"), "finite"),
    ],
)
def test_current_payloads_reject_parallel_arrays_that_do_not_describe_one_geometry(
    model: type[BaseModel], payload: dict[str, Any], field: str, value: Any, message: str
) -> None:
    model.model_validate(payload)
    malformed = deepcopy(payload)
    malformed[field] = value

    with pytest.raises(ValidationError, match=message):
        model.model_validate(malformed)


@pytest.mark.parametrize(("model", "payload"), _current_payloads())
def test_current_payloads_accept_only_exact_zero_max_speed_when_no_lines_exist(
    model: type[BaseModel], payload: dict[str, Any]
) -> None:
    zero_flow = deepcopy(payload)
    zero_flow["lines"] = []
    zero_flow["speed"] = []
    zero_flow["seed_count"] = 0
    zero_flow["max_speed"] = 0.0

    model.model_validate(zero_flow)

    inconsistent = deepcopy(zero_flow)
    inconsistent["max_speed"] = float.fromhex("0x0.0000000000001p-1022")
    with pytest.raises(ValidationError, match="maximum speed value"):
        model.model_validate(inconsistent)


def test_payload_metadata_must_name_the_geometry_it_describes() -> None:
    surface = _surface_payloads()[0][1]
    surface["metadata"] = _orbital_metadata(
        ObservableKind.PROBABILITY_CURRENT, RepresentationKind.STREAMLINES
    )
    with pytest.raises(ValidationError, match="observable must be probability_density"):
        IsosurfacePayload.model_validate(surface)

    current = _current_payloads()[0][1]
    current["metadata"] = _orbital_metadata(
        ObservableKind.PROBABILITY_DENSITY, RepresentationKind.ISOSURFACE
    )
    with pytest.raises(ValidationError, match="observable must be probability_current"):
        CurrentFieldPayload.model_validate(current)


@pytest.mark.parametrize(
    "term",
    [
        {"n": 2, "l": 2, "m": 0, "coefficient_real": 1.0},
        {"n": 2, "l": 1, "m": 2, "coefficient_real": 1.0},
        {"n": 2, "l": 1, "m": 1, "coefficient_real": float("nan")},
    ],
)
def test_superposition_term_contract_rejects_nonphysical_identity(term: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        SuperpositionTermSpec.model_validate(term)


def test_superposition_metadata_rejects_inconsistent_mass_identity() -> None:
    metadata = _superposition_metadata(
        ObservableKind.PROBABILITY_DENSITY, RepresentationKind.ISOSURFACE
    ).model_dump()
    metadata["reduced_mass_ratio"] = 0.5

    with pytest.raises(ValidationError, match="must be reciprocal"):
        SuperpositionMetadata.model_validate(metadata)
