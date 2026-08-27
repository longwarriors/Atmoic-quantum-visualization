"""Plane-section ("slice") assets for eigenstates and superpositions.

A slice reports one scalar field of the wavefunction on a principal plane
through the origin. Three decisions here are contract rather than taste.

**The extent is derived, never requested.** It is the same padded radial
quantile the volumetric builders use --- :func:`radial_extent_for_mass` for an
eigenstate, :func:`superposition_extent` for a mixture --- and it is reported in
the payload. A caller-supplied extent would let two slices of the same state
disagree about where the state ends, and every masked-fraction or symmetry
statement would then be a statement about the caller's crop.

**The resolution floor is not the isosurface's cap.**
:func:`quviz.scene.builders.build_isosurface` refuses ``n > 4``, but that limit
is about *marching cubes*: the mesh extraction, the winding fix and the mass
accounting are validated only for those shells, and a triangulated surface of a
high-``n`` state at an affordable grid is a shape nobody has checked. A slice
extracts no mesh. It evaluates ``psi`` at ``resolution**2`` points and reports
the numbers, so the only thing resolution has to buy is enough samples to
resolve the outermost radial oscillation: an ``n`` state has ``n - l`` radial
antinodes spread over an extent that itself grows like ``n**2``, so the floor
grows linearly, ``max(65, 16 * n + 17)``. High ``n`` therefore costs samples
here, not validity.

**The mask is referenced to the state, not to the plane.** See
:mod:`quviz.physics.planes`: a plane of exact nodal symmetry carries numerical
residue (``2p_z`` on the ``xy`` plane lands near ``4e-18``), and a threshold
taken from the plane's own maximum would rescale itself to that residue and
hand back a full field of meaningless phases. The threshold is
``relative * L_ref**-1.5``. What the mask marks is a **low-amplitude,
phase-undefined** region; it is never a certificate that a node passes through
a sample.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from types import MappingProxyType
from typing import Any, Final

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quviz.conventions import (
    BasisKind,
    ObservableKind,
    PrincipalPlane,
    RepresentationKind,
    SliceObservable,
)
from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    hydrogenic_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.observables import phase, probability_density
from quviz.physics.planes import (
    MaskThresholds,
    axis_spacing,
    phase_mask_thresholds,
    plane_frame,
    plane_grid_points,
    reference_length,
    valid_amplitude_mask,
)
from quviz.physics.superposition import SuperpositionState
from quviz.scene.builders import (
    orbital_metadata,
    radial_extent_for_mass,
    superposition_extent,
    superposition_metadata,
)
from quviz.scene.models import (
    SLICE_VALUE_UNITS,
    SliceDetail,
    SlicePayload,
    SuperpositionSlicePayload,
)

type FloatArray = NDArray[np.float64]
type BoolArray = NDArray[np.bool_]

#: Masked samples carry this finite placeholder rather than a residue value, so
#: a client that ignores the mask draws something definite and the payload
#: survives a strict JSON parser.
MASKED_VALUE_SENTINEL: Final[float] = 0.0

#: Smallest and largest sample counts along one plane axis. Both bounds are also
#: enforced by ``SlicePayload``; they are checked here so the failure is a plain
#: ``ValueError`` naming the offending number, which the API routes to 422.
MINIMUM_SLICE_RESOLUTION: Final[int] = 65
MAXIMUM_SLICE_RESOLUTION: Final[int] = 513

#: Enough for a legible picture of the shells that dominate use, and 16x cheaper
#: than the 513 ceiling.
DEFAULT_SLICE_RESOLUTION: Final[int] = 129

#: A slice reports the real and imaginary parts of ``psi`` as separate scalar
#: fields, so two slice observables map onto the same physical observable.
_SLICE_OBSERVABLE_KINDS: Final[Mapping[SliceObservable, ObservableKind]] = MappingProxyType(
    {
        SliceObservable.PROBABILITY_DENSITY: ObservableKind.PROBABILITY_DENSITY,
        SliceObservable.WAVEFUNCTION_REAL: ObservableKind.WAVEFUNCTION,
        SliceObservable.WAVEFUNCTION_IMAG: ObservableKind.WAVEFUNCTION,
        SliceObservable.PHASE: ObservableKind.PHASE,
    }
)


def slice_resolution_floor(highest_principal_number: int) -> int:
    """Return the smallest honest sample count for a state reaching ``n``.

    ``max(65, 16 * n + 17)``: odd by construction so the origin is a sample, and
    linear in ``n`` because the number of radial antinodes grows like ``n - l``
    while the extent grows like ``n**2``.
    """

    if highest_principal_number < 1:
        raise ValueError("principal quantum number must be positive")
    return max(MINIMUM_SLICE_RESOLUTION, 16 * highest_principal_number + 17)


def _validate_slice_resolution(resolution: int, highest_principal_number: int) -> None:
    """Reject sample counts that would make the payload's own claims false."""

    if resolution % 2 == 0:
        # Every symmetry, node and mask statement about a slice is stated about
        # a plane *through the origin*; an even axis never samples it.
        raise ValueError("resolution must be odd so the origin lies on the grid")
    floor = slice_resolution_floor(highest_principal_number)
    if resolution < floor:
        raise ValueError(
            f"resolution must be at least {floor} for n={highest_principal_number}: "
            "a coarser plane cannot resolve the outermost radial oscillation of that shell"
        )
    if resolution > MAXIMUM_SLICE_RESOLUTION:
        raise ValueError(
            f"resolution must be at most {MAXIMUM_SLICE_RESOLUTION}: "
            f"{resolution}**2 samples exceed what one JSON payload should carry"
        )


@dataclass(frozen=True, slots=True)
class _SliceField:
    """The sampled scalar field, its mask, and the rule that produced it."""

    values: FloatArray
    valid_mask: BoolArray | None
    thresholds: MaskThresholds
    masked_fraction: float | None
    warnings: tuple[str, ...]


def _slice_field(
    psi: ArrayLike,
    *,
    observable: SliceObservable,
    plane: PrincipalPlane,
    state_reference_length: float,
) -> _SliceField:
    """Reduce sampled ``psi`` to one reported scalar field, masked if it is phase."""

    values_psi = np.asarray(psi)
    magnitude = np.asarray(np.abs(values_psi), dtype=np.float64)
    max_amplitude = float(np.max(magnitude))
    thresholds = phase_mask_thresholds(
        reference_length=state_reference_length,
        max_amplitude_on_plane=max_amplitude,
    )

    notes: list[str] = []
    if max_amplitude == 0.0:
        notes.append(
            f"|psi| is exactly zero at every sample of the {plane.value} plane, so this slice "
            "carries no amplitude information and every reported value is zero"
        )

    if observable is not SliceObservable.PHASE:
        if observable is SliceObservable.PROBABILITY_DENSITY:
            values = probability_density(values_psi)
        elif observable is SliceObservable.WAVEFUNCTION_REAL:
            values = np.asarray(np.real(values_psi), dtype=np.float64)
        else:
            values = np.asarray(np.imag(values_psi), dtype=np.float64)
        return _SliceField(
            values=values,
            valid_mask=None,
            thresholds=thresholds,
            masked_fraction=None,
            warnings=tuple(notes),
        )

    mask = valid_amplitude_mask(magnitude, thresholds)
    masked = np.asarray(np.where(mask, phase(values_psi), MASKED_VALUE_SENTINEL), dtype=np.float64)
    masked_fraction = float(np.count_nonzero(~mask)) / float(mask.size)
    if masked_fraction == 1.0:
        notes.append(
            f"every sample of the {plane.value} plane is below the phase-mask threshold, so the "
            "phase slice is fully masked; this marks a low-amplitude, phase-undefined region and "
            "is not a certificate that a node lies in this plane"
        )
    return _SliceField(
        values=masked,
        valid_mask=mask,
        thresholds=thresholds,
        masked_fraction=masked_fraction,
        warnings=tuple(notes),
    )


def _payload_fields(
    *,
    plane: PrincipalPlane,
    observable: SliceObservable,
    extent: float,
    resolution: int,
    field: _SliceField,
) -> dict[str, Any]:
    """Assemble the grid description and the mask report shared by both payloads."""

    frame = plane_frame(plane)
    is_phase = observable is SliceObservable.PHASE
    thresholds = field.thresholds
    return {
        "plane": plane,
        "slice_observable": observable,
        "origin_bohr": [0.0, 0.0, 0.0],
        "u_axis": list(frame.u_axis),
        "v_axis": list(frame.v_axis),
        "normal": list(frame.normal),
        "extent_bohr": extent,
        "spacing_bohr": axis_spacing(extent, resolution),
        "resolution": resolution,
        "value_unit": SLICE_VALUE_UNITS[observable],
        # Deliberately unrounded: a rounded slice would move node crossings and
        # silently rewrite the small magnitudes the mask is decided on.
        "values": field.values.tolist(),
        "valid_mask": None if field.valid_mask is None else field.valid_mask.tolist(),
        "masked_value_sentinel": MASKED_VALUE_SENTINEL,
        "phase_mask_relative_amplitude": thresholds.relative if is_phase else None,
        "phase_mask_amplitude_scale": thresholds.amplitude_scale if is_phase else None,
        "phase_mask_amplitude_threshold": thresholds.threshold if is_phase else None,
        "phase_mask_numeric_floor": thresholds.numeric_floor if is_phase else None,
        "max_amplitude_on_plane": thresholds.max_amplitude_on_plane,
        "phase_masked_fraction": field.masked_fraction,
    }


# Cache arithmetic, so the ceiling this buys is stated rather than guessed. The
# largest slice is 513**2 = 263_169 samples, and the payload holds them as the
# JSON-ready ``list[float]``: ~8 MB, since a boxed CPython float is 24 bytes
# plus an 8-byte pointer. A phase slice adds a ``list[bool]`` of pointers to the
# two singletons, ~2 MB. Eight such entries is therefore ~80 MB worst case; a
# typical 129-sample slice is ~0.5 MB, so the usual footprint is ~4 MB. Entries
# are shared, so a returned payload must be treated as read-only.
@lru_cache(maxsize=8)
def build_slice(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    basis: BasisKind | str = BasisKind.REAL,
    plane: PrincipalPlane | str,
    observable: SliceObservable | str,
    resolution: int = DEFAULT_SLICE_RESOLUTION,
) -> SlicePayload:
    """Build the plane section of one eigenstate's scalar field.

    The extent is derived from ``(n, l, z, a_mu)`` and reported; it is not a
    parameter. ``resolution`` must be odd and at least
    :func:`slice_resolution_floor` of ``n``.
    """

    validate_quantum_numbers(n, l, m)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if a_mu <= 0.0:
        raise ValueError("a_mu must be positive")
    basis_kind = BasisKind(basis)
    plane_kind = PrincipalPlane(plane)
    field_kind = SliceObservable(observable)
    _validate_slice_resolution(resolution, n)

    extent = radial_extent_for_mass(n, l, z, a_mu=a_mu)
    points = plane_grid_points(plane_kind, extent, resolution)
    radius, polar, azimuth = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
    psi = hydrogenic_wavefunction(
        n,
        l,
        m,
        radius,
        polar,
        azimuth,
        z=z,
        a_mu=a_mu,
        basis=basis_kind,
    )
    field = _slice_field(
        psi,
        observable=field_kind,
        plane=plane_kind,
        state_reference_length=reference_length([n], z=z, a_mu=a_mu),
    )
    metadata = orbital_metadata(
        n,
        l,
        m,
        z=z,
        a_mu=a_mu,
        basis=basis_kind,
        observable=_SLICE_OBSERVABLE_KINDS[field_kind],
        representation=RepresentationKind.SLICE,
        slice_detail=SliceDetail(plane=plane_kind, slice_observable=field_kind),
        warnings=list(field.warnings),
    )
    return SlicePayload(
        metadata=metadata,
        **_payload_fields(
            plane=plane_kind,
            observable=field_kind,
            extent=extent,
            resolution=resolution,
            field=field,
        ),
    )


@lru_cache(maxsize=8)
def build_superposition_slice(
    state: SuperpositionState,
    *,
    time: float = 0.0,
    plane: PrincipalPlane | str,
    observable: SliceObservable | str,
    resolution: int = DEFAULT_SLICE_RESOLUTION,
) -> SuperpositionSlicePayload:
    """Build the plane section of a superposition's scalar field at one instant.

    The widest term sets the extent and the largest ``n`` sets both the
    resolution floor and the mask's reference length: a mixture is as extended,
    and as finely structured, as its most extended component.
    """

    plane_kind = PrincipalPlane(plane)
    field_kind = SliceObservable(observable)
    principal_numbers = [term.n for term in state.terms]
    _validate_slice_resolution(resolution, max(principal_numbers))

    extent = superposition_extent(state)
    points = plane_grid_points(plane_kind, extent, resolution)
    radius, polar, azimuth = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
    psi = state.evaluate(radius, polar, azimuth, time=time)
    field = _slice_field(
        psi,
        observable=field_kind,
        plane=plane_kind,
        state_reference_length=reference_length(principal_numbers, z=state.z, a_mu=state.a_mu),
    )
    metadata = superposition_metadata(
        state,
        time=time,
        observable=_SLICE_OBSERVABLE_KINDS[field_kind],
        representation=RepresentationKind.SLICE,
        slice_detail=SliceDetail(plane=plane_kind, slice_observable=field_kind),
        warnings=list(field.warnings),
    )
    return SuperpositionSlicePayload(
        metadata=metadata,
        **_payload_fields(
            plane=plane_kind,
            observable=field_kind,
            extent=extent,
            resolution=resolution,
            field=field,
        ),
    )
