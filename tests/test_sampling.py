from __future__ import annotations

import numpy as np
import pytest

from quviz.conventions import BasisKind
from quviz.sampling.point_cloud import sample_orbital_point_cloud


def test_point_cloud_is_reproducible_and_gpu_ready() -> None:
    kwargs = dict(
        n=2,
        l=1,
        m=0,
        count=1_500,
        seed=123,
        radial_grid_size=8_192,
        angular_grid_size=4_096,
    )
    first = sample_orbital_point_cloud(**kwargs)
    second = sample_orbital_point_cloud(**kwargs)

    assert first.positions.shape == (1_500, 3)
    assert first.positions.dtype == np.float32
    assert first.intensity.shape == (1_500,)
    assert first.phase.shape == (1_500,)
    assert np.array_equal(first.positions, second.positions)
    assert np.all(first.intensity == 1.0)
    assert first.radial_mass_captured > 0.999_99


def test_1s_radial_mean_matches_exact_value() -> None:
    cloud = sample_orbital_point_cloud(
        1,
        0,
        0,
        count=12_000,
        seed=9,
        radial_grid_size=16_384,
        angular_grid_size=4_096,
    )
    radius = np.linalg.norm(cloud.positions.astype(np.float64), axis=1)
    # For hydrogen 1s in Bohr units, E[r] = 3/2.
    assert float(np.mean(radius)) == pytest.approx(1.5, abs=0.035)


def test_real_px_sampling_contains_angular_interference() -> None:
    cloud = sample_orbital_point_cloud(
        2,
        1,
        1,
        basis=BasisKind.REAL,
        count=14_000,
        seed=11,
        radial_grid_size=12_288,
        angular_grid_size=8_192,
    )
    positions = cloud.positions.astype(np.float64)
    mean_x2, mean_y2, mean_z2 = np.mean(positions**2, axis=0)

    # A p_x density has E[x^2] / E[y^2] = 3 in the angular distribution.
    assert mean_x2 / mean_y2 == pytest.approx(3.0, abs=0.18)
    assert mean_y2 / mean_z2 == pytest.approx(1.0, abs=0.08)
