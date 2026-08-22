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
from quviz.physics.hydrogenic import (
    complex_spherical_harmonic,
    hydrogenic_wavefunction,
    radial_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.observables import phase, probability_density
from quviz.sampling.inverse_cdf import inverse_transform_sample, normalized_cdf

FloatArray = NDArray[np.float64]
Float32Array = NDArray[np.float32]


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
    r_max = max(12.0 * n * n * a_mu / z, 20.0 * a_mu / z)
    mass = 0.0
    for _ in range(8):
        grid = np.linspace(0.0, r_max, grid_size, dtype=np.float64)
        radial = radial_wavefunction(n, l, grid, z=z, a_mu=a_mu)
        radial_density = grid * grid * radial * radial
        cdf, mass = normalized_cdf(grid, radial_density)
        if mass >= target_mass:
            grid.setflags(write=False)
            cdf.setflags(write=False)
            return grid, cdf, min(mass, 1.0)
        r_max *= 1.7
    raise RuntimeError(
        f"radial grid captured only {mass:.8f}; increase grid resolution or expansion budget"
    )


@lru_cache(maxsize=128)
def _cos_theta_table(l: int, m_abs: int, grid_size: int) -> tuple[FloatArray, FloatArray]:
    x = np.linspace(-1.0, 1.0, grid_size, dtype=np.float64)
    theta = np.arccos(np.clip(x, -1.0, 1.0))
    angular = complex_spherical_harmonic(l, m_abs, theta, np.zeros_like(theta))
    density = np.abs(angular) ** 2
    cdf, _ = normalized_cdf(x, np.asarray(density, dtype=np.float64))
    x.setflags(write=False)
    cdf.setflags(write=False)
    return x, cdf


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

    psi = hydrogenic_wavefunction(
        n, l, m, radius, theta, phi, z=z, a_mu=a_mu, basis=basis_kind
    )
    density = probability_density(psi)
    max_density = float(np.max(density))
    scaled = density / max_density if max_density > 0.0 else density
    intensity = np.log1p(99.0 * scaled) / np.log(100.0)

    return OrbitalPointCloud(
        positions=np.asarray(positions, dtype=np.float32),
        intensity=np.asarray(intensity, dtype=np.float32),
        phase=np.asarray(phase(psi), dtype=np.float32),
        radial_mass_captured=radial_mass,
        extent_bohr=float(np.max(radius)),
    )
