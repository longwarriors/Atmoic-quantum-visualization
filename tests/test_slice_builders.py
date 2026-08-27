"""Structural gates on the slice builders.

These tests pin the *shape* of a slice asset: which resolutions are refused and
why, that the grid the payload describes is the grid it was sampled on, that
masked phase samples carry the finite sentinel, and that the phase mask is
referenced to the state's amplitude scale rather than to whatever happens to be
the largest magnitude on the plane. Deep scientific claims about the values
themselves (symmetry, node locations, normalization) belong to the analytic
gate file, not here.

The mask is a low-amplitude, phase-undefined region and never a node
certificate; the wording gate below keeps that language from drifting.
"""

from __future__ import annotations

import inspect
from collections.abc import Iterator
from typing import Any

import numpy as np
import pytest

from quviz.conventions import (
    BasisKind,
    ObservableKind,
    PrincipalPlane,
    RepresentationKind,
    SliceObservable,
)
from quviz.physics.hydrogenic import hydrogenic_wavefunction
from quviz.physics.planes import (
    DEFAULT_PHASE_MASK_RELATIVE,
    amplitude_scale,
    axis_spacing,
    plane_frame,
    reference_length,
)
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene import slices as slice_module
from quviz.scene.builders import build_isosurface, radial_extent_for_mass, superposition_extent
from quviz.scene.models import SLICE_VALUE_UNITS
from quviz.scene.slices import (
    MAXIMUM_SLICE_RESOLUTION,
    build_slice,
    build_superposition_slice,
    slice_resolution_floor,
)

SMALL = 65


@pytest.fixture(autouse=True)
def _clear_slice_caches() -> Iterator[None]:
    """Keep the memoized builders from carrying state between tests."""

    build_slice.cache_clear()
    build_superposition_slice.cache_clear()
    yield
    build_slice.cache_clear()
    build_superposition_slice.cache_clear()


def _hydrogen_slice(
    observable: SliceObservable,
    *,
    n: int = 1,
    l: int = 0,
    m: int = 0,
    plane: PrincipalPlane = PrincipalPlane.XY,
    resolution: int = SMALL,
) -> Any:
    return build_slice(
        n,
        l,
        m,
        z=1.0,
        a_mu=1.0,
        basis=BasisKind.REAL,
        plane=plane,
        observable=observable,
        resolution=resolution,
    )


def test_even_resolution_is_rejected_so_the_origin_lies_on_the_grid() -> None:
    # 66 and 130 clear the resolution floor, so only the parity guard can
    # refuse them; 64 would be caught by the floor and prove nothing.
    with pytest.raises(ValueError, match="resolution must be odd so the origin lies on the grid"):
        _hydrogen_slice(SliceObservable.PROBABILITY_DENSITY, resolution=66)
    with pytest.raises(ValueError, match="resolution must be odd so the origin lies on the grid"):
        build_superposition_slice(
            SuperpositionState(terms=(SuperpositionTerm(1, 0, 0, 1.0),), basis=BasisKind.REAL),
            time=0.0,
            plane=PrincipalPlane.XY,
            observable=SliceObservable.PROBABILITY_DENSITY,
            resolution=130,
        )


def test_resolution_floor_scales_with_the_principal_quantum_number() -> None:
    assert slice_resolution_floor(1) == 65
    assert slice_resolution_floor(3) == 65
    assert slice_resolution_floor(4) == 81
    assert slice_resolution_floor(6) == 113

    # 63 is odd and still refused: the floor, not parity, binds here.
    with pytest.raises(ValueError, match="resolution must be at least 65"):
        _hydrogen_slice(SliceObservable.PROBABILITY_DENSITY, resolution=63)
    with pytest.raises(ValueError, match="resolution must be at least 81"):
        _hydrogen_slice(SliceObservable.PROBABILITY_DENSITY, n=4, l=0, m=0, resolution=65)
    with pytest.raises(ValueError, match="resolution must be at most 513"):
        _hydrogen_slice(
            SliceObservable.PROBABILITY_DENSITY, resolution=MAXIMUM_SLICE_RESOLUTION + 2
        )


def test_the_isosurface_n_cap_does_not_carry_over_to_a_slice() -> None:
    """A slice has no mesh, so the marching-cubes validation cap is irrelevant."""

    with pytest.raises(ValueError, match="validated only for n <= 4"):
        build_isosurface(6, 5, 0, z=1.0, basis=BasisKind.REAL, resolution=81)

    payload = _hydrogen_slice(
        SliceObservable.PROBABILITY_DENSITY,
        n=6,
        l=5,
        m=0,
        plane=PrincipalPlane.XZ,
        resolution=slice_resolution_floor(6),
    )
    assert payload.resolution == 113
    assert len(payload.values) == 113 * 113


def test_payload_states_the_grid_it_was_sampled_on() -> None:
    payload = _hydrogen_slice(SliceObservable.PROBABILITY_DENSITY, plane=PrincipalPlane.XZ)
    frame = plane_frame(PrincipalPlane.XZ)
    extent = radial_extent_for_mass(1, 0, 1.0, a_mu=1.0)

    assert payload.layout == "row_major_v_rows_u_columns"
    assert payload.plane is PrincipalPlane.XZ
    assert payload.origin_bohr == [0.0, 0.0, 0.0]
    assert payload.u_axis == list(frame.u_axis)
    assert payload.v_axis == list(frame.v_axis)
    assert payload.normal == list(frame.normal) == [0.0, -1.0, 0.0]
    assert payload.extent_bohr == extent
    assert payload.spacing_bohr == axis_spacing(extent, SMALL)
    assert payload.resolution == SMALL
    assert len(payload.values) == SMALL * SMALL
    assert payload.length_unit == "bohr"
    assert payload.value_unit == SLICE_VALUE_UNITS[SliceObservable.PROBABILITY_DENSITY]
    assert payload.metadata.representation is RepresentationKind.SLICE
    assert payload.metadata.observable is ObservableKind.PROBABILITY_DENSITY


def test_extent_is_derived_from_the_state_and_is_not_a_parameter() -> None:
    parameters = inspect.signature(build_slice).parameters
    assert "extent" not in parameters
    assert "extent_bohr" not in parameters
    assert "extent" not in inspect.signature(build_superposition_slice).parameters

    contracted = _hydrogen_slice(SliceObservable.PROBABILITY_DENSITY, n=2, l=1, m=0)
    assert contracted.extent_bohr == radial_extent_for_mass(2, 1, 1.0, a_mu=1.0)

    state = SuperpositionState(
        terms=(SuperpositionTerm(1, 0, 0, 1.0),),
        basis=BasisKind.REAL,
    )
    superposed = build_superposition_slice(
        state,
        time=0.0,
        plane=PrincipalPlane.XY,
        observable=SliceObservable.PROBABILITY_DENSITY,
        resolution=SMALL,
    )
    assert superposed.extent_bohr == superposition_extent(state)


def test_origin_sample_sits_at_the_row_major_centre() -> None:
    payload = _hydrogen_slice(SliceObservable.WAVEFUNCTION_REAL)
    half = (SMALL - 1) // 2
    expected = float(
        np.real(
            hydrogenic_wavefunction(1, 0, 0, 0.0, 0.0, 0.0, z=1.0, a_mu=1.0, basis=BasisKind.REAL)
        )
    )
    assert payload.values[half * SMALL + half] == expected
    assert expected == pytest.approx(1.0 / np.sqrt(np.pi))


def test_non_phase_slices_carry_no_mask_and_no_mask_report() -> None:
    for observable in (
        SliceObservable.PROBABILITY_DENSITY,
        SliceObservable.WAVEFUNCTION_REAL,
        SliceObservable.WAVEFUNCTION_IMAG,
    ):
        payload = _hydrogen_slice(observable, plane=PrincipalPlane.XZ)
        assert payload.valid_mask is None
        assert payload.phase_masked_fraction is None
        assert payload.phase_mask_relative_amplitude is None
        assert payload.phase_mask_amplitude_scale is None
        assert payload.phase_mask_amplitude_threshold is None
        assert payload.phase_mask_numeric_floor is None
        assert payload.value_unit == SLICE_VALUE_UNITS[observable]
        assert payload.max_amplitude_on_plane > 0.0


def test_masked_phase_entries_carry_the_finite_sentinel_and_the_reported_rule() -> None:
    payload = _hydrogen_slice(SliceObservable.PHASE, n=2, l=1, m=0, plane=PrincipalPlane.XZ)
    assert payload.valid_mask is not None
    assert len(payload.valid_mask) == SMALL * SMALL
    assert payload.masked_value_sentinel == 0.0
    assert all(np.isfinite(value) for value in payload.values)
    for valid, value in zip(payload.valid_mask, payload.values, strict=True):
        if not valid:
            assert value == 0.0

    scale = amplitude_scale(reference_length([2], z=1.0, a_mu=1.0))
    assert payload.phase_mask_relative_amplitude == DEFAULT_PHASE_MASK_RELATIVE
    assert payload.phase_mask_amplitude_scale == scale
    assert payload.phase_mask_amplitude_threshold == DEFAULT_PHASE_MASK_RELATIVE * scale
    assert payload.phase_mask_numeric_floor is not None
    assert payload.phase_mask_numeric_floor < payload.phase_mask_amplitude_threshold
    assert payload.max_amplitude_on_plane == pytest.approx(0.07276011118097128, rel=1e-12)


def test_2p_z_xy_phase_slice_is_fully_masked_against_the_state_amplitude_scale() -> None:
    """The xy plane of 2p_z carries |psi| ~ 4e-18: residue, not a resolved amplitude.

    A mask referenced to this plane's own maximum would call that residue
    "large" and hand back a full field of meaningless phases. The threshold is
    referenced to the state's amplitude scale ``L_ref**-1.5`` instead, so every
    sample here falls below it.
    """

    payload = _hydrogen_slice(SliceObservable.PHASE, n=2, l=1, m=0, plane=PrincipalPlane.XY)
    assert payload.max_amplitude_on_plane < 1e-16
    assert payload.valid_mask is not None
    assert not any(payload.valid_mask)
    assert payload.phase_masked_fraction == 1.0
    assert set(payload.values) == {0.0}


def test_2p_z_xz_phase_slice_masks_exactly_the_low_amplitude_row() -> None:
    payload = _hydrogen_slice(SliceObservable.PHASE, n=2, l=1, m=0, plane=PrincipalPlane.XZ)
    assert payload.valid_mask is not None
    masked = [index for index, valid in enumerate(payload.valid_mask) if not valid]
    half = (SMALL - 1) // 2

    # v indexes rows, so the z = 0 line of the xz plane is one whole row.
    assert masked == [half * SMALL + column for column in range(SMALL)]
    assert payload.phase_masked_fraction == pytest.approx(1.0 / SMALL)
    assert 0.0 < payload.phase_masked_fraction < 1.0


def test_1s_phase_slice_masks_nothing_at_its_own_extent() -> None:
    """Measured, not assumed: nothing on a 1s plane falls below 1e-6 * a_mu^-3/2."""

    payload = _hydrogen_slice(SliceObservable.PHASE, plane=PrincipalPlane.XZ)
    assert payload.valid_mask is not None
    assert all(payload.valid_mask)
    assert payload.phase_masked_fraction == 0.0


def test_slice_values_are_not_rounded() -> None:
    payload = _hydrogen_slice(SliceObservable.PROBABILITY_DENSITY)
    assert any(value != round(value, 6) for value in payload.values)


def test_a_plane_with_no_amplitude_is_fully_masked_and_warns_by_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def zero_wavefunction(
        n: int, l: int, m: int, r: Any, theta: Any, phi: Any, **kwargs: Any
    ) -> Any:
        del n, l, m, theta, phi, kwargs
        return np.zeros_like(np.asarray(r, dtype=np.float64))

    monkeypatch.setattr(slice_module, "hydrogenic_wavefunction", zero_wavefunction)
    payload = _hydrogen_slice(SliceObservable.PHASE, plane=PrincipalPlane.YZ)

    assert payload.max_amplitude_on_plane == 0.0
    assert payload.valid_mask is not None
    assert not any(payload.valid_mask)
    assert payload.phase_masked_fraction == 1.0
    assert any("yz" in warning for warning in payload.metadata.warnings)


def test_mask_wording_never_calls_a_masked_region_a_node() -> None:
    payload = _hydrogen_slice(SliceObservable.PHASE, n=2, l=1, m=0, plane=PrincipalPlane.XY)
    assert "low-amplitude, phase-undefined region" in payload.metadata.color_semantics
    assert "not a certificate of a node" in payload.metadata.color_semantics

    warning = next(note for note in payload.metadata.warnings if "fully masked" in note)
    assert "low-amplitude, phase-undefined region" in warning
    assert "not a certificate that a node lies in this plane" in warning
    assert "nodal plane" not in payload.metadata.geometry_semantics


def test_superposition_slice_at_zero_time_reproduces_the_eigenstate_slice() -> None:
    state = SuperpositionState(
        terms=(SuperpositionTerm(2, 1, 0, 1.0),),
        z=1.0,
        a_mu=1.0,
        basis=BasisKind.REAL,
    )
    superposed = build_superposition_slice(
        state,
        time=0.0,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.PROBABILITY_DENSITY,
        resolution=SMALL,
    )
    eigenstate = _hydrogen_slice(
        SliceObservable.PROBABILITY_DENSITY, n=2, l=1, m=0, plane=PrincipalPlane.XZ
    )

    assert superposed.extent_bohr == eigenstate.extent_bohr
    assert superposed.spacing_bohr == eigenstate.spacing_bohr
    assert superposed.layout == eigenstate.layout
    np.testing.assert_allclose(superposed.values, eigenstate.values, rtol=1e-15, atol=0.0)
    assert superposed.metadata.time_au == 0.0
    assert superposed.metadata.representation is RepresentationKind.SLICE


def test_superposition_resolution_floor_uses_the_largest_shell() -> None:
    state = SuperpositionState(
        terms=(
            SuperpositionTerm(1, 0, 0, 1.0 / np.sqrt(2.0)),
            SuperpositionTerm(4, 1, 0, 1.0 / np.sqrt(2.0)),
        ),
        basis=BasisKind.REAL,
    )
    with pytest.raises(ValueError, match="resolution must be at least 81"):
        build_superposition_slice(
            state,
            time=0.0,
            plane=PrincipalPlane.XZ,
            observable=SliceObservable.PROBABILITY_DENSITY,
            resolution=65,
        )
