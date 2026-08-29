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


def _validate_vector3_rows(name: str, rows: list[list[float]]) -> None:
    """Reject malformed or non-finite Cartesian vectors at the scene boundary."""

    for index, row in enumerate(rows):
        if len(row) != 3:
            raise ValueError(f"{name}[{index}] must have three components, got {len(row)}")
        if not all(isfinite(value) for value in row):
            raise ValueError(f"{name}[{index}] must have only finite components")


def _validate_indexed_mesh(
    vertices: list[list[float]],
    normals: list[list[float]],
    faces: list[list[int]],
    phase: list[float],
) -> None:
    """Validate the structural invariants an indexed GPU mesh relies on."""

    if not vertices:
        raise ValueError("vertices must not be empty")
    if not faces:
        raise ValueError("faces must not be empty")
    _validate_vector3_rows("vertices", vertices)
    _validate_vector3_rows("normals", normals)
    if len(normals) != len(vertices):
        raise ValueError(
            f"normals must have one row per vertex, got {len(normals)} for {len(vertices)} vertices"
        )
    if len(phase) != len(vertices):
        raise ValueError(
            f"phase must have one value per vertex, got {len(phase)} for {len(vertices)} vertices"
        )
    if not all(isfinite(value) for value in phase):
        raise ValueError("phase must contain only finite values")

    vertex_count = len(vertices)
    for index, face in enumerate(faces):
        if len(face) != 3:
            raise ValueError(f"faces[{index}] must have three vertex indices, got {len(face)}")
        if any(vertex < 0 or vertex >= vertex_count for vertex in face):
            raise ValueError(f"faces[{index}] contains an index outside [0, {vertex_count - 1}]")


def _validate_streamline_geometry(
    lines: list[list[list[float]]],
    speed: list[list[float]],
    seed_count: int,
    max_speed: float,
) -> None:
    """Validate the parallel arrays consumed by the streamline renderer."""

    if len(lines) != seed_count:
        raise ValueError(
            f"seed_count must equal the number of returned lines, got {seed_count} and {len(lines)}"
        )
    if len(speed) != len(lines):
        raise ValueError(
            f"speed must have one row per line, got {len(speed)} for {len(lines)} lines"
        )

    observed_max = 0.0
    for index, (line, line_speed) in enumerate(zip(lines, speed, strict=True)):
        if len(line) < 2:
            raise ValueError(f"lines[{index}] must contain at least two vertices")
        _validate_vector3_rows(f"lines[{index}]", line)
        if len(line_speed) != len(line):
            raise ValueError(
                f"speed[{index}] must have one value per line vertex, "
                f"got {len(line_speed)} for {len(line)} vertices"
            )
        if not all(isfinite(value) and value >= 0.0 for value in line_speed):
            raise ValueError(f"speed[{index}] must contain only finite, non-negative values")
        observed_max = max(observed_max, max(line_speed, default=0.0))

    if not isfinite(max_speed):
        raise ValueError("max_speed must be finite")
    if max_speed != observed_max:
        raise ValueError(
            f"max_speed must equal the maximum speed value, got {max_speed} and {observed_max}"
        )


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

    @model_validator(mode="after")
    def validate_mesh_consistency(self) -> Self:
        if self.metadata.observable is not ObservableKind.PROBABILITY_DENSITY:
            raise ValueError("isosurface metadata observable must be probability_density")
        if self.metadata.representation is not RepresentationKind.ISOSURFACE:
            raise ValueError("isosurface metadata representation must be isosurface")
        _validate_indexed_mesh(self.vertices, self.normals, self.faces, self.phase)
        for name in (
            "density_level",
            "requested_probability_mass",
            "captured_probability_mass",
            "finite_grid_density_integral",
            "grid_spacing_bohr",
            "extent_bohr",
        ):
            if not isfinite(getattr(self, name)):
                raise ValueError(f"{name} must be finite")
        return self


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

    @model_validator(mode="after")
    def validate_streamline_consistency(self) -> Self:
        if self.metadata.observable is not ObservableKind.PROBABILITY_CURRENT:
            raise ValueError("streamline metadata observable must be probability_current")
        if self.metadata.representation is not RepresentationKind.STREAMLINES:
            raise ValueError("streamline metadata representation must be streamlines")
        _validate_streamline_geometry(self.lines, self.speed, self.seed_count, self.max_speed)
        for name in (
            "arc_step_bohr",
            "seed_density_floor",
            "extent_bohr",
            "continuity_residual",
            "continuity_absolute_residual",
            "continuity_scale",
        ):
            if not isfinite(getattr(self, name)):
                raise ValueError(f"{name} must be finite")
        return self


class SuperpositionTermSpec(BaseModel):
    """One eigenstate and its complex amplitude, JSON-serialisable."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    n: int = Field(ge=1, le=12)
    l: int = Field(ge=0, le=11)
    m: int = Field(ge=-11, le=11)
    coefficient_real: float
    coefficient_imag: float = 0.0

    @model_validator(mode="after")
    def validate_term(self) -> Self:
        if self.l >= self.n:
            raise ValueError("l must satisfy 0 <= l < n")
        if abs(self.m) > self.l:
            raise ValueError("m must satisfy |m| <= l")
        if not isfinite(self.coefficient_real) or not isfinite(self.coefficient_imag):
            raise ValueError("superposition coefficients must be finite")
        return self


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

    @model_validator(mode="after")
    def validate_physical_identity(self) -> Self:
        if not self.terms:
            raise ValueError("a superposition must contain at least one term")
        for name in (
            "z",
            "a_mu",
            "reduced_mass_ratio",
            "time_au",
            "energy_expectation_hartree",
        ):
            if not isfinite(getattr(self, name)):
                raise ValueError(f"{name} must be finite")
        reciprocal_error = abs(self.a_mu * self.reduced_mass_ratio - 1.0)
        if reciprocal_error > 1e-12:
            raise ValueError("a_mu and reduced_mass_ratio must be reciprocal")
        return self


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

    @model_validator(mode="after")
    def validate_mesh_consistency(self) -> Self:
        if self.metadata.observable is not ObservableKind.PROBABILITY_DENSITY:
            raise ValueError("isosurface metadata observable must be probability_density")
        if self.metadata.representation is not RepresentationKind.ISOSURFACE:
            raise ValueError("isosurface metadata representation must be isosurface")
        _validate_indexed_mesh(self.vertices, self.normals, self.faces, self.phase)
        for name in (
            "density_level",
            "requested_probability_mass",
            "captured_probability_mass",
            "finite_grid_density_integral",
            "grid_spacing_bohr",
            "extent_bohr",
            "finite_box_tail_mass_upper_bound",
            "finite_box_mass_variation_upper_bound",
            "finite_grid_phase_variation_bound",
            "finite_grid_aliasing_variation_lower_bound",
            "finite_grid_mass_error_lower_bound",
            "finite_grid_reporting_tolerance",
        ):
            if not isfinite(getattr(self, name)):
                raise ValueError(f"{name} must be finite")
        return self


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

    @model_validator(mode="after")
    def validate_streamline_consistency(self) -> Self:
        if self.metadata.observable is not ObservableKind.PROBABILITY_CURRENT:
            raise ValueError("streamline metadata observable must be probability_current")
        if self.metadata.representation is not RepresentationKind.STREAMLINES:
            raise ValueError("streamline metadata representation must be streamlines")
        _validate_streamline_geometry(self.lines, self.speed, self.seed_count, self.max_speed)
        for name in (
            "arc_step_bohr",
            "seed_density_floor",
            "extent_bohr",
            "continuity_residual",
            "continuity_absolute_residual",
            "continuity_scale",
            "density_rate_scale",
        ):
            if not isfinite(getattr(self, name)):
                raise ValueError(f"{name} must be finite")
        return self


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
