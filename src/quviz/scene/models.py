"""Typed contracts shared conceptually by Python and TypeScript."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from quviz.conventions import LENGTH_UNIT, BasisKind, ObservableKind, RepresentationKind


class QuantumStateSpec(BaseModel):
    """A reproducible hydrogenic state specification."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    n: int = Field(ge=1, le=12)
    l: int = Field(ge=0, le=11)
    m: int = Field(ge=-11, le=11)
    z: float = Field(default=1.0, gt=0.0, le=20.0)
    basis: BasisKind = BasisKind.REAL

    @model_validator(mode="after")
    def validate_quantum_number_relationships(self) -> QuantumStateSpec:
        if self.l >= self.n:
            raise ValueError("l must satisfy 0 <= l < n")
        if abs(self.m) > self.l:
            raise ValueError("m must satisfy |m| <= l")
        return self


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


class SuperpositionCurrentPayload(BaseModel):
    """Probability-flow streamlines of a superposition at one instant.

    ``continuity_residual`` is the full time-dependent statement
    ``d(rho)/dt + div j = 0``, normalized by ``density_rate_scale``. Unlike the
    stationary case, ``d(rho)/dt`` is generally non-zero, so a scale of zero
    means the state is degenerate and the check is vacuous rather than passed.
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
    density_rate_scale: float = Field(ge=0.0)
    integration_rule: str = "rk4_arc_length"
