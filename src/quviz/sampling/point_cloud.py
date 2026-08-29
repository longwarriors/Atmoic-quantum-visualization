"""Independent point-cloud sampling for individual hydrogenic orbitals.

The sampler exploits exact radial/angular factorization instead of proposing
uniform points in a large three-dimensional box. A tiny, reported radial tail
is truncated only after the adaptive grid captures the requested probability.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from math import pi

import numpy as np
from numpy.typing import NDArray

from quviz.conventions import BasisKind
from quviz.errors import ScientificComputationError
from quviz.physics.hydrogenic import (
    complex_spherical_harmonic,
    hydrogenic_wavefunction,
    radial_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.observables import phase
from quviz.sampling.inverse_cdf import inverse_transform_sample, normalized_cdf

FloatArray = NDArray[np.float64]
Float32Array = NDArray[np.float32]

_RADIAL_MASS_CONVERGENCE = 2e-6
_RADIAL_MOMENT_CONVERGENCE = 2e-6
_RADIAL_CDF_CONVERGENCE = 1e-5
_MAXIMUM_RADIAL_TABLE_SIZE = 131_073
_ANGULAR_MASS_CONVERGENCE = 2e-7
_ANGULAR_CDF_CONVERGENCE = 1e-7
_MAXIMUM_ANGULAR_TABLE_SIZE = 131_073
_FLOAT32_SMALLEST_SUBNORMAL = float(np.nextafter(np.float32(0.0), np.float32(1.0)))


@dataclass(frozen=True, slots=True)
class OrbitalPointCloud:
    """GPU-ready samples and their physical metadata."""

    positions: Float32Array
    intensity: Float32Array
    phase: Float32Array
    radial_mass_captured: float
    extent_bohr: float


@lru_cache(maxsize=128)
def _radial_table(
    n: int,
    l: int,
    z: float,
    a_mu: float,
    grid_size: int,
    target_mass: float,
) -> tuple[FloatArray, FloatArray, float]:
    if grid_size < 8:
        raise ValueError("radial_grid_size must be at least 8")
    if grid_size > _MAXIMUM_RADIAL_TABLE_SIZE:
        raise ValueError(f"radial_grid_size must be at most {_MAXIMUM_RADIAL_TABLE_SIZE}")
    if not 0.0 < target_mass < 1.0:
        raise ValueError("target_radial_mass must lie strictly between 0 and 1")

    r_max = max(12.0 * n * n * a_mu / z, 20.0 * a_mu / z)
    mass = 0.0
    point_count = grid_size
    for _expansion in range(8):
        for _refinement in range(16):
            grid = np.linspace(0.0, r_max, point_count, dtype=np.float64)
            radial = radial_wavefunction(n, l, grid, z=z, a_mu=a_mu)
            radial_density = grid * grid * radial * radial
            cdf, mass = normalized_cdf(grid, radial_density)

            # Every other node is an embedded lower-resolution rule. Comparing
            # the two catches the dangerous case where a coarse oscillatory
            # table overshoots one, gets clipped, and masquerades as complete.
            coarse_indices = np.arange(0, point_count, 2, dtype=np.intp)
            if coarse_indices[-1] != point_count - 1:
                coarse_indices = np.append(coarse_indices, point_count - 1)
            coarse_grid = grid[coarse_indices]
            coarse_density = radial_density[coarse_indices]
            coarse_cdf, coarse_mass = normalized_cdf(coarse_grid, coarse_density)
            radial_mean = float(np.trapezoid(grid * radial_density, grid) / mass)
            coarse_mean = float(
                np.trapezoid(coarse_grid * coarse_density, coarse_grid) / coarse_mass
            )
            converged = (
                abs(mass - coarse_mass) <= _RADIAL_MASS_CONVERGENCE
                and abs(radial_mean - coarse_mean) / max(1.0, abs(radial_mean))
                <= _RADIAL_MOMENT_CONVERGENCE
                and float(np.max(np.abs(cdf[coarse_indices] - coarse_cdf)))
                <= _RADIAL_CDF_CONVERGENCE
            )
            if converged:
                break
            if point_count >= _MAXIMUM_RADIAL_TABLE_SIZE:
                raise ScientificComputationError(
                    "radial table did not converge before the point budget was exhausted"
                )
            point_count = min(_MAXIMUM_RADIAL_TABLE_SIZE, 2 * point_count - 1)
        else:  # pragma: no cover - the explicit point-budget error normally wins first
            raise ScientificComputationError(
                "radial table did not converge within the refinement budget"
            )

        if mass >= target_mass:
            if mass > 1.0 + _RADIAL_MASS_CONVERGENCE:
                raise ScientificComputationError(
                    f"converged radial quadrature mass is unphysical ({mass:.9f} > 1)"
                )
            grid.setflags(write=False)
            cdf.setflags(write=False)
            return grid, cdf, min(mass, 1.0)

        # Preserve the converged grid spacing when extending the tail. Keeping
        # the same number of points here used to make every expansion coarser.
        expanded_r_max = r_max * 1.7
        point_count = int(np.ceil((point_count - 1) * expanded_r_max / r_max)) + 1
        if point_count > _MAXIMUM_RADIAL_TABLE_SIZE:
            raise ScientificComputationError("radial tail expansion exceeded the point budget")
        r_max = expanded_r_max
    raise ScientificComputationError(
        f"radial grid captured only {mass:.8f}; increase grid resolution or expansion budget"
    )


@lru_cache(maxsize=128)
def _cos_theta_table(l: int, m_abs: int, grid_size: int) -> tuple[FloatArray, FloatArray]:
    """Return a converged inverse-CDF table for ``cos(theta)``."""

    if grid_size < 8:
        raise ValueError("angular_grid_size must be at least 8")
    if grid_size > _MAXIMUM_ANGULAR_TABLE_SIZE:
        raise ValueError(f"angular_grid_size must be at most {_MAXIMUM_ANGULAR_TABLE_SIZE}")

    point_count = grid_size
    while True:
        x = np.linspace(-1.0, 1.0, point_count, dtype=np.float64)
        theta = np.arccos(np.clip(x, -1.0, 1.0))
        angular = complex_spherical_harmonic(l, m_abs, theta, np.zeros_like(theta))
        density = np.asarray(np.abs(angular) ** 2, dtype=np.float64)
        cdf, mass = normalized_cdf(x, density)

        coarse_indices = np.arange(0, point_count, 2, dtype=np.intp)
        if coarse_indices[-1] != point_count - 1:
            coarse_indices = np.append(coarse_indices, point_count - 1)
        coarse_x = x[coarse_indices]
        coarse_cdf, coarse_mass = normalized_cdf(coarse_x, density[coarse_indices])
        mass_error = abs(mass - coarse_mass) / max(abs(mass), abs(coarse_mass))
        cdf_error = float(np.max(np.abs(cdf[coarse_indices] - coarse_cdf)))
        if mass_error <= _ANGULAR_MASS_CONVERGENCE and cdf_error <= _ANGULAR_CDF_CONVERGENCE:
            x.setflags(write=False)
            cdf.setflags(write=False)
            return x, cdf
        if point_count >= _MAXIMUM_ANGULAR_TABLE_SIZE:
            raise ScientificComputationError(
                "angular cos(theta) table did not converge before the point budget was exhausted"
            )
        point_count = min(_MAXIMUM_ANGULAR_TABLE_SIZE, 2 * point_count - 1)


def _sample_real_phi(rng: np.random.Generator, m: int, count: int) -> FloatArray:
    if m == 0:
        return np.asarray(rng.uniform(0.0, 2.0 * pi, count), dtype=np.float64)
    accepted: list[FloatArray] = []
    remaining = count
    m_abs = abs(m)
    while remaining:
        batch_size = max(remaining * 3, 128)
        candidates = rng.uniform(0.0, 2.0 * pi, batch_size)
        weight = np.cos(m_abs * candidates) ** 2 if m > 0 else np.sin(m_abs * candidates) ** 2
        batch = candidates[rng.random(batch_size) < weight]
        if batch.size:
            accepted.append(np.asarray(batch[:remaining], dtype=np.float64))
            remaining -= min(remaining, int(batch.size))
    return np.concatenate(accepted)


def sample_orbital_point_cloud(
    n: int,
    l: int,
    m: int,
    *,
    count: int = 20_000,
    seed: int = 7,
    z: float = 1.0,
    a_mu: float = 1.0,
    basis: BasisKind | str = BasisKind.REAL,
    radial_grid_size: int = 32_768,
    angular_grid_size: int = 16_384,
    target_radial_mass: float = 0.999_999,
) -> OrbitalPointCloud:
    """Draw independent Cartesian samples from ``|psi|² d³r``."""

    validate_quantum_numbers(n, l, m)
    if count < 100 or count > 200_000:
        raise ValueError("count must be between 100 and 200000")
    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if a_mu <= 0.0 or not np.isfinite(a_mu):
        raise ValueError("a_mu must be positive and finite")
    # QVPC positions are deliberately float32 for direct GPU upload.  A
    # mathematically valid but extremely diffuse Coulomb scale can exceed that
    # wire format before the radial quadrature even begins; fail explicitly
    # instead of overflowing the grid and escaping the API as a 500 response.
    radial_table_extent = max(12.0 * n * n * a_mu / z, 20.0 * a_mu / z)
    if not np.isfinite(radial_table_extent) or radial_table_extent > float(
        np.finfo(np.float32).max
    ):
        raise ValueError("orbital extent cannot be represented by QVPC float32 positions")
    characteristic_length = a_mu / z
    if characteristic_length < _FLOAT32_SMALLEST_SUBNORMAL:
        raise ValueError("orbital length scale cannot be represented by QVPC float32 positions")
    basis_kind = BasisKind(basis)
    rng = np.random.default_rng(seed)

    r_grid, r_cdf, radial_mass = _radial_table(
        n, l, float(z), float(a_mu), radial_grid_size, target_radial_mass
    )
    radius = inverse_transform_sample(rng, r_grid, r_cdf, count)

    x_grid, theta_cdf = _cos_theta_table(l, abs(m), angular_grid_size)
    cos_theta = inverse_transform_sample(rng, x_grid, theta_cdf, count)
    theta = np.arccos(np.clip(cos_theta, -1.0, 1.0))
    phi = (
        np.asarray(rng.uniform(0.0, 2.0 * pi, count), dtype=np.float64)
        if basis_kind is BasisKind.COMPLEX
        else _sample_real_phi(rng, m, count)
    )

    sin_theta = np.sin(theta)
    x = radius * sin_theta * np.cos(phi)
    y = radius * sin_theta * np.sin(phi)
    z_coord = radius * cos_theta
    positions = np.column_stack((x, y, z_coord))

    psi = hydrogenic_wavefunction(n, l, m, radius, theta, phi, z=z, a_mu=a_mu, basis=basis_kind)
    # Spatial concentration already encodes |psi|². Uniform marker weights avoid
    # applying the density a second time through point size, alpha, or brightness.
    intensity = np.ones(count, dtype=np.float64)

    positions_float32 = np.asarray(positions, dtype=np.float32)
    collapsed = np.any(positions != 0.0, axis=1) & np.all(positions_float32 == 0.0, axis=1)
    if np.any(collapsed):
        raise ValueError(
            "one or more non-zero samples collapse to the origin in QVPC float32 positions"
        )

    return OrbitalPointCloud(
        positions=positions_float32,
        intensity=np.asarray(intensity, dtype=np.float32),
        phase=np.asarray(phase(psi), dtype=np.float32),
        radial_mass_captured=radial_mass,
        extent_bohr=float(np.max(radius)),
    )
