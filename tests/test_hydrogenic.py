from __future__ import annotations

from math import pi

import numpy as np
import pytest

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import (
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    radial_wavefunction,
    real_spherical_harmonic,
    validate_quantum_numbers,
)
from quviz.physics.observables import probability_current_hydrogenic, probability_density


@pytest.mark.parametrize(
    ("n", "l", "m"),
    [(1, 0, 0), (2, 1, -1), (3, 2, 2), (5, 4, 0)],
)
def test_quantum_numbers_accept_valid_domain(n: int, l: int, m: int) -> None:
    validate_quantum_numbers(n, l, m)


@pytest.mark.parametrize(
    ("n", "l", "m"),
    [(0, 0, 0), (2, 2, 0), (2, 1, 2), (2, -1, 0)],
)
def test_quantum_numbers_reject_invalid_domain(n: int, l: int, m: int) -> None:
    with pytest.raises(ValueError):
        validate_quantum_numbers(n, l, m)


def test_hydrogen_ground_state_matches_closed_form() -> None:
    radius = np.asarray([0.0, 0.25, 1.0, 3.0])
    expected = 2.0 * np.exp(-radius)
    assert radial_wavefunction(1, 0, radius) == pytest.approx(expected, rel=1e-13, abs=1e-14)


def test_radial_functions_are_normalized() -> None:
    radius = np.linspace(0.0, 180.0, 200_001)
    for n, l in [(1, 0), (2, 0), (2, 1), (3, 1), (4, 2)]:
        radial = radial_wavefunction(n, l, radius)
        integral = np.trapezoid(radius * radius * radial * radial, radius)
        assert integral == pytest.approx(1.0, abs=3e-7)


def test_confirmed_3p_and_4d_radial_nodes() -> None:
    # sigma = r/a_mu for Z=1. The audited Manim source placed these nodes at 2 and 3.
    assert float(radial_wavefunction(3, 1, 6.0)) == pytest.approx(0.0, abs=2e-16)
    assert float(radial_wavefunction(4, 2, 12.0)) == pytest.approx(0.0, abs=2e-16)

    assert float(radial_wavefunction(3, 1, 5.9) * radial_wavefunction(3, 1, 6.1)) < 0.0
    assert float(radial_wavefunction(4, 2, 11.9) * radial_wavefunction(4, 2, 12.1)) < 0.0


def test_real_p_harmonics_match_cartesian_directions() -> None:
    theta = np.asarray([pi / 2, pi / 2, 0.0])
    phi = np.asarray([0.0, pi / 2, 0.0])
    scale = np.sqrt(3.0 / (4.0 * pi))

    px = real_spherical_harmonic(1, 1, theta, phi)
    py = real_spherical_harmonic(1, -1, theta, phi)
    pz = real_spherical_harmonic(1, 0, theta, phi)

    assert px == pytest.approx([scale, 0.0, 0.0], abs=2e-15)
    assert py == pytest.approx([0.0, scale, 0.0], abs=2e-15)
    assert pz == pytest.approx([0.0, 0.0, scale], abs=2e-15)


def test_full_wavefunction_is_normalized_on_spherical_grid() -> None:
    radius = np.linspace(0.0, 60.0, 4_001)
    theta = np.linspace(0.0, pi, 801)
    phi = np.linspace(0.0, 2.0 * pi, 1_001)

    # Factorized quadrature avoids a large three-dimensional allocation.
    radial = radial_wavefunction(3, 2, radius)
    radial_mass = np.trapezoid(radius**2 * radial**2, radius)
    angular = hydrogenic_wavefunction(
        3,
        2,
        1,
        np.ones((theta.size, 1)),
        theta[:, None],
        phi[None, :],
        basis=BasisKind.COMPLEX,
    )
    # R(1) appears in angular above, so divide it back out before integrating.
    angular_density = probability_density(angular) / float(radial_wavefunction(3, 2, 1.0) ** 2)
    angular_mass = np.trapezoid(
        np.trapezoid(angular_density, phi, axis=1) * np.sin(theta), theta
    )
    assert radial_mass * angular_mass == pytest.approx(1.0, abs=3e-5)


def test_stationary_complex_state_can_have_nonzero_current() -> None:
    current = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([2.0]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        basis=BasisKind.COMPLEX,
    )
    assert current.shape == (1, 3)
    assert current[0, 0] == pytest.approx(0.0, abs=1e-15)
    assert current[0, 1] > 0.0
    assert current[0, 2] == pytest.approx(0.0, abs=1e-15)

    real_current = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([2.0]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        basis=BasisKind.REAL,
    )
    assert np.all(real_current == 0.0)


def test_hydrogenic_energy_scaling() -> None:
    assert hydrogenic_energy_hartree(1) == pytest.approx(-0.5)
    assert hydrogenic_energy_hartree(2, z=2.0) == pytest.approx(-0.5)
