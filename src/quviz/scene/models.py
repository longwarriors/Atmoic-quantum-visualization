"""Typed contracts shared conceptually by Python and TypeScript."""

from __future__ import annotations

from collections.abc import Mapping
from math import isfinite
from types import MappingProxyType
from typing import Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from quviz.conventions import (
    LENGTH_UNIT,
    BasisKind,
    ObservableKind,
    PrincipalPlane,
    RepresentationKind,
    SliceObservable,
)

#: The unit a slice value carries, fixed by the scalar field it reports. Phase
#: is an angle, an amplitude component is ``bohr^-3/2``, and a density is its
#: square. A payload that claimed another unit would misstate its own numbers.
SLICE_VALUE_UNITS: Final[Mapping[SliceObservable, str]] = MappingProxyType(
    {
        SliceObservable.PROBABILITY_DENSITY: "bohr^-3",
        SliceObservable.WAVEFUNCTION_REAL: "bohr^-3/2",
        SliceObservable.WAVEFUNCTION_IMAG: "bohr^-3/2",
        SliceObservable.PHASE: "radian",
    }
)

#: Row-major sampling order of every slice: ``k = row * resolution + col``, with
#: ``row`` indexing ``v`` and ``col`` indexing ``u``.
SliceLayout = Literal["row_major_v_rows_u_columns"]


class QuantumStateSpec(BaseModel):
    """A reproducible hydrogenic state specification."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    n: int = Field(ge=1, le=12)
    l: int = Field(ge=0, le=11)
    m: int = Field(ge=-11, le=11)
    z: float = Field(default=1.0, gt=0.0, le=20.0)
    a_mu: float = Field(default=1.0, gt=0.0, le=20.0)
    basis: BasisKind = BasisKind.REAL

    @model_validator(mode="after")
    def validate_quantum_number_relationships(self) -> QuantumStateSpec:
        if self.l >= self.n:
            raise ValueError("l must satisfy 0 <= l < n")
        if abs(self.m) > self.l:
            raise ValueError("m must satisfy |m| <= l")
        return self


class SliceDetail(BaseModel):
    """The plane and the scalar field that identify a slice asset.

    One object rather than two arguments, so a metadata builder can never be
    handed half of a slice identity: a plane with no field, or a field with no
    plane.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    plane: PrincipalPlane
    slice_observable: SliceObservable


class OrbitalMetadata(BaseModel):
    """Metadata that keeps physical semantics attached to rendered data."""

    model_config = ConfigDict(extra="forbid")

    state: QuantumStateSpec
    label: str
    energy_hartree: float
    length_unit: str = LENGTH_UNIT
    observable: ObservableKind
    representation: RepresentationKind
    normalization: str = "integral(|psi|^2 dV)=1"
    coordinate_convention: str
    spherical_harmonic_convention: str
    geometry_semantics: str
    color_semantics: str
    references: list[str]
    warnings: list[str] = Field(default_factory=list)


class IsosurfacePayload(BaseModel):
    """Indexed mesh with per-vertex phase for GPU coloring."""

    metadata: OrbitalMetadata
    vertices: list[list[float]]
    normals: list[list[float]]
    faces: list[list[int]]
    phase: list[float]
    density_level: float = Field(gt=0.0)
    requested_probability_mass: float = Field(ge=0.0, le=1.0)
    captured_probability_mass: float = Field(ge=0.0)
    finite_grid_density_integral: float = Field(gt=0.0)
    grid_resolution: int = Field(ge=3)
    grid_spacing_bohr: float = Field(gt=0.0)
    integration_rule: str = "tensor_product_simpson"
    extent_bohr: float = Field(gt=0.0)


class CurrentFieldPayload(BaseModel):
    """Probability-flow streamlines with the numbers needed to judge them.

    Geometry and magnitude stay separate: vertices are evenly spaced in arc
    length, and ``speed`` carries |j|/rho per vertex. Rendering must not encode
    speed as spacing, or the picture would show the same quantity twice.
    """

    metadata: OrbitalMetadata
    lines: list[list[list[float]]]
    speed: list[list[float]]
    seed_count: int = Field(ge=0)
    max_speed: float = Field(ge=0.0)
    arc_step_bohr: float = Field(gt=0.0)
    seed_density_floor: float = Field(ge=0.0)
    extent_bohr: float = Field(gt=0.0)
    continuity_residual: float = Field(ge=0.0)
    continuity_absolute_residual: float = Field(ge=0.0)
    continuity_scale: float = Field(ge=0.0)
    continuity_scale_kind: Literal["stationary_current", "analytic_zero_current"]
    continuity_probe_count: int = Field(ge=0)
    integration_rule: str = "rk4_arc_length"


class SuperpositionTermSpec(BaseModel):
    """One eigenstate and its complex amplitude, JSON-serialisable."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    n: int = Field(ge=1, le=12)
    l: int = Field(ge=0, le=11)
    m: int = Field(ge=-11, le=11)
    coefficient_real: float
    coefficient_imag: float = 0.0


class SuperpositionMetadata(BaseModel):
    """Metadata for a time-dependent superposition.

    Deliberately not an ``OrbitalMetadata``: a superposition has no single
    ``(n, l, m)``, and forcing one would make the contract claim a state the
    asset is not showing. The coefficients and the time are part of the
    physical identity here, so they are required fields.
    """

    model_config = ConfigDict(extra="forbid")

    terms: list[SuperpositionTermSpec]
    label: str
    basis: BasisKind
    z: float = Field(gt=0.0)
    a_mu: float = Field(gt=0.0)
    reduced_mass_ratio: float = Field(gt=0.0)
    time_au: float
    energy_expectation_hartree: float
    is_stationary: bool
    length_unit: str = LENGTH_UNIT
    observable: ObservableKind
    representation: RepresentationKind
    normalization: str = "sum |c_k|^2 = 1 with orthonormal psi_k"
    coordinate_convention: str
    spherical_harmonic_convention: str
    geometry_semantics: str
    color_semantics: str
    references: list[str]
    warnings: list[str] = Field(default_factory=list)


class SuperpositionIsosurfacePayload(BaseModel):
    """A |Psi|^2 isosurface at one instant."""

    metadata: SuperpositionMetadata
    vertices: list[list[float]]
    normals: list[list[float]]
    faces: list[list[int]]
    phase: list[float]
    density_level: float = Field(gt=0.0)
    requested_probability_mass: float = Field(ge=0.0, le=1.0)
    captured_probability_mass: float = Field(ge=0.0)
    finite_grid_density_integral: float = Field(gt=0.0)
    grid_resolution: int = Field(ge=3)
    grid_spacing_bohr: float = Field(gt=0.0)
    integration_rule: str = "tensor_product_simpson"
    extent_bohr: float = Field(gt=0.0)
    finite_box_tail_mass_upper_bound: float = Field(ge=0.0, le=1.0)
    finite_box_mass_variation_upper_bound: float = Field(ge=0.0)
    finite_grid_phase_variation_bound: float = Field(ge=0.0)
    finite_grid_aliasing_variation_lower_bound: float = Field(ge=0.0)
    finite_grid_mass_error_lower_bound: float = Field(ge=0.0)
    finite_grid_reporting_tolerance: float = Field(gt=0.0)
    finite_grid_mass_status: Literal[
        "no_error_above_tolerance_proven",
        "phase_dependent_quadrature_error",
        "time_invariant_quadrature_error",
        "quadrature_error_at_reported_time",
    ]


class SuperpositionCurrentPayload(BaseModel):
    """Probability-flow streamlines of a superposition at one instant.

    For a non-stationary state, ``continuity_residual`` is the full statement
    ``d(rho)/dt + div j = 0``, normalized by a time-independent root-sum-square
    transition-coherence reference and audited at four phases of every
    distinct energy gap. A stationary non-zero flow instead uses
    ``max|j| / L_d``; a spatial
    state proved real up to global phase reports analytic zero with no probes
    or phase samples. ``density_rate_scale`` remains the instantaneous value
    for transparency, but is never the non-stationary denominator.
    """

    metadata: SuperpositionMetadata
    lines: list[list[list[float]]]
    speed: list[list[float]]
    seed_count: int = Field(ge=0)
    max_speed: float = Field(ge=0.0)
    arc_step_bohr: float = Field(gt=0.0)
    seed_density_floor: float = Field(ge=0.0)
    extent_bohr: float = Field(gt=0.0)
    continuity_residual: float = Field(ge=0.0)
    continuity_absolute_residual: float = Field(ge=0.0)
    continuity_scale: float = Field(ge=0.0)
    continuity_scale_kind: Literal[
        "transition_coherence", "stationary_current", "analytic_zero_current"
    ]
    continuity_probe_count: int = Field(ge=0)
    continuity_phase_count: int = Field(ge=0)
    density_rate_scale: float = Field(ge=0.0)
    integration_rule: str = "rk4_arc_length"


class _SlicePayloadBase(BaseModel):
    """Fields and cross-field rules shared by both slice payloads.

    The sample grid is stated, not implied: ``origin_bohr`` with the
    ``(u, v, n)`` frame and ``spacing_bohr`` let a client reconstruct the
    position of sample ``k = row * resolution + col`` without knowing which
    plane convention the server used.

    ``valid_mask`` marks samples whose amplitude is too small for the phase to
    be resolved. It is a low-amplitude, phase-undefined region and never a node
    certificate: a masked sample is not proof of a node, and an unmasked one is
    not proof that there is none. Masked entries carry the finite
    ``masked_value_sentinel`` so that a client which ignores the mask renders a
    definite placeholder rather than cancellation residue, and so that the
    payload survives a strict JSON parser.
    """

    plane: PrincipalPlane
    slice_observable: SliceObservable
    origin_bohr: list[float]
    u_axis: list[float]
    v_axis: list[float]
    normal: list[float]
    extent_bohr: float = Field(gt=0.0)
    spacing_bohr: float = Field(gt=0.0)
    resolution: int = Field(ge=65, le=513)
    layout: SliceLayout = "row_major_v_rows_u_columns"
    length_unit: str = LENGTH_UNIT
    value_unit: str
    values: list[float]
    valid_mask: list[bool] | None = None
    masked_value_sentinel: float = 0.0
    phase_mask_relative_amplitude: float | None = None
    phase_mask_amplitude_scale: float | None = None
    phase_mask_amplitude_threshold: float | None = None
    phase_mask_numeric_floor: float | None = None
    max_amplitude_on_plane: float = Field(ge=0.0)
    phase_masked_fraction: float | None = Field(default=None, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_slice_consistency(self) -> Self:
        expected = self.resolution * self.resolution
        if len(self.values) != expected:
            raise ValueError(
                f"values must hold resolution**2 = {expected} samples, got {len(self.values)}"
            )
        for name, vector in (
            ("origin_bohr", self.origin_bohr),
            ("u_axis", self.u_axis),
            ("v_axis", self.v_axis),
            ("normal", self.normal),
        ):
            if len(vector) != 3:
                raise ValueError(f"{name} must have three components, got {len(vector)}")
            if not all(isfinite(value) for value in vector):
                raise ValueError(f"{name} must have only finite components")

        unit = SLICE_VALUE_UNITS[self.slice_observable]
        if self.value_unit != unit:
            raise ValueError(
                f"value_unit must be {unit!r} for {self.slice_observable.value}, "
                f"got {self.value_unit!r}"
            )

        # Starlette's pinned JSONResponse rejects NaN and Infinity while
        # serialising. Reject them here first so the API reports a broken
        # scientific payload at its source instead of turning it into an
        # unattributable response-rendering failure. This also keeps the
        # contract safe if a future response class is more permissive.
        if not all(isfinite(value) for value in self.values):
            raise ValueError("values must all be finite: JSON has no NaN or Infinity")
        if not isfinite(self.extent_bohr):
            raise ValueError("extent_bohr must be finite")
        if not isfinite(self.spacing_bohr):
            raise ValueError("spacing_bohr must be finite")
        if not isfinite(self.masked_value_sentinel):
            raise ValueError("masked_value_sentinel must be finite")
        if not isfinite(self.max_amplitude_on_plane):
            raise ValueError("max_amplitude_on_plane must be finite")

        mask_report = {
            "phase_mask_relative_amplitude": self.phase_mask_relative_amplitude,
            "phase_mask_amplitude_scale": self.phase_mask_amplitude_scale,
            "phase_mask_amplitude_threshold": self.phase_mask_amplitude_threshold,
            "phase_mask_numeric_floor": self.phase_mask_numeric_floor,
            "phase_masked_fraction": self.phase_masked_fraction,
        }
        if self.slice_observable is SliceObservable.PHASE:
            if self.valid_mask is None:
                raise ValueError(
                    "a phase slice requires valid_mask: the phase is undefined wherever the "
                    "amplitude is not resolved"
                )
            missing = sorted(name for name, value in mask_report.items() if value is None)
            if missing:
                raise ValueError(
                    f"a phase slice must report its mask thresholds; missing {missing}"
                )
        else:
            if self.valid_mask is not None:
                raise ValueError("valid_mask is defined only for the phase observable")
            reported = sorted(name for name, value in mask_report.items() if value is not None)
            if reported:
                raise ValueError(
                    f"phase mask fields are defined only for the phase observable; got {reported}"
                )
        for name, value in mask_report.items():
            if value is not None and not isfinite(value):
                raise ValueError(f"{name} must be finite")

        if self.valid_mask is not None:
            if len(self.valid_mask) != expected:
                raise ValueError(
                    f"valid_mask must hold resolution**2 = {expected} entries, "
                    f"got {len(self.valid_mask)}"
                )
            for index, (valid, value) in enumerate(zip(self.valid_mask, self.values, strict=True)):
                if not valid and value != self.masked_value_sentinel:
                    raise ValueError(
                        "masked values must equal masked_value_sentinel exactly; "
                        f"index {index} holds {value!r}"
                    )
        return self


class SlicePayload(_SlicePayloadBase):
    """A plane section of one eigenstate's scalar field."""

    metadata: OrbitalMetadata


class SuperpositionSlicePayload(_SlicePayloadBase):
    """A plane section of a superposition's scalar field at one instant.

    Separate from :class:`SlicePayload` for the same reason the isosurface pair
    is separate: a superposition has no single ``(n, l, m)``, so its metadata is
    a different type, and only the metadata differs.
    """

    metadata: SuperpositionMetadata
