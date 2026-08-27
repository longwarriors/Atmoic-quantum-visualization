"""Plane primitives for slice assets: frames, sample axis, and mask thresholds.

Three things here are contract, not implementation detail.

**The frames.** A principal plane is sampled in an explicit right-handed
``(u, v, n)`` frame with ``u x v = n``. That forces the ``xz`` normal to be
``-y``, not ``+y``; a slice that reported ``+y`` would mirror every
handedness-sensitive claim (probability-current circulation, the sign of the
phase winding) about that plane.

**The axis.** ``np.linspace(-extent, extent, resolution)`` is *not* bitwise
antisymmetric at a generic extent -- it is built as ``start + step*i`` and then
patched at the endpoints, so the two halves disagree in the last bits. Slice
symmetry claims and node locations would then be decided by rounding. The axis
is therefore ``spacing * (arange(resolution) - half)``, which is antisymmetric
bit for bit because IEEE negation is exact and ``arange`` over small integers is
exact. ``tests/test_planes.py`` keeps a negative control that fails if the
formula is swapped back to ``linspace``.

**The mask.** The phase of a wavefunction is undefined where its amplitude
vanishes, and on a plane of exact nodal symmetry the computed amplitude is not
zero but numerical residue (2p_z on the xy plane lands near ``4e-18``, not
``0``). The threshold is therefore referenced to the *state's* amplitude scale
``L_ref**-1.5`` rather than to a per-slice maximum, so a slice that happens to
lie entirely in a low-amplitude region does not silently rescale its own
definition of "small". The resulting mask marks a **low-amplitude,
phase-undefined region**. It is not a node certificate: an unmasked point is not
proof of a node, and a masked point is not proof of one either.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quviz.conventions import PrincipalPlane

type FloatArray = NDArray[np.float64]
type BoolArray = NDArray[np.bool_]

#: Amplitude below ``relative * L_ref**-1.5`` is treated as phase-undefined.
DEFAULT_PHASE_MASK_RELATIVE = 1e-6

#: Multiple of the double-precision epsilon defining the numeric floor. Below
#: ``64 * eps * max|psi|`` on the plane, a magnitude is cancellation residue of
#: the evaluation itself rather than a resolved amplitude.
NUMERIC_FLOOR_EPS_MULTIPLE = 64

_EPS = float(np.finfo(np.float64).eps)


@dataclass(frozen=True, slots=True)
class PlaneFrame:
    """Right-handed ``(u, v, n)`` frame of a principal plane, with ``u x v = n``."""

    plane: PrincipalPlane
    u_axis: tuple[float, float, float]
    v_axis: tuple[float, float, float]
    normal: tuple[float, float, float]


#: The frozen plane frames. ``xz`` has normal ``-y`` because ``x_hat x z_hat =
#: -y_hat``; picking ``+y`` there would make the frame left-handed.
PLANE_FRAMES: Mapping[PrincipalPlane, PlaneFrame] = MappingProxyType(
    {
        PrincipalPlane.XY: PlaneFrame(
            plane=PrincipalPlane.XY,
            u_axis=(1.0, 0.0, 0.0),
            v_axis=(0.0, 1.0, 0.0),
            normal=(0.0, 0.0, 1.0),
        ),
        PrincipalPlane.XZ: PlaneFrame(
            plane=PrincipalPlane.XZ,
            u_axis=(1.0, 0.0, 0.0),
            v_axis=(0.0, 0.0, 1.0),
            normal=(0.0, -1.0, 0.0),
        ),
        PrincipalPlane.YZ: PlaneFrame(
            plane=PrincipalPlane.YZ,
            u_axis=(0.0, 1.0, 0.0),
            v_axis=(0.0, 0.0, 1.0),
            normal=(1.0, 0.0, 0.0),
        ),
    }
)


def plane_frame(plane: PrincipalPlane | str) -> PlaneFrame:
    """Return the frozen frame of ``plane``."""

    return PLANE_FRAMES[PrincipalPlane(plane)]


def axis_spacing(extent: float, resolution: int) -> float:
    """Return the sample spacing ``2 * extent / (resolution - 1)``."""

    _validate_axis_arguments(extent, resolution)
    return 2.0 * extent / (resolution - 1)


def symmetric_axis(extent: float, resolution: int) -> FloatArray:
    """Return the exactly antisymmetric sample axis on ``[-extent, extent]``.

    The result satisfies ``axis[(resolution - 1) // 2] == 0.0`` and
    ``np.array_equal(axis, -axis[::-1])`` bit for bit at any extent. Neither
    holds for ``np.linspace(-extent, extent, resolution)``.
    """

    _validate_axis_arguments(extent, resolution)
    half = (resolution - 1) // 2
    spacing = 2.0 * extent / (resolution - 1)
    return np.asarray(spacing * (np.arange(resolution) - half), dtype=np.float64)


def plane_grid_points(
    plane: PrincipalPlane | str,
    extent: float,
    resolution: int,
) -> FloatArray:
    """Return the row-major sample points of ``plane`` as ``(resolution**2, 3)``.

    Sample ``k = row * resolution + col`` sits at ``origin + axis[col] * u +
    axis[row] * v`` with ``origin`` the coordinate origin: ``row`` indexes ``v``
    (slow) and ``col`` indexes ``u`` (fast).
    """

    frame = plane_frame(plane)
    axis = symmetric_axis(extent, resolution)
    u_coordinate = np.broadcast_to(axis, (resolution, resolution)).reshape(-1, 1)
    v_coordinate = np.broadcast_to(axis[:, None], (resolution, resolution)).reshape(-1, 1)
    points = u_coordinate * np.asarray(frame.u_axis) + v_coordinate * np.asarray(frame.v_axis)
    return np.asarray(points, dtype=np.float64)


def reference_length(
    principal_quantum_numbers: Iterable[int],
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
) -> float:
    """Return the state length scale ``L_ref = max_k n_k**2 * a_mu / Z``.

    For an eigenstate this is the single ``n**2 * a_mu / Z``; for a
    superposition the largest component sets the extent of the state, so it sets
    the amplitude scale the mask threshold is referenced to.
    """

    values = list(principal_quantum_numbers)
    if not values:
        raise ValueError("at least one principal quantum number is required")
    if any(n < 1 for n in values):
        raise ValueError("principal quantum numbers must be positive integers")
    if z <= 0.0:
        raise ValueError("z must be positive")
    if a_mu <= 0.0:
        raise ValueError("a_mu must be positive")
    return max(n * n for n in values) * a_mu / z


def amplitude_scale(length_scale: float) -> float:
    """Return the wavefunction amplitude scale ``L_ref**-1.5``.

    ``psi`` has dimensions of ``length**-3/2`` because ``|psi|**2`` integrates to
    one over a volume, so this is the natural magnitude of the state whose
    length scale is ``length_scale``.
    """

    if not np.isfinite(length_scale) or length_scale <= 0.0:
        raise ValueError("length_scale must be positive and finite")
    return float(length_scale**-1.5)


@dataclass(frozen=True, slots=True)
class MaskThresholds:
    """The reported terms of the phase-mask rule.

    ``effective_threshold`` is ``max(threshold, numeric_floor)``; a sample is
    valid when its amplitude is **strictly** greater than it. Every term is
    reported so a consumer can see which one bound the mask.
    """

    relative: float
    amplitude_scale: float
    threshold: float
    numeric_floor: float
    effective_threshold: float
    max_amplitude_on_plane: float


def phase_mask_thresholds(
    *,
    reference_length: float,
    max_amplitude_on_plane: float,
    relative: float = DEFAULT_PHASE_MASK_RELATIVE,
) -> MaskThresholds:
    """Return the mask terms for a state of scale ``reference_length``.

    ``threshold`` is referenced to the state, ``numeric_floor`` to the plane's
    own largest magnitude; the floor only takes over when the evaluation's own
    cancellation residue exceeds the state-referenced threshold.
    """

    if relative <= 0.0 or not np.isfinite(relative):
        raise ValueError("relative must be positive and finite")
    if not np.isfinite(max_amplitude_on_plane) or max_amplitude_on_plane < 0.0:
        raise ValueError("max_amplitude_on_plane must be non-negative and finite")

    scale = amplitude_scale(reference_length)
    threshold = relative * scale
    numeric_floor = NUMERIC_FLOOR_EPS_MULTIPLE * _EPS * max_amplitude_on_plane
    return MaskThresholds(
        relative=relative,
        amplitude_scale=scale,
        threshold=threshold,
        numeric_floor=numeric_floor,
        effective_threshold=max(threshold, numeric_floor),
        max_amplitude_on_plane=float(max_amplitude_on_plane),
    )


def valid_amplitude_mask(amplitude: ArrayLike, thresholds: MaskThresholds) -> BoolArray:
    """Return where the amplitude is resolved well enough for a defined phase.

    ``True`` means the magnitude is strictly above ``effective_threshold``.
    ``False`` marks a **low-amplitude, phase-undefined** sample -- it is not a
    certificate that a node passes through that sample.
    """

    magnitude = np.asarray(amplitude, dtype=np.float64)
    return np.asarray(magnitude > thresholds.effective_threshold, dtype=np.bool_)


def _validate_axis_arguments(extent: float, resolution: int) -> None:
    if not np.isfinite(extent) or extent <= 0.0:
        raise ValueError("extent must be positive and finite")
    if resolution < 3:
        raise ValueError("resolution must be at least 3")
    if resolution % 2 == 0:
        # ``half = (resolution - 1) // 2`` is the exact centre only for odd
        # counts; an even axis cannot contain the origin, and every symmetry
        # and mask claim here is stated about a plane through the origin.
        raise ValueError("resolution must be odd so the axis contains the origin")
