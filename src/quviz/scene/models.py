"""Typed contracts shared conceptually by Python and TypeScript."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from quviz.conventions import BasisKind, LENGTH_UNIT, ObservableKind, RepresentationKind


class QuantumStateSpec(BaseModel):
    """A reproducible hydrogenic state specification."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    n: int = Field(ge=1, le=12)
    l: int = Field(ge=0, le=11)
    m: int = Field(ge=-11, le=11)
    z: float = Field(default=1.0, gt=0.0, le=20.0)
    basis: BasisKind = BasisKind.REAL

    @model_validator(mode="after")
    def validate_quantum_number_relationships(self) -> "QuantumStateSpec":
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
    references: list[str]
    warnings: list[str] = Field(default_factory=list)


class IsosurfacePayload(BaseModel):
    """Indexed mesh with per-vertex phase for GPU coloring."""

    metadata: OrbitalMetadata
    vertices: list[list[float]]
    normals: list[list[float]]
    faces: list[list[int]]
    phase: list[float]
    density_level: float
    requested_probability_mass: float
    captured_probability_mass: float
    grid_resolution: int
    extent_bohr: float
