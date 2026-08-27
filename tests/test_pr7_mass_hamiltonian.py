r"""PR-7 gates for the reduced-mass and Hamiltonian contracts.

``a_mu`` is the reduced Bohr radius in ordinary-Bohr units, hence
``a_mu = m_e / mu``.  It is one physical input, not a spatial fudge factor:
the reciprocal must drive energies and the same value must drive probability
current, continuity, and scene length scales.
"""

from __future__ import annotations

from math import sqrt

import numpy as np
import pytest

from quviz.physics.observables import (
    continuity_residual,
    density_time_derivative,
    probability_current_hydrogenic,
    radial_hamiltonian_diagnostic,
    radial_hamiltonian_residual,
    superposition_current,
)
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene.builders import superposition_extent


def _moving_state(*, a_mu: float = 1.0) -> SuperpositionState:
    amplitude = 1.0 / sqrt(2.0)
    return SuperpositionState(
        terms=(
            SuperpositionTerm(1, 0, 0, amplitude),
            SuperpositionTerm(2, 1, 0, amplitude),
        ),
        a_mu=a_mu,
    )


def test_a_mu_is_the_single_source_for_energy_and_phase_scaling() -> None:
    contracted = _moving_state(a_mu=0.5)
    reference = _moving_state()

    assert contracted.reduced_mass_ratio == pytest.approx(2.0, rel=1e-15)
    assert contracted.energies == pytest.approx((-1.0, -0.25), rel=1e-15)
    assert contracted.energy_expectation == pytest.approx(-0.625, rel=1e-15)

    radius = np.asarray([0.8, 2.1, 4.7])
    polar = np.asarray([0.4, 1.2, 2.5])
    azimuth = np.asarray([0.2, 2.0, 5.3])
    time = 1.7
    # q^(3/2) Psi_a(q r, a t) = Psi_1(r, t), with q=a_mu for Z=1.
    scaled = 0.5**1.5 * contracted.evaluate(
        0.5 * radius,
        polar,
        azimuth,
        time=0.5 * time,
    )
    assert scaled == pytest.approx(
        reference.evaluate(radius, polar, azimuth, time=time), rel=2e-14, abs=2e-15
    )


def test_a_mu_drives_current_and_continuity_without_a_second_mass_input() -> None:
    contracted = _moving_state(a_mu=0.5)
    reference = _moving_state()
    points = np.asarray([[1.7, 0.9, 2.2], [-2.4, 1.3, -0.8], [0.6, -3.1, 1.9]])
    time = 1.9

    current = superposition_current(
        contracted,
        0.5 * points,
        time=0.5 * time,
        step=0.5e-5,
    )
    expected = superposition_current(reference, points, time=time, step=1e-5)
    # j_a(a r, a t) = a^-3 j_1(r, t).
    assert 0.5**3 * current == pytest.approx(expected, rel=3e-8, abs=2e-13)

    residual, _ = continuity_residual(
        contracted,
        0.5 * points,
        time=0.5 * time,
        gradient_step=0.5e-5,
        divergence_step=0.5e-3,
    )
    rate = density_time_derivative(contracted, 0.5 * points, time=0.5 * time)
    assert float(np.max(np.abs(rate))) > 1e-8
    assert float(np.max(np.abs(residual))) / float(np.max(np.abs(rate))) < 1e-3


def test_a_mu_drives_the_analytic_stationary_current_prefactor() -> None:
    radius = np.asarray([1.7, 2.4, 4.1])
    polar = np.asarray([0.7, 1.2, 2.0])
    azimuth = np.asarray([0.3, 2.1, 4.8])
    reference = probability_current_hydrogenic(2, 1, 1, radius, polar, azimuth)
    contracted = probability_current_hydrogenic(
        2,
        1,
        1,
        0.5 * radius,
        polar,
        azimuth,
        a_mu=0.5,
    )

    assert 0.5**3 * contracted == pytest.approx(reference, rel=2e-14, abs=2e-16)


def test_superposition_scene_extent_uses_the_same_a_mu_length_scale() -> None:
    reference = _moving_state()
    contracted = _moving_state(a_mu=0.5)

    assert superposition_extent(contracted) == pytest.approx(
        0.5 * superposition_extent(reference), rel=2e-14
    )


def test_default_hamiltonian_stencil_handles_the_known_extreme_scale_failure() -> None:
    # This is the old fixed-h=1e-4 counterexample: its relative residual was
    # about 5.7e-3, over three orders of magnitude beyond the unchanged gate.
    n, l, z = 6, 0, 0.05
    natural_length = n / z
    radius = np.linspace(0.6 * natural_length, 6.0 * n * n / z, 1_500)
    residual, energy_scale = radial_hamiltonian_residual(n, l, radius, z=z)

    assert float(np.max(np.abs(residual))) / energy_scale < 5e-6


def test_default_hamiltonian_stencil_records_real_adaptive_refinement() -> None:
    n, l, z = 6, 0, 0.05
    natural_length = n / z
    radius = np.linspace(0.6 * natural_length, 6.0 * n * n / z, 1_500)
    diagnostic = radial_hamiltonian_diagnostic(n, l, radius, z=z)
    fixed_residual, fixed_scale = radial_hamiltonian_residual(
        n,
        l,
        radius,
        z=z,
        step=diagnostic.initial_step,
    )

    # Returning the first scale-aware estimate without running the adaptive
    # loop fails the unchanged physical gate on this known counterexample.
    assert float(np.max(np.abs(fixed_residual))) / fixed_scale > 5e-6
    assert diagnostic.refinements >= 1
    assert diagnostic.final_step < diagnostic.initial_step
    assert diagnostic.estimated_relative_difference_error <= 1e-7
    assert float(np.max(np.abs(diagnostic.residual))) / diagnostic.energy_scale < 5e-6


@pytest.mark.parametrize(
    ("n", "l", "z", "a_mu"),
    [
        (6, 0, 1.0, 1.0),
        (6, 5, 1.0, 1.0),
        (2, 0, 0.05, 1.0),
        (6, 0, 0.05, 1.0),
        (6, 0, 1.0, 0.5),
    ],
)
def test_scaled_hamiltonian_residual_keeps_the_existing_gate(
    n: int, l: int, z: float, a_mu: float
) -> None:
    natural_length = n * a_mu / z
    radius = np.linspace(0.6 * natural_length, 6.0 * n * n * a_mu / z, 1_500)
    residual, energy_scale = radial_hamiltonian_residual(n, l, radius, z=z, a_mu=a_mu)

    assert residual.shape == radius.shape
    assert energy_scale > 0.0
    assert float(np.max(np.abs(residual))) / energy_scale < 5e-6


def test_hamiltonian_richardson_residual_converges_faster_than_second_order() -> None:
    n, l, z = 6, 0, 0.05
    natural_length = n / z
    radius = np.linspace(0.6 * natural_length, 6.0 * n * n / z, 1_500)
    errors: list[float] = []
    for fraction in (0.08, 0.04, 0.02):
        residual, energy_scale = radial_hamiltonian_residual(
            n,
            l,
            radius,
            z=z,
            step=fraction * natural_length,
        )
        errors.append(float(np.max(np.abs(residual))) / energy_scale)

    # Richardson-extrapolated five-point differences are O(h^6), hence about
    # 64x per halving here.  Requiring >32 rejects both the old O(h^2) stencil
    # and an unextrapolated O(h^4) five-point replacement.
    assert errors[0] / errors[1] > 32.0
    assert errors[1] / errors[2] > 32.0
