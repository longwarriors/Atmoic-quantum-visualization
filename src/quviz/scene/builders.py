"""Build geometry from physically named observables."""

from __future__ import annotations

from math import pi

import numpy as np
from skimage.measure import marching_cubes

from quviz.conventions import (
    ANGLE_CONVENTION,
    SPHERICAL_HARMONIC_CONVENTION,
    BasisKind,
    ObservableKind,
    RepresentationKind,
)
from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    orbital_label,
    validate_quantum_numbers,
)
from quviz.physics.observables import phase, probability_density
from quviz.scene.models import IsosurfacePayload, OrbitalMetadata, QuantumStateSpec


def orbital_metadata(
    n: int,
    l: int,
    m: int,
    *,
    z: float,
    basis: BasisKind | str,
    observable: ObservableKind,
    representation: RepresentationKind,
    warnings: list[str] | None = None,
) -> OrbitalMetadata:
    """Create metadata from the same inputs used by the numerical calculation."""

    basis_kind = BasisKind(basis)
    validate_quantum_numbers(n, l, m)
    return OrbitalMetadata(
        state=QuantumStateSpec(n=n, l=l, m=m, z=z, basis=basis_kind),
        label=orbital_label(n, l, m, basis=basis_kind),
        energy_hartree=hydrogenic_energy_hartree(n, z=z),
        observable=observable,
        representation=representation,
        coordinate_convention=ANGLE_CONVENTION,
        spherical_harmonic_convention=SPHERICAL_HARMONIC_CONVENTION,
        references=[
            "dlmf-spherical-harmonics",
            "dlmf-laguerre",
            "scipy-sph-harm-y",
            "solara-hydrogen-derivation",
        ],
        warnings=warnings or [],
    )


def _density_threshold_for_mass(
    density: np.ndarray, voxel_volume: float, mass: float
) -> tuple[float, float]:
    """Find a superlevel-set threshold for an absolute probability mass.

    Hydrogenic states are analytically normalized. Therefore ``mass=0.90`` means
    90% of the full-space probability, not 90% of whatever fraction happens to
    lie in the finite numerical cube.
    """

    flat = np.asarray(density, dtype=np.float64).ravel()
    order = np.argsort(flat)[::-1]
    sorted_density = flat[order]
    cumulative = np.cumsum(sorted_density * voxel_volume)
    total = float(cumulative[-1])
    if total <= 0.0 or not np.isfinite(total):
        raise ValueError("density grid has no finite probability mass")
    if total < mass:
        raise ValueError(
            f"finite grid captures only {total:.6f}, below requested mass {mass:.6f}"
        )
    index = int(np.searchsorted(cumulative, mass, side="left"))
    index = min(index, sorted_density.size - 1)
    return float(sorted_density[index]), float(cumulative[index])


def build_isosurface(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    basis: BasisKind | str = BasisKind.REAL,
    resolution: int = 52,
    probability_mass: float = 0.90,
) -> IsosurfacePayload:
    """Build a density isosurface whose superlevel set encloses a target mass.

    The returned surface is a representation of ``|psi|² = constant``. Vertex
    phase is evaluated separately so that complex phase or real sign can be
    shown without pretending that density itself is signed.
    """

    validate_quantum_numbers(n, l, m)
    if resolution < 24 or resolution > 80:
        raise ValueError("resolution must be between 24 and 80")
    if not 0.50 <= probability_mass <= 0.99:
        raise ValueError("probability_mass must be between 0.50 and 0.99")
    basis_kind = BasisKind(basis)

    extent = max(7.5 * n * n / z, 12.0 / z)
    axis = np.linspace(-extent, extent, resolution, dtype=np.float64)
    spacing = float(axis[1] - axis[0])
    x, y, z_coord = np.meshgrid(axis, axis, axis, indexing="ij")
    radius, theta, phi = cartesian_to_spherical(x, y, z_coord)
    psi = hydrogenic_wavefunction(
        n, l, m, radius, theta, phi, z=z, basis=basis_kind
    )
    density = probability_density(psi)
    level, captured = _density_threshold_for_mass(density, spacing**3, probability_mass)
    if not float(np.min(density)) < level < float(np.max(density)):
        raise RuntimeError("computed isosurface level is outside the density range")

    vertices, faces, normals, _ = marching_cubes(
        density.astype(np.float32),
        level=level,
        spacing=(spacing, spacing, spacing),
        allow_degenerate=False,
    )
    vertices += np.asarray([axis[0], axis[0], axis[0]], dtype=np.float32)
    vertex_r, vertex_theta, vertex_phi = cartesian_to_spherical(
        vertices[:, 0], vertices[:, 1], vertices[:, 2]
    )
    vertex_psi = hydrogenic_wavefunction(
        n,
        l,
        m,
        vertex_r,
        vertex_theta,
        vertex_phi,
        z=z,
        basis=basis_kind,
    )

    integrated_mass = float(np.sum(density) * spacing**3)
    warnings: list[str] = []
    if integrated_mass < 0.995:
        warnings.append(
            f"finite cube captures approximately {integrated_mass:.6f} of total probability"
        )
    if basis_kind is BasisKind.COMPLEX and m != 0:
        warnings.append("surface geometry represents density; color carries wavefunction phase")

    metadata = orbital_metadata(
        n,
        l,
        m,
        z=z,
        basis=basis_kind,
        observable=ObservableKind.PROBABILITY_DENSITY,
        representation=RepresentationKind.ISOSURFACE,
        warnings=warnings,
    )
    return IsosurfacePayload(
        metadata=metadata,
        vertices=np.round(vertices, 6).tolist(),
        normals=np.round(normals, 6).tolist(),
        faces=faces.astype(np.int32).tolist(),
        phase=np.round(np.mod(phase(vertex_psi) + pi, 2.0 * pi) - pi, 6).tolist(),
        density_level=level,
        requested_probability_mass=probability_mass,
        captured_probability_mass=captured,
        grid_resolution=resolution,
        extent_bohr=extent,
    )
