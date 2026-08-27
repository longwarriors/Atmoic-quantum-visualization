"""Plane primitives: frames, the exactly-symmetric axis, and mask thresholds.

These are contract tests, not tolerance tests. The slice API promises that a
principal plane is sampled on an axis that is *bitwise* antisymmetric and that
contains the origin exactly, because slice symmetry claims (and the phase mask
that rides on them) are otherwise decided by floating-point noise rather than
by physics.
"""

from __future__ import annotations

import numpy as np
import pytest

from quviz.conventions import PrincipalPlane, SliceObservable
from quviz.physics.planes import (
    DEFAULT_PHASE_MASK_RELATIVE,
    NUMERIC_FLOOR_EPS_MULTIPLE,
    PLANE_FRAMES,
    amplitude_scale,
    phase_mask_thresholds,
    plane_frame,
    plane_grid_points,
    reference_length,
    symmetric_axis,
    valid_amplitude_mask,
)

AWKWARD_EXTENT = 30.123456789
RESOLUTIONS = (65, 129, 257, 513)


def test_plane_enums_are_pinned_string_values() -> None:
    assert [member.value for member in PrincipalPlane] == ["xy", "xz", "yz"]
    assert [member.value for member in SliceObservable] == [
        "probability_density",
        "wavefunction_real",
        "wavefunction_imag",
        "phase",
    ]


def test_three_plane_frames_are_frozen_including_the_negative_y_normal() -> None:
    """The xz normal is -y, not +y. (u, v, n) is right-handed: u x v = n."""

    assert plane_frame(PrincipalPlane.XY).u_axis == (1.0, 0.0, 0.0)
    assert plane_frame(PrincipalPlane.XY).v_axis == (0.0, 1.0, 0.0)
    assert plane_frame(PrincipalPlane.XY).normal == (0.0, 0.0, 1.0)

    assert plane_frame(PrincipalPlane.XZ).u_axis == (1.0, 0.0, 0.0)
    assert plane_frame(PrincipalPlane.XZ).v_axis == (0.0, 0.0, 1.0)
    assert plane_frame(PrincipalPlane.XZ).normal == (0.0, -1.0, 0.0)

    assert plane_frame(PrincipalPlane.YZ).u_axis == (0.0, 1.0, 0.0)
    assert plane_frame(PrincipalPlane.YZ).v_axis == (0.0, 0.0, 1.0)
    assert plane_frame(PrincipalPlane.YZ).normal == (1.0, 0.0, 0.0)

    assert set(PLANE_FRAMES) == set(PrincipalPlane)
    for plane in PrincipalPlane:
        frame = plane_frame(plane)
        cross = np.cross(np.asarray(frame.u_axis), np.asarray(frame.v_axis))
        assert tuple(cross.tolist()) == frame.normal


def test_plane_frame_accepts_the_string_spelling() -> None:
    assert plane_frame("xz") is plane_frame(PrincipalPlane.XZ)


@pytest.mark.parametrize("resolution", RESOLUTIONS)
def test_symmetric_axis_is_bitwise_antisymmetric_at_an_awkward_extent(resolution: int) -> None:
    axis = symmetric_axis(AWKWARD_EXTENT, resolution)
    half = (resolution - 1) // 2

    assert axis.shape == (resolution,)
    assert axis[half] == 0.0
    assert np.array_equal(axis, -axis[::-1])
    assert axis[0] == -AWKWARD_EXTENT
    assert axis[-1] == AWKWARD_EXTENT


@pytest.mark.parametrize("resolution", RESOLUTIONS)
def test_linspace_negative_control_is_not_bitwise_antisymmetric(resolution: int) -> None:
    """The arange formula is load-bearing: linspace is only *nearly* symmetric.

    ``np.linspace(-E, E, R)`` is computed as ``start + step*i`` and rescaled, so
    at a generic extent the two halves differ in the last bits. If this ever
    passes, ``symmetric_axis`` may be replaced by ``linspace``; until then it
    may not.
    """

    linspace_axis = np.linspace(-AWKWARD_EXTENT, AWKWARD_EXTENT, resolution)

    assert not np.array_equal(linspace_axis, -linspace_axis[::-1])
    assert np.allclose(linspace_axis, symmetric_axis(AWKWARD_EXTENT, resolution))


def test_symmetric_axis_rejects_even_and_degenerate_resolutions() -> None:
    """An even resolution cannot contain the origin, so it cannot be offered."""

    with pytest.raises(ValueError, match="odd"):
        symmetric_axis(AWKWARD_EXTENT, 64)
    with pytest.raises(ValueError, match="at least 3"):
        symmetric_axis(AWKWARD_EXTENT, 1)
    with pytest.raises(ValueError, match="extent"):
        symmetric_axis(0.0, 65)


def test_grid_is_row_major_with_v_slow_and_u_fast_and_contains_the_origin() -> None:
    resolution = 9
    extent = AWKWARD_EXTENT
    axis = symmetric_axis(extent, resolution)
    half = (resolution - 1) // 2

    for plane in PrincipalPlane:
        frame = plane_frame(plane)
        points = plane_grid_points(plane, extent, resolution)
        assert points.shape == (resolution * resolution, 3)

        u_axis = np.asarray(frame.u_axis)
        v_axis = np.asarray(frame.v_axis)
        for row, col in ((0, 0), (0, resolution - 1), (half, half), (3, 7), (8, 2)):
            index = row * resolution + col
            expected = axis[col] * u_axis + axis[row] * v_axis
            assert np.array_equal(points[index], expected)

        # Origin inclusion is exact, and it is the only exactly-zero point.
        centre = half * resolution + half
        assert np.array_equal(points[centre], np.zeros(3))
        assert int(np.count_nonzero(np.all(points == 0.0, axis=1))) == 1

        # The out-of-plane coordinate is identically zero on every point.
        normal_component = points @ np.asarray(frame.normal)
        assert np.array_equal(normal_component, np.zeros(resolution * resolution))


def test_grid_inherits_bitwise_antisymmetry_under_point_reflection() -> None:
    resolution = 65
    points = plane_grid_points(PrincipalPlane.XZ, AWKWARD_EXTENT, resolution)
    assert np.array_equal(points, -points[::-1])


def test_reference_length_uses_the_largest_principal_quantum_number() -> None:
    assert reference_length([2]) == pytest.approx(4.0)
    assert reference_length([1, 3, 2]) == pytest.approx(9.0)
    assert reference_length([2], z=1.0, a_mu=2.0) == pytest.approx(8.0)

    with pytest.raises(ValueError, match="at least one"):
        reference_length([])
    with pytest.raises(ValueError, match="z must be positive"):
        reference_length([1], z=0.0)
    with pytest.raises(ValueError, match="a_mu must be positive"):
        reference_length([1], a_mu=-1.0)


def test_amplitude_scale_is_covariant_when_the_nuclear_charge_doubles() -> None:
    """L_ref = n^2 a_mu / Z, so doubling Z halves L_ref and scales |psi| by 2^{3/2}.

    The phase-mask threshold references this *state* amplitude scale rather than
    a per-slice maximum, so it must track Z the way the wavefunction does.
    """

    singly_charged = reference_length([2], z=1.0)
    doubly_charged = reference_length([2], z=2.0)
    assert doubly_charged == pytest.approx(singly_charged / 2.0)

    ratio = amplitude_scale(doubly_charged) / amplitude_scale(singly_charged)
    assert ratio == pytest.approx(2.0**1.5)
    assert amplitude_scale(singly_charged) == pytest.approx(singly_charged**-1.5)

    with pytest.raises(ValueError, match="positive"):
        amplitude_scale(0.0)


def test_phase_mask_thresholds_report_every_frozen_field() -> None:
    length = reference_length([2])
    scale = amplitude_scale(length)
    max_amplitude = 4.0e-3

    thresholds = phase_mask_thresholds(
        reference_length=length,
        max_amplitude_on_plane=max_amplitude,
    )

    assert DEFAULT_PHASE_MASK_RELATIVE == 1e-6
    assert NUMERIC_FLOOR_EPS_MULTIPLE == 64
    assert thresholds.relative == DEFAULT_PHASE_MASK_RELATIVE
    assert thresholds.amplitude_scale == pytest.approx(scale)
    assert thresholds.threshold == pytest.approx(DEFAULT_PHASE_MASK_RELATIVE * scale)
    expected_floor = NUMERIC_FLOOR_EPS_MULTIPLE * float(np.finfo(np.float64).eps) * max_amplitude
    assert thresholds.numeric_floor == pytest.approx(expected_floor)
    assert thresholds.effective_threshold == pytest.approx(
        max(thresholds.threshold, thresholds.numeric_floor)
    )
    assert thresholds.max_amplitude_on_plane == pytest.approx(max_amplitude)


def test_numeric_floor_wins_when_the_plane_amplitude_is_huge() -> None:
    length = reference_length([2])
    thresholds = phase_mask_thresholds(reference_length=length, max_amplitude_on_plane=1.0e12)
    assert thresholds.effective_threshold == pytest.approx(thresholds.numeric_floor)
    assert thresholds.numeric_floor > thresholds.threshold


def test_valid_amplitude_mask_is_strict_and_flags_the_2pz_xy_plane_residue() -> None:
    """|psi| ~ 4e-18 on the 2p_z xy plane is *below* threshold, not zero."""

    length = reference_length([2])
    thresholds = phase_mask_thresholds(
        reference_length=length,
        max_amplitude_on_plane=4.0e-18,
    )
    amplitude = np.asarray([4.0e-18, thresholds.effective_threshold, 1.0e-2])
    mask = valid_amplitude_mask(amplitude, thresholds)

    assert mask.dtype == np.bool_
    assert mask.tolist() == [False, False, True]
