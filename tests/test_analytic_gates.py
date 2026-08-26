"""P0 scientific gates for the analytic hydrogenic core.

``docs/reference/quality-gates.md`` requires six analytic gates: normalization,
orthogonality, node count, the ``H psi - E psi`` residual, ``L^2``/``L_z``, and
the known ``<r>``/``<1/r>``. Normalization and two node positions were already
covered by ``tests/test_hydrogenic.py``; this module closes the remaining four
and generalizes the node count.

Every gate here is verified against an independently derived reference (a
closed-form value, a finite-difference operator applied to ``psi`` itself, or a
quadrature rule) rather than against another QuViz code path.
"""

from __future__ import annotations

from math import pi

import numpy as np
import pytest
from scipy.special import roots_legendre
from scipy.stats import kstest

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    complex_spherical_harmonic,
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    radial_wavefunction,
    real_spherical_harmonic,
)
from quviz.physics.observables import (
    expectation_radial,
    probability_current_hydrogenic,
    radial_hamiltonian_residual,
)
from quviz.sampling.point_cloud import sample_orbital_point_cloud


@pytest.mark.parametrize(
    ("n", "l"),
    [(1, 0), (2, 0), (2, 1), (3, 1), (3, 2), (4, 0), (4, 3)],
)
def test_expectation_radial_matches_known_closed_forms(n: int, l: int) -> None:
    # Standard hydrogenic results: <r> = (3n^2 - l(l+1)) / 2 and <1/r> = 1/n^2
    # in Bohr units. Both are quadratures over the implemented R_nl, so a wrong
    # radial polynomial or normalization moves them.
    assert expectation_radial(n, l, 1) == pytest.approx((3 * n * n - l * (l + 1)) / 2.0, abs=1e-9)
    assert expectation_radial(n, l, -1) == pytest.approx(1.0 / (n * n), abs=1e-11)


@pytest.mark.parametrize(
    ("n", "l"),
    [(1, 0), (2, 0), (2, 1), (3, 1), (3, 2), (4, 2)],
)
def test_radial_hamiltonian_residual_vanishes_for_eigenstates(n: int, l: int) -> None:
    # u = r R_nl must satisfy -u''/2 + [l(l+1)/(2r^2) - Z/r] u = E u exactly.
    # The residual is reported relative to |E u| so the tolerance is scale-free.
    radius = np.linspace(0.6, 6.0 * n * n, 1_500)
    residual, energy_scale = radial_hamiltonian_residual(n, l, radius)

    assert residual.shape == radius.shape
    assert energy_scale > 0.0
    assert float(np.max(np.abs(residual))) / energy_scale < 5e-6


# --- Shared quadrature -------------------------------------------------------
#
# Gauss-Legendre in cos(theta) and a uniform rule in phi integrate the spherical
# measure dOmega = d(cos theta) dphi exactly for the low-degree harmonics used
# below. Built once because it is read-only.

_POLAR_NODES = 200
_AZIMUTH_NODES = 128
_RADIAL_NODES = 2_000
# 240 a_mu, not 120: at 120 the 6d state loses 9e-6 of its norm and the
# off-diagonal overlaps degrade to 7e-8. Node count is not the limiting factor.
_RADIAL_MAX = 240.0

_polar_x, _polar_w = roots_legendre(_POLAR_NODES)
_azimuth = np.linspace(0.0, 2.0 * pi, _AZIMUTH_NODES, endpoint=False)
_THETA, _PHI = np.meshgrid(np.arccos(_polar_x), _azimuth, indexing="ij")
_ANGULAR_WEIGHTS = _polar_w[:, None] * (2.0 * pi / _AZIMUTH_NODES)

_radial_x, _radial_w = roots_legendre(_RADIAL_NODES)
_RADIUS = 0.5 * _RADIAL_MAX * (_radial_x + 1.0)
_RADIAL_WEIGHTS = 0.5 * _RADIAL_MAX * _radial_w


def _angular_overlap(first: np.ndarray, second: np.ndarray) -> complex:
    return complex(np.sum(np.conj(first) * second * _ANGULAR_WEIGHTS))


def _radial_overlap(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.sum(_RADIAL_WEIGHTS * _RADIUS * _RADIUS * first * second))


# --- Gate: orthogonality -----------------------------------------------------


@pytest.mark.parametrize("l", [0, 1, 2])
def test_radial_functions_are_orthonormal_within_each_l(l: int) -> None:
    principal = list(range(l + 1, l + 5))
    tables = {n: radial_wavefunction(n, l, _RADIUS) for n in principal}

    for i, first in enumerate(principal):
        for second in principal[i:]:
            overlap = _radial_overlap(tables[first], tables[second])
            expected = 1.0 if first == second else 0.0
            assert overlap == pytest.approx(expected, abs=1e-9)


def test_complex_and_real_spherical_harmonics_are_orthonormal() -> None:
    states = [(l, m) for l in range(4) for m in range(-l, l + 1)]
    complex_tables = {s: complex_spherical_harmonic(*s, _THETA, _PHI) for s in states}
    real_tables = {s: real_spherical_harmonic(*s, _THETA, _PHI) for s in states}

    for i, first in enumerate(states):
        for second in states[i:]:
            expected = 1.0 if first == second else 0.0
            complex_overlap = abs(_angular_overlap(complex_tables[first], complex_tables[second]))
            real_overlap = _angular_overlap(real_tables[first], real_tables[second]).real
            assert complex_overlap == pytest.approx(expected, abs=1e-10)
            assert real_overlap == pytest.approx(expected, abs=1e-10)


def test_full_orbitals_are_orthonormal_across_n_and_l() -> None:
    states = [
        (1, 0, 0),
        (2, 0, 0),
        (2, 1, 0),
        (2, 1, 1),
        (3, 0, 0),
        (3, 1, 1),
        (3, 2, 2),
        (4, 2, 1),
    ]
    radial = {s: radial_wavefunction(s[0], s[1], _RADIUS) for s in states}
    angular = {s: complex_spherical_harmonic(s[1], s[2], _THETA, _PHI) for s in states}

    for i, first in enumerate(states):
        for second in states[i:]:
            overlap = abs(
                _radial_overlap(radial[first], radial[second])
                * _angular_overlap(angular[first], angular[second])
            )
            expected = 1.0 if first == second else 0.0
            assert overlap == pytest.approx(expected, abs=1e-9), f"{first} vs {second}"


# --- Gate: node count --------------------------------------------------------


@pytest.mark.parametrize(
    ("n", "l"),
    [(n, l) for n in range(1, 7) for l in range(n)],
)
def test_radial_node_count_matches_n_minus_l_minus_one(n: int, l: int) -> None:
    # docs/tutorials/hydrogenic-orbitals.md states N_radial = n - l - 1 as a
    # general formula; the previous suite only pinned the 3p and 4d positions.
    radius = np.linspace(1e-6, 4.0 * n * n, 200_001)
    signs = np.sign(radial_wavefunction(n, l, radius))
    signs = signs[signs != 0.0]
    assert int(np.count_nonzero(np.diff(signs))) == n - l - 1


# --- Gate: L^2 and L_z -------------------------------------------------------


@pytest.mark.parametrize(("l", "m"), [(1, 1), (2, 0), (2, 2), (3, -2), (3, 3)])
def test_spherical_harmonics_are_angular_momentum_eigenfunctions(l: int, m: int) -> None:
    # Applies the differential operators to the implemented Y by central
    # differences. Nothing here reuses the closed form that produced Y.
    theta = np.linspace(0.35, pi - 0.35, 300)
    phi = np.linspace(0.0, 2.0 * pi, 300, endpoint=False)
    polar, azimuth = np.meshgrid(theta, phi, indexing="ij")
    delta = 1e-5

    def harmonic(t: np.ndarray, p: np.ndarray) -> np.ndarray:
        return complex_spherical_harmonic(l, m, t, p)

    here = harmonic(polar, azimuth)
    scale = float(np.max(np.abs(here)))

    d_phi = (harmonic(polar, azimuth + delta) - harmonic(polar, azimuth - delta)) / (2.0 * delta)
    assert float(np.max(np.abs(-1j * d_phi - m * here))) / scale < 5e-8

    forward = harmonic(polar + delta, azimuth)
    backward = harmonic(polar - delta, azimuth)
    d_theta = (forward - backward) / (2.0 * delta)
    d2_theta = (forward - 2.0 * here + backward) / delta**2
    d2_phi = (
        harmonic(polar, azimuth + delta) - 2.0 * here + harmonic(polar, azimuth - delta)
    ) / delta**2
    l_squared = -(
        d2_theta + (np.cos(polar) / np.sin(polar)) * d_theta + d2_phi / np.sin(polar) ** 2
    )
    assert float(np.max(np.abs(l_squared - l * (l + 1) * here))) / scale < 5e-4


# --- Gate: probability current ----------------------------------------------


def _psi_cartesian(n: int, l: int, m: int, point: np.ndarray) -> complex:
    x, y, z = point
    radius = float(np.sqrt(x * x + y * y + z * z))
    polar = float(np.arccos(np.clip(z / radius, -1.0, 1.0)))
    azimuth = float(np.mod(np.arctan2(y, x), 2.0 * pi))
    value = hydrogenic_wavefunction(
        n, l, m, np.asarray([radius]), np.asarray([polar]), np.asarray([azimuth])
    )
    return complex(value[0])


def _current_at(n: int, l: int, m: int, point: np.ndarray) -> np.ndarray:
    x, y, z = point
    radius = float(np.sqrt(x * x + y * y + z * z))
    polar = float(np.arccos(np.clip(z / radius, -1.0, 1.0)))
    azimuth = float(np.mod(np.arctan2(y, x), 2.0 * pi))
    return probability_current_hydrogenic(
        n,
        l,
        m,
        np.asarray([radius]),
        np.asarray([polar]),
        np.asarray([azimuth]),
        basis=BasisKind.COMPLEX,
    )[0]


_CURRENT_PROBES = np.asarray([[1.7, 0.9, 2.2], [-2.4, 1.3, -0.8], [0.6, -3.1, 1.9]])


@pytest.mark.parametrize(("n", "l", "m"), [(2, 1, 1), (3, 2, 2), (3, 2, -1), (4, 3, 3)])
def test_current_matches_im_psi_star_grad_psi(n: int, l: int, m: int) -> None:
    # Reference built by differencing psi itself, so the closed form in
    # observables.py is never used to validate itself.
    delta = 1e-5
    for probe in _CURRENT_PROBES:
        gradient = np.asarray(
            [
                _psi_cartesian(n, l, m, probe + step) - _psi_cartesian(n, l, m, probe - step)
                for step in delta * np.eye(3)
            ]
        ) / (2.0 * delta)
        reference = np.imag(np.conj(_psi_cartesian(n, l, m, probe)) * gradient)
        obtained = _current_at(n, l, m, probe)
        assert float(np.max(np.abs(obtained - reference))) / float(np.max(np.abs(reference))) < 1e-6


@pytest.mark.parametrize(("n", "l", "m"), [(2, 1, 1), (3, 2, 2), (3, 2, -1)])
def test_stationary_current_satisfies_continuity(n: int, l: int, m: int) -> None:
    # A stationary state has d(rho)/dt = 0, so continuity demands div j = 0.
    delta = 1e-4
    for probe in _CURRENT_PROBES:
        divergence = sum(
            float(
                _current_at(n, l, m, probe + step)[axis] - _current_at(n, l, m, probe - step)[axis]
            )
            for axis, step in enumerate(delta * np.eye(3))
        ) / (2.0 * delta)
        magnitude = float(np.linalg.norm(_current_at(n, l, m, probe)))
        assert abs(divergence) / magnitude < 1e-5


def test_current_reverses_sign_with_m_while_density_is_unchanged() -> None:
    # docs/concepts/probability-current.md:39-42 is the teaching point that
    # |psi|^2 cannot distinguish +m from -m but j can. Nothing gated it before.
    forward = _current_at(3, 2, 2, _CURRENT_PROBES[0])
    reverse = _current_at(3, 2, -2, _CURRENT_PROBES[0])
    density_forward = abs(_psi_cartesian(3, 2, 2, _CURRENT_PROBES[0])) ** 2
    density_reverse = abs(_psi_cartesian(3, 2, -2, _CURRENT_PROBES[0])) ** 2

    assert density_forward == pytest.approx(density_reverse, rel=1e-14)
    assert forward == pytest.approx(-reverse, rel=1e-14)
    assert float(np.linalg.norm(forward)) > 0.0


# --- Gate: sampling distribution ---------------------------------------------
#
# docs/how-to/validate-sampler.md:15 prescribes a KS or Cramer-von Mises test
# against the analytic marginals. The previous suite only compared two moments.

_KS_SAMPLES = 20_000


def _empirical_cdf_check(samples: np.ndarray, grid: np.ndarray, density: np.ndarray) -> float:
    cumulative = np.concatenate(
        ([0.0], np.cumsum(0.5 * (density[1:] + density[:-1]) * np.diff(grid)))
    )
    cumulative /= cumulative[-1]
    return float(kstest(samples, lambda value: np.interp(value, grid, cumulative)).pvalue)


@pytest.mark.parametrize(
    ("n", "l", "m", "basis"),
    [
        (1, 0, 0, BasisKind.REAL),
        (2, 1, 0, BasisKind.REAL),
        (3, 2, 2, BasisKind.REAL),
        (4, 2, 1, BasisKind.COMPLEX),
    ],
)
def test_sampled_radial_marginal_passes_ks(n: int, l: int, m: int, basis: BasisKind) -> None:
    cloud = sample_orbital_point_cloud(n, l, m, count=_KS_SAMPLES, seed=2026, basis=basis)
    radius = np.linalg.norm(cloud.positions.astype(np.float64), axis=1)

    grid = np.linspace(0.0, 200.0, 200_001)
    radial = radial_wavefunction(n, l, grid)
    assert _empirical_cdf_check(radius, grid, grid * grid * radial * radial) > 1e-3


@pytest.mark.parametrize(
    ("n", "l", "m", "basis"),
    [(2, 1, 0, BasisKind.REAL), (3, 2, 2, BasisKind.REAL), (4, 3, 1, BasisKind.COMPLEX)],
)
def test_sampled_polar_marginal_passes_ks(n: int, l: int, m: int, basis: BasisKind) -> None:
    cloud = sample_orbital_point_cloud(n, l, m, count=_KS_SAMPLES, seed=31_337, basis=basis)
    positions = cloud.positions.astype(np.float64)
    cos_theta = positions[:, 2] / np.linalg.norm(positions, axis=1)

    grid = np.linspace(-1.0, 1.0, 200_001)
    harmonic = complex_spherical_harmonic(
        l, abs(m), np.arccos(np.clip(grid, -1.0, 1.0)), np.zeros_like(grid)
    )
    assert _empirical_cdf_check(cos_theta, grid, np.abs(harmonic) ** 2) > 1e-3


@pytest.mark.parametrize(("n", "l", "m"), [(2, 1, 1), (3, 2, -2), (3, 2, 2)])
def test_sampled_azimuth_marginal_passes_ks(n: int, l: int, m: int) -> None:
    # Real orbitals carry cos^2(m phi) for m > 0 and sin^2(m phi) for m < 0.
    cloud = sample_orbital_point_cloud(n, l, m, count=_KS_SAMPLES, seed=99, basis=BasisKind.REAL)
    positions = cloud.positions.astype(np.float64)
    azimuth = np.mod(np.arctan2(positions[:, 1], positions[:, 0]), 2.0 * pi)
    order = abs(m)

    def cdf(value: np.ndarray) -> np.ndarray:
        oscillation = np.sin(2.0 * order * value) / (2.0 * order)
        return (value + oscillation if m > 0 else value - oscillation) / (2.0 * pi)

    assert float(kstest(azimuth, cdf).pvalue) > 1e-3


@pytest.mark.parametrize(("n", "l", "m"), [(1, 0, 0), (2, 1, 0), (3, 2, 1), (4, 2, 0)])
def test_sampled_moments_match_analytic_expectations(n: int, l: int, m: int) -> None:
    cloud = sample_orbital_point_cloud(n, l, m, count=60_000, seed=5, basis=BasisKind.REAL)
    radius = np.linalg.norm(cloud.positions.astype(np.float64), axis=1)
    standard_error = float(np.std(radius)) / np.sqrt(radius.size)

    assert abs(float(np.mean(radius)) - expectation_radial(n, l, 1)) < 4.0 * standard_error
    assert float(np.mean(1.0 / radius)) == pytest.approx(expectation_radial(n, l, -1), rel=0.01)


# --- Gate: conventions -------------------------------------------------------
#
# Mutation testing found three holes that neither the previous suite nor the
# gates above closed: the reduced-mass factor in the energy, the documented
# azimuth range, and the Condon-Shortley sign beyond l = 1 (orthonormality is
# sign-blind, so it cannot see a flipped harmonic).


def test_energy_scales_with_reduced_mass_ratio() -> None:
    # The low-level energy primitive keeps the dimensionless mass ratio
    # explicit. SuperpositionState derives it uniquely as 1/a_mu.
    proton_to_electron = 1836.152_673_43
    ratio = proton_to_electron / (1.0 + proton_to_electron)

    assert hydrogenic_energy_hartree(1, reduced_mass_ratio=ratio) == pytest.approx(
        -0.5 * ratio, rel=1e-15
    )
    assert hydrogenic_energy_hartree(1, reduced_mass_ratio=ratio) > hydrogenic_energy_hartree(1)
    assert hydrogenic_energy_hartree(2, z=2.0, reduced_mass_ratio=0.5) == pytest.approx(-0.25)


def test_cartesian_to_spherical_uses_documented_angle_ranges() -> None:
    # conventions.py:35 promises theta in [0, pi] and phi in [0, 2pi).
    x = np.asarray([1.0, -1.0, -1.0, 1.0, 0.0, 0.0])
    y = np.asarray([1.0, 1.0, -1.0, -1.0, 0.0, 0.0])
    z = np.asarray([1.0, 1.0, -1.0, -1.0, 1.0, 0.0])
    radius, polar, azimuth = cartesian_to_spherical(x, y, z)

    assert np.all(azimuth >= 0.0) and np.all(azimuth < 2.0 * pi + 1e-12)
    assert np.all(polar >= 0.0) and np.all(polar <= pi)
    # Fourth quadrant must wrap to 7pi/4, not -pi/4.
    assert float(azimuth[3]) == pytest.approx(7.0 * pi / 4.0)
    assert float(radius[4]) == pytest.approx(1.0)
    # The origin is defined to return zero angles rather than NaN.
    assert float(radius[5]) == 0.0 and float(polar[5]) == 0.0 and float(azimuth[5]) == 0.0


def test_real_d_harmonics_match_cartesian_closed_forms() -> None:
    # Extends the existing l = 1 direction check to l = 2, where a dropped
    # Condon-Shortley factor would otherwise pass every gate in this module.
    direction = np.asarray([0.37, -0.61, 0.7])
    direction = direction / np.linalg.norm(direction)
    x, y, z = direction
    _, polar, azimuth = cartesian_to_spherical(*(value[None] for value in direction))

    expected = {
        0: np.sqrt(5.0 / (16.0 * pi)) * (3.0 * z * z - 1.0),
        1: np.sqrt(15.0 / (4.0 * pi)) * x * z,
        -1: np.sqrt(15.0 / (4.0 * pi)) * y * z,
        2: np.sqrt(15.0 / (16.0 * pi)) * (x * x - y * y),
        -2: np.sqrt(15.0 / (4.0 * pi)) * x * y,
    }
    for m, reference in expected.items():
        obtained = float(real_spherical_harmonic(2, m, polar, azimuth)[0])
        assert obtained == pytest.approx(float(reference), abs=1e-14), f"d orbital m={m}"


# --- Contract guards for the new observables ---------------------------------


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"z": 0.0}, "z must be positive"),
        ({"a_mu": -1.0}, "a_mu must be positive"),
    ],
)
def test_expectation_radial_rejects_invalid_scale(kwargs: dict[str, float], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        expectation_radial(2, 1, 1, **kwargs)


def test_expectation_radial_rejects_divergent_power() -> None:
    # <r^-3> diverges for l = 0, so the API refuses the whole family rather
    # than silently returning a quadrature artefact.
    with pytest.raises(ValueError, match="power must be greater than -3"):
        expectation_radial(2, 1, -3)


def test_expectation_radial_reports_an_inadequate_quadrature() -> None:
    # This guard is what catches a too-narrow domain or too few nodes. Without
    # it a truncated integral silently returns a plausible but wrong value.
    with pytest.raises(RuntimeError, match="captured norm"):
        expectation_radial(4, 0, 1, quadrature_nodes=16)


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"z": 0.0}, "z must be positive"),
        ({"step": 0.0}, "step must be positive"),
    ],
)
def test_radial_hamiltonian_residual_rejects_invalid_arguments(
    kwargs: dict[str, float], match: str
) -> None:
    with pytest.raises(ValueError, match=match):
        radial_hamiltonian_residual(2, 1, np.asarray([1.0]), **kwargs)


def test_radial_hamiltonian_residual_rejects_radii_inside_the_stencil() -> None:
    with pytest.raises(ValueError, match="r must exceed step"):
        radial_hamiltonian_residual(2, 1, np.asarray([1e-6]), step=1e-4)
