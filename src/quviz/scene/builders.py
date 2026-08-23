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
    radial_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.observables import phase, probability_density
from quviz.sampling.inverse_cdf import normalized_cdf
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
    geometry_semantics = (
        "independent samples from |psi|^2 dV; marker weight is uniform"
        if representation is RepresentationKind.POINT_CLOUD
        else "level set of probability density |psi|^2"
    )
    color_semantics = (
        "wavefunction sign encoded as phase 0 or pi"
        if basis_kind is BasisKind.REAL
        else "principal wavefunction phase in [-pi, pi]"
    )
    return OrbitalMetadata(
        state=QuantumStateSpec(n=n, l=l, m=m, z=z, basis=basis_kind),
        label=orbital_label(n, l, m, basis=basis_kind),
        energy_hartree=hydrogenic_energy_hartree(n, z=z),
        observable=observable,
        representation=representation,
        coordinate_convention=ANGLE_CONVENTION,
        spherical_harmonic_convention=SPHERICAL_HARMONIC_CONVENTION,
        geometry_semantics=geometry_semantics,
        color_semantics=color_semantics,
        references=[
            "dlmf-spherical-harmonics",
            "dlmf-laguerre",
            "scipy-sph-harm-y",
            "solara-hydrogen-derivation",
        ],
        warnings=warnings or [],
    )


def _radial_extent_for_mass(
    n: int,
    l: int,
    z: float,
    *,
    target_mass: float = 0.9999,
    grid_size: int = 32_769,
) -> float:
    """Return a padded radial quantile for an efficient finite cube."""

    r_max = max(8.0 * n * n / z, 12.0 / z)
    captured = 0.0
    for _ in range(8):
        radius = np.linspace(0.0, r_max, grid_size, dtype=np.float64)
        radial = radial_wavefunction(n, l, radius, z=z)
        radial_density = radius * radius * radial * radial
        cdf, captured = normalized_cdf(radius, radial_density)
        if captured >= target_mass:
            absolute_cdf = cdf * captured
            quantile = float(np.interp(target_mass, absolute_cdf, radius))
            return max(1.05 * quantile, 4.0 / z)
        r_max *= 1.7
    raise RuntimeError(
        f"radial extent search captured only {captured:.8f}; increase expansion budget"
    )


def _simpson_weights_3d(resolution: int, spacing: float) -> np.ndarray:
    """Return tensor-product Simpson weights for an odd uniform cubic grid."""

    axis_weights = np.ones(resolution, dtype=np.float64)
    axis_weights[1:-1:2] = 4.0
    axis_weights[2:-1:2] = 2.0
    axis_weights *= spacing / 3.0
    return axis_weights[:, None, None] * axis_weights[None, :, None] * axis_weights[None, None, :]


def _density_threshold_for_mass(
    density: np.ndarray, integration_weights: np.ndarray, mass: float
) -> tuple[float, float, float]:
    """Find a superlevel-set threshold for an absolute probability mass.

    Hydrogenic states are analytically normalized. Therefore ``mass=0.90`` means
    90% of the full-space probability, not 90% of whatever fraction happens to
    lie in the finite numerical cube.
    """

    flat = np.asarray(density, dtype=np.float64).ravel()
    weights = np.asarray(integration_weights, dtype=np.float64).ravel()
    if flat.shape != weights.shape:
        raise ValueError("density and integration weights must have the same shape")
    order = np.argsort(flat)[::-1]
    sorted_density = flat[order]
    cumulative = np.cumsum(sorted_density * weights[order])
    total = float(np.sum(flat * weights))
    if total <= 0.0 or not np.isfinite(total):
        raise ValueError("density grid has no finite probability mass")
    if total < mass:
        raise ValueError(f"finite grid captures only {total:.6f}, below requested mass {mass:.6f}")
    index = int(np.searchsorted(cumulative, mass, side="left"))
    index = min(index, sorted_density.size - 1)
    level = float(sorted_density[index])
    captured = float(np.sum(flat[flat >= level] * weights[flat >= level]))
    return level, captured, total


def build_isosurface(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    basis: BasisKind | str = BasisKind.REAL,
    resolution: int = 65,
    probability_mass: float = 0.90,
) -> IsosurfacePayload:
    """Build a density isosurface whose superlevel set encloses a target mass.

    The returned surface is a representation of ``|psi|² = constant``. Vertex
    phase is evaluated separately so that complex phase or real sign can be
    shown without pretending that density itself is signed.
    """

    validate_quantum_numbers(n, l, m)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if n > 4:
        raise ValueError("isosurface generation is validated only for n <= 4")
    minimum_resolution = max(49, 16 * n + 17)
    if resolution < minimum_resolution or resolution > 81:
        raise ValueError(f"resolution must be between {minimum_resolution} and 81 for n={n}")
    if resolution % 2 == 0:
        raise ValueError("resolution must be odd so Cartesian nodal planes lie on the grid")
    if not 0.50 <= probability_mass <= 0.99:
        raise ValueError("probability_mass must be between 0.50 and 0.99")
    basis_kind = BasisKind(basis)

    extent = _radial_extent_for_mass(n, l, z)
    axis = np.linspace(-extent, extent, resolution, dtype=np.float64)
    spacing = float(axis[1] - axis[0])
    x, y, z_coord = np.meshgrid(axis, axis, axis, indexing="ij")
    radius, theta, phi = cartesian_to_spherical(x, y, z_coord)
    psi = hydrogenic_wavefunction(n, l, m, radius, theta, phi, z=z, basis=basis_kind)
    density = probability_density(psi)
    integration_weights = _simpson_weights_3d(resolution, spacing)
    level, captured, integrated_mass = _density_threshold_for_mass(
        density, integration_weights, probability_mass
    )
    if not float(np.min(density)) < level < float(np.max(density)):
        raise RuntimeError("computed isosurface level is outside the density range")

    vertices, faces, normals, _ = marching_cubes(  # type: ignore[no-untyped-call]
        density.astype(np.float32),
        level=level,
        spacing=(spacing, spacing, spacing),
        allow_degenerate=False,
    )
    vertices += np.asarray([axis[0], axis[0], axis[0]], dtype=np.float32)
    face_normals = np.cross(
        vertices[faces[:, 1]] - vertices[faces[:, 0]],
        vertices[faces[:, 2]] - vertices[faces[:, 0]],
    )
    mean_vertex_normals = np.mean(normals[faces], axis=1)
    if float(np.mean(np.einsum("ij,ij->i", face_normals, mean_vertex_normals))) < 0.0:
        faces = faces[:, [0, 2, 1]]
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

    warnings: list[str] = []
    if abs(integrated_mass - 1.0) > 0.002:
        warnings.append(
            f"finite-grid density integral is {integrated_mass:.6f}; increase resolution"
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
        finite_grid_density_integral=integrated_mass,
        grid_resolution=resolution,
        grid_spacing_bohr=spacing,
        extent_bohr=extent,
    )
