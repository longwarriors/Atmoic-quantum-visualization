"""PR-7 gates for certified high-order radial moments.

The normalization integral is not a tail oracle for ``<r**p>``: multiplying
the same normalized density by a large power moves the important part of the
integrand far into the tail.  These tests therefore require independent
finite-domain and node-refinement evidence, then compare the result with the
closed-form 1s moment rather than with another numerical quadrature.
"""

from __future__ import annotations

from math import factorial

import numpy as np
import pytest

from quviz.errors import ScientificComputationError
from quviz.physics.observables import expectation_radial


def _one_s_moment(power: int, *, z: float = 1.0, a_mu: float = 1.0) -> float:
    r"""Independent oracle: ``<r^p>_1s = (p+2)! (a_mu/Z)^p / 2^(p+1)``."""

    return float(factorial(power + 2) / 2 ** (power + 1) * (a_mu / z) ** power)


@pytest.mark.parametrize(
    ("power", "z", "a_mu"),
    [
        (31, 1.0, 1.0),
        (60, 2.0, 0.5),
        (170, 1.0, 1.0),
    ],
)
def test_high_order_one_s_moment_matches_the_closed_form(power: int, z: float, a_mu: float) -> None:
    expected = _one_s_moment(power, z=z, a_mu=a_mu)
    obtained = expectation_radial(
        1,
        0,
        power,
        z=z,
        a_mu=a_mu,
        quadrature_nodes=512,
    )

    assert np.isfinite(obtained)
    assert obtained == pytest.approx(expected, rel=2e-10)


def test_high_order_circular_state_moment_matches_an_independent_gamma_ratio() -> None:
    # For n=6, l=5 the Laguerre polynomial is constant and the radial measure
    # is a Gamma(shape=13, scale=3 a_mu/Z) distribution.  This catches an
    # implementation that is accidentally special-cased to the 1s oracle.
    power = 60
    expected = float(factorial(72) / factorial(12) * 3.0**power)
    obtained = expectation_radial(6, 5, power, quadrature_nodes=512)

    assert np.isfinite(obtained)
    assert obtained == pytest.approx(expected, rel=2e-10)


def test_radial_moment_requires_node_refinement_not_only_a_fine_grid_norm() -> None:
    # At 128 nodes the final n=12 norm looks converged, while the independent
    # 64-node estimate is still grossly wrong.  A check of the fine norm alone
    # therefore certifies a result for which it has no refinement evidence.
    with pytest.raises(ScientificComputationError, match="node refinement"):
        expectation_radial(12, 0, 31, quadrature_nodes=128)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"z": float("nan")},
        {"z": float("inf")},
        {"a_mu": float("nan")},
        {"a_mu": float("inf")},
    ],
)
def test_radial_moment_rejects_non_finite_scales(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError, match="positive and finite"):
        expectation_radial(1, 0, 31, quadrature_nodes=128, **kwargs)


def test_unrepresentable_radial_moment_raises_instead_of_returning_infinity() -> None:
    # <r^200>_1s is larger than float64.  The public result must fail clearly,
    # without leaking an intermediate numpy overflow warning or returning inf.
    with np.errstate(all="raise"), pytest.raises(OverflowError, match="float64"):
        expectation_radial(1, 0, 200, quadrature_nodes=512)
