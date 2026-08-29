from __future__ import annotations

import numpy as np
import pytest

from quviz.conventions import BasisKind
from quviz.sampling.point_cloud import (
    _cos_theta_table,
    _radial_table,
    sample_orbital_point_cloud,
)


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


def test_point_cloud_float32_extent_boundary_fails_before_cast_overflow() -> None:
    minimum_representable_z = 20.0 / float(np.finfo(np.float32).max)
    accepted = sample_orbital_point_cloud(
        1,
        0,
        0,
        z=minimum_representable_z,
        count=1_000,
        radial_grid_size=128,
        angular_grid_size=128,
    )

    assert np.all(np.isfinite(accepted.positions))
    with pytest.raises(ValueError, match="QVPC float32 positions"):
        sample_orbital_point_cloud(
            1,
            0,
            0,
            z=float(np.nextafter(minimum_representable_z, 0.0)),
            count=1_000,
            radial_grid_size=128,
            angular_grid_size=128,
        )


def test_point_cloud_rejects_a_nonzero_scale_that_collapses_in_float32() -> None:
    with pytest.raises(ValueError, match=r"length scale.*QVPC float32 positions"):
        sample_orbital_point_cloud(
            1,
            0,
            0,
            a_mu=1e-46,
            count=1_000,
            radial_grid_size=128,
            angular_grid_size=128,
        )


def test_cos_theta_table_refines_until_the_analytic_pz_cdf_is_resolved() -> None:
    _cos_theta_table.cache_clear()
    x, cdf = _cos_theta_table(1, 0, 8)

    # |Y_1^0|^2 is proportional to x^2 for x=cos(theta), hence its exact
    # normalized CDF on [-1, 1] is (x^3 + 1) / 2.
    expected = (x**3 + 1.0) / 2.0
    assert x.size > 8
    assert float(np.max(np.abs(cdf - expected))) <= 5e-8


def test_cos_theta_table_refuses_unbounded_or_degenerate_requests() -> None:
    with pytest.raises(ValueError, match="at least 8"):
        _cos_theta_table(1, 0, 7)
    with pytest.raises(ValueError, match="at most"):
        _cos_theta_table(1, 0, 131_074)


def test_radial_table_refuses_unbounded_or_degenerate_requests() -> None:
    with pytest.raises(ValueError, match="at least 8"):
        _radial_table(1, 0, 1.0, 1.0, 7, 0.999_999)

    _radial_table.cache_clear()
    grid, cdf, captured = _radial_table(1, 0, 1.0, 1.0, 131_073, 0.999_999)
    assert grid.size == 131_073
    assert cdf.size == grid.size
    assert captured >= 0.999_999

    with pytest.raises(ValueError, match="at most 131073"):
        _radial_table(1, 0, 1.0, 1.0, 131_074, 0.999_999)


def test_cos_theta_table_converges_for_the_highest_public_angular_momentum() -> None:
    _cos_theta_table.cache_clear()
    x, cdf = _cos_theta_table(11, 0, 8)

    assert 8 < x.size <= 131_073
    assert cdf[0] == 0.0
    assert cdf[-1] == 1.0
    assert np.all(np.diff(cdf) >= 0.0)


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


@pytest.mark.parametrize(
    ("n", "exact_mean"),
    [
        (4, 24.0),
        (12, 216.0),
    ],
)
def test_coarse_radial_request_refines_instead_of_silently_biasing_samples(
    n: int, exact_mean: float
) -> None:
    _radial_table.cache_clear()
    cloud = sample_orbital_point_cloud(
        n,
        0,
        0,
        count=20_000,
        seed=1,
        radial_grid_size=8,
        angular_grid_size=1_024,
    )
    radius = np.linalg.norm(cloud.positions.astype(np.float64), axis=1)

    assert float(np.mean(radius)) == pytest.approx(exact_mean, rel=0.015)
    assert 0.999_999 <= cloud.radial_mass_captured <= 1.0
    refined_grid, _, _ = _radial_table(n, 0, 1.0, 1.0, 8, 0.999_999)
    assert refined_grid.size > 8
