r"""Gates for analytic time-dependent superpositions (M1).

.. math::

   \Psi(\mathbf r,t)=\sum_k c_k\psi_k(\mathbf r)e^{-iE_kt/\hbar}.

Three independent oracles pin this down, none of which restates the
implementation:

1. **The 1s--2p Bohr oscillation.** For :math:`(\psi_{100}+\psi_{210})/\sqrt2`
   the dipole is :math:`\langle z\rangle(t)=\frac{2^7\sqrt2}{3^5}\cos\omega t`
   with :math:`\omega=E_2-E_1=3/8` hartree. Both the amplitude
   (:math:`128\sqrt2/243\approx0.744937\,a_0`, the textbook 1s--2p transition
   dipole) and the frequency are closed forms.
2. **Degeneracy.** Hydrogen's energy depends only on ``n``, so a 2s + 2p
   superposition must be *stationary* in density. Anything that mixes up which
   energy belongs to which term breaks this immediately.
3. **Continuity.** :math:`\partial\rho/\partial t+\nabla\cdot\mathbf j=0` now
   has a non-trivial time derivative, unlike the stationary case in
   ``tests/test_streamlines.py`` where it degenerates to
   :math:`\nabla\cdot\mathbf j=0`.
"""

from __future__ import annotations

from math import cos, pi, sqrt

import numpy as np
import pytest
from scipy.special import roots_legendre

from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.physics.hydrogenic import hydrogenic_wavefunction
from quviz.physics.observables import (
    continuity_residual,
    density_time_derivative,
    probability_current_hydrogenic,
    superposition_current,
)
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene.builders import (
    build_isosurface,
    build_superposition_current_field,
    build_superposition_isosurface,
)

# 1s-2p transition dipole <100|z|210> = 2^7 * sqrt(2) / 3^5.
DIPOLE_1S_2P = 128.0 * sqrt(2.0) / 243.0
BOHR_FREQUENCY_1S_2P = 0.375  # E_2 - E_1 = -1/8 - (-1/2) hartree


def _superposition(*terms: tuple[int, int, int, complex]) -> SuperpositionState:
    return SuperpositionState(terms=tuple(SuperpositionTerm(n, l, m, c) for n, l, m, c in terms))


# --- Contract ----------------------------------------------------------------


def test_single_term_superposition_reduces_to_the_stationary_wavefunction() -> None:
    state = _superposition((3, 2, 1, 1.0))
    radius = np.asarray([0.7, 2.3, 6.1])
    polar = np.asarray([0.4, 1.2, 2.4])
    azimuth = np.asarray([0.0, 1.9, 4.4])

    expected = hydrogenic_wavefunction(3, 2, 1, radius, polar, azimuth, basis=BasisKind.COMPLEX)
    assert state.evaluate(radius, polar, azimuth, time=0.0) == pytest.approx(expected, rel=1e-14)


def test_rejects_duplicate_terms_and_unnormalized_coefficients() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        _superposition((2, 1, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    with pytest.raises(ValueError, match="normalized"):
        _superposition((1, 0, 0, 0.5), (2, 1, 0, 0.5))
    with pytest.raises(ValueError, match="at least one"):
        SuperpositionState(terms=())


# --- Gate: norm and energy conservation --------------------------------------


def _spherical_quadrature(
    r_max: float = 60.0, radial_nodes: int = 600, polar_nodes: int = 64
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Product quadrature on (r, cos theta). Callers must supply the 2*pi in phi."""

    xr, wr = roots_legendre(radial_nodes)
    radius = 0.5 * r_max * (xr + 1.0)
    radial_weight = 0.5 * r_max * wr
    xp, wp = roots_legendre(polar_nodes)
    weights = (radial_weight * radius**2)[:, None] * wp[None, :]
    return radius, np.arccos(xp), weights


@pytest.mark.parametrize("time", [0.0, 3.7, 41.5, 100.0])
def test_norm_is_conserved_in_time(time: float) -> None:
    # Only true because the psi_k are orthonormal, which tests/test_analytic_gates.py
    # gates independently. Without that, cross terms would not cancel.
    state = _superposition((1, 0, 0, 0.6), (2, 1, 0, 0.8))
    radius, polar, weights = _spherical_quadrature()
    grid_r, grid_p = np.meshgrid(radius, polar, indexing="ij")
    psi = state.evaluate(grid_r, grid_p, np.zeros_like(grid_r), time=time)

    norm = 2.0 * pi * float(np.sum(np.abs(psi) ** 2 * weights))
    assert norm == pytest.approx(1.0, abs=1e-9)


def test_energy_expectation_is_the_weighted_sum_and_is_time_independent() -> None:
    state = _superposition((1, 0, 0, 0.6), (2, 1, 0, 0.8))
    expected = 0.36 * (-0.5) + 0.64 * (-0.125)
    assert state.energy_expectation == pytest.approx(expected, rel=1e-15)


# --- Gate: the physics oracles -----------------------------------------------


def test_degenerate_superposition_has_a_stationary_density() -> None:
    # 2s and 2p share E = -1/8 in hydrogen, so the relative phase never turns.
    state = _superposition((2, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    radius = np.asarray([0.9, 2.5, 5.0])
    polar = np.asarray([0.3, 1.1, 2.0])
    azimuth = np.zeros(3)

    at_zero = np.abs(state.evaluate(radius, polar, azimuth, time=0.0)) ** 2
    for time in (2.0, 13.0, 77.0):
        later = np.abs(state.evaluate(radius, polar, azimuth, time=time)) ** 2
        assert later == pytest.approx(at_zero, rel=1e-13)


@pytest.mark.parametrize("time", [0.0, 2.0, 5.5, 8.3775, 16.755])
def test_1s_2p_dipole_matches_the_analytic_bohr_oscillation(time: float) -> None:
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    radius, polar, weights = _spherical_quadrature(r_max=45.0)
    grid_r, grid_p = np.meshgrid(radius, polar, indexing="ij")
    density = np.abs(state.evaluate(grid_r, grid_p, np.zeros_like(grid_r), time=time)) ** 2

    z = grid_r * np.cos(grid_p)
    obtained = 2.0 * pi * float(np.sum(density * z * weights))
    assert obtained == pytest.approx(DIPOLE_1S_2P * cos(BOHR_FREQUENCY_1S_2P * time), abs=2e-7)


# --- Gate: current and continuity --------------------------------------------

_PROBES = np.asarray([[1.7, 0.9, 2.2], [-2.4, 1.3, -0.8], [0.6, -3.1, 1.9]])


def test_superposition_current_matches_the_stationary_closed_form() -> None:
    # A one-term superposition must reproduce the analytic azimuthal current,
    # so the finite-difference gradient is checked against a closed form.
    state = _superposition((3, 2, 2, 1.0))
    obtained = superposition_current(state, _PROBES, time=0.0)

    radius = np.linalg.norm(_PROBES, axis=1)
    polar = np.arccos(_PROBES[:, 2] / radius)
    azimuth = np.mod(np.arctan2(_PROBES[:, 1], _PROBES[:, 0]), 2.0 * pi)
    expected = probability_current_hydrogenic(
        3, 2, 2, radius, polar, azimuth, basis=BasisKind.COMPLEX
    )
    assert obtained == pytest.approx(expected, rel=2e-6)


# t = 0 is excluded on purpose: it is a turning point of the dipole, where
# d(rho)/dt vanishes identically and the check would be vacuous. The guard
# below enforces that rather than letting a silent pass look like evidence.
@pytest.mark.parametrize("time", [1.9, 4.2, 7.3, 12.6])
def test_time_dependent_continuity_residual_vanishes(time: float) -> None:
    # The whole point of M1: d(rho)/dt is now non-zero, so this is a real test
    # of the pair rather than the stationary div j = 0 degenerate case.
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    residual, scale = continuity_residual(state, _PROBES, time=time)

    assert scale > 1e-8, "density must actually be moving, or the test proves nothing"
    assert float(np.max(np.abs(residual))) / scale < 1e-3


def test_stationary_state_has_zero_density_time_derivative() -> None:
    state = _superposition((2, 1, 1, 1.0))
    _, scale = continuity_residual(state, _PROBES, time=3.0)
    assert scale < 1e-12


@pytest.mark.parametrize("time", [0.0, 1.9, 4.2, 8.3776, 12.6])
def test_density_rate_matches_its_closed_form(time: float) -> None:
    # For (psi_1s + psi_2pz)/sqrt(2) both eigenfunctions are real, so
    #     d(rho)/dt = -omega * psi_1s * psi_2pz * sin(omega t),
    # which also explains why t = 0 and t = T/2 are turning points. Deriving
    # this by hand is what showed the t = 0 case above to be vacuous.
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    radius = np.linalg.norm(_PROBES, axis=1)
    polar = np.arccos(_PROBES[:, 2] / radius)
    azimuth = np.mod(np.arctan2(_PROBES[:, 1], _PROBES[:, 0]), 2.0 * pi)

    one_s = hydrogenic_wavefunction(1, 0, 0, radius, polar, azimuth, basis=BasisKind.COMPLEX).real
    two_p = hydrogenic_wavefunction(2, 1, 0, radius, polar, azimuth, basis=BasisKind.COMPLEX).real
    expected = -BOHR_FREQUENCY_1S_2P * one_s * two_p * np.sin(BOHR_FREQUENCY_1S_2P * time)

    obtained = density_time_derivative(state, _PROBES, time=time)
    assert obtained == pytest.approx(expected, rel=1e-12, abs=1e-18)


# --- Scene assets ------------------------------------------------------------


def test_superposition_isosurface_matches_the_single_state_builder_for_one_term() -> None:
    state = _superposition((2, 1, 0, 1.0))
    general = build_superposition_isosurface(state, time=0.0, resolution=49, probability_mass=0.9)
    specific = build_isosurface(
        2, 1, 0, basis=BasisKind.COMPLEX, resolution=49, probability_mass=0.9
    )

    assert general.density_level == pytest.approx(specific.density_level, rel=1e-12)
    assert len(general.vertices) == len(specific.vertices)
    assert general.captured_probability_mass == pytest.approx(
        specific.captured_probability_mass, rel=1e-12
    )


def test_superposition_isosurface_carries_time_and_coefficients() -> None:
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_isosurface(state, time=4.0, resolution=49)

    assert payload.metadata.observable is ObservableKind.PROBABILITY_DENSITY
    assert payload.metadata.representation is RepresentationKind.ISOSURFACE
    assert payload.metadata.time_au == pytest.approx(4.0)
    assert len(payload.metadata.terms) == 2
    assert payload.metadata.is_stationary is False
    assert payload.metadata.energy_expectation_hartree == pytest.approx(-0.3125)


def test_degenerate_superposition_geometry_does_not_move() -> None:
    state = _superposition((2, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    early = build_superposition_isosurface(state, time=0.0, resolution=49)
    late = build_superposition_isosurface(state, time=30.0, resolution=49)

    assert early.metadata.is_stationary is True
    assert early.density_level == pytest.approx(late.density_level, rel=1e-12)
    assert len(early.vertices) == len(late.vertices)


def test_non_degenerate_superposition_geometry_actually_moves() -> None:
    # Half a Bohr period: the 1s-2p dipole has swung to the opposite side, so
    # the surface must not be the same set of vertices.
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    early = np.asarray(build_superposition_isosurface(state, time=0.0, resolution=49).vertices)
    half_period = pi / BOHR_FREQUENCY_1S_2P
    late = np.asarray(
        build_superposition_isosurface(state, time=half_period, resolution=49).vertices
    )

    # The dipole flips sign, so the mean z of the surface must flip with it.
    assert float(np.mean(early[:, 2])) * float(np.mean(late[:, 2])) < 0.0


def test_superposition_current_field_reports_the_time_dependent_residual() -> None:
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_current_field(state, time=2.5, seed_count=12)

    assert payload.metadata.observable is ObservableKind.PROBABILITY_CURRENT
    assert payload.metadata.representation is RepresentationKind.STREAMLINES
    assert payload.metadata.time_au == pytest.approx(2.5)
    assert len(payload.lines) > 0
    assert payload.max_speed > 0.0
    # Non-degenerate, so d(rho)/dt is genuinely non-zero here.
    assert payload.density_rate_scale > 0.0
    assert payload.continuity_residual < 1e-2


def test_mixed_shell_superposition_warns_about_scale_not_resolution() -> None:
    # A 1s cusp inside a 2p-sized cube is a scale mismatch, so the honest
    # warning must not tell the user to raise the resolution: measured, the
    # grid integral only moves 0.979 -> 0.996 going from 49 to 81.
    state = _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_isosurface(state, time=0.0, resolution=49)

    assert payload.finite_grid_density_integral < 0.999
    warning = " ".join(payload.metadata.warnings)
    assert "under-resolves" in warning
    assert "n=[1, 2]" in warning


def test_mixed_shell_quadrature_error_dwarfs_the_single_shell_case() -> None:
    # The measured basis for the warning above. Both converge with resolution,
    # so the distinction is magnitude, not rate: at resolution 49 the 1s + 2p
    # error is ~6x the 2s + 2p error, because the box is sized for the wide
    # term while the compact one carries the cusp.
    mixed = build_superposition_isosurface(
        _superposition((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0))),
        time=0.0,
        resolution=49,
    ).finite_grid_density_integral
    same = build_superposition_isosurface(
        _superposition((2, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0))),
        time=0.0,
        resolution=49,
    ).finite_grid_density_integral

    assert abs(1.0 - mixed) > 3.0 * abs(1.0 - same)
    assert abs(1.0 - same) < 0.01
