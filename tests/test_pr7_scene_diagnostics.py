"""PR-7 gates for scale-aware scene diagnostics.

These tests deliberately exercise public payloads.  A diagnostic that is
correct only in a private helper but is then mislabeled or discarded by the
scene builder is not useful to an API consumer.
"""

from __future__ import annotations

from math import factorial, pi, sqrt

import numpy as np
import pytest

from quviz.conventions import BasisKind
from quviz.errors import ScientificComputationError
from quviz.physics.continuity import (
    _rank_probe_scores,
    select_continuity_probes,
    transition_coherence_scale,
)
from quviz.physics.finite_box import finite_box_tail_mass_upper_bound
from quviz.physics.hydrogenic import cartesian_to_spherical, hydrogenic_wavefunction
from quviz.physics.observables import continuity_residual, density_time_derivative
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene import builders as scene_builders
from quviz.scene.builders import (
    build_current_field,
    build_superposition_current_field,
    build_superposition_isosurface,
)


def _state(
    *terms: tuple[int, int, int, complex], z: float = 1.0, a_mu: float = 1.0
) -> SuperpositionState:
    return SuperpositionState(
        tuple(SuperpositionTerm(n, l, m, coefficient) for n, l, m, coefficient in terms),
        z=z,
        a_mu=a_mu,
    )


@pytest.mark.parametrize(("n", "z"), [(2, 1.0), (3, 1.0), (6, 1.0), (3, 5.0)])
def test_stationary_streamline_defaults_are_dimensionless(n: int, z: float) -> None:
    """The default geometry and density cutoff scale with the physical state."""

    payload = build_current_field(
        n,
        1,
        1,
        z=z,
        basis=BasisKind.COMPLEX,
        seed_count=4,
    )
    length = n * n / z

    assert payload.arc_step_bohr / length == pytest.approx(0.03, rel=1e-14)
    assert payload.seed_density_floor * length**3 == pytest.approx(1e-4, rel=1e-12)
    assert payload.continuity_scale_kind == "stationary_current"
    assert payload.continuity_scale > 0.0
    assert payload.continuity_residual < 1e-3


@pytest.mark.parametrize("fraction", [1.0 / 4_096.0, 1.0 / 8.0])
def test_explicit_arc_step_accepts_the_closed_dimensionless_boundaries(fraction: float) -> None:
    payload = build_current_field(1, 0, 0, arc_step=fraction, seed_count=1)

    assert payload.arc_step_bohr == fraction


@pytest.mark.parametrize(
    "fraction",
    [
        np.nextafter(1.0 / 4_096.0, 0.0),
        np.nextafter(1.0 / 8.0, np.inf),
    ],
)
def test_explicit_arc_step_rejects_values_just_outside_dimensionless_boundaries(
    fraction: float,
) -> None:
    with pytest.raises(ValueError, match="arc_step / support_length"):
        build_current_field(1, 0, 0, arc_step=fraction, seed_count=1)


def test_streamline_point_budget_caps_before_an_unsafe_float_division() -> None:
    with np.errstate(over="raise", invalid="raise"):
        budget = scene_builders._streamline_point_budget(
            float(np.finfo(np.float64).max),
            float(np.finfo(np.float64).tiny),
        )

    assert budget == 4_096


def test_analytic_zero_stationary_current_reports_that_no_probes_ran() -> None:
    payload = build_current_field(2, 1, 0, basis=BasisKind.COMPLEX, seed_count=4)

    assert payload.continuity_scale_kind == "analytic_zero_current"
    assert payload.continuity_absolute_residual == 0.0
    assert payload.continuity_scale == 0.0
    assert payload.continuity_residual == 0.0
    assert payload.continuity_probe_count == 0


def test_superposition_streamline_defaults_resolve_the_compact_term() -> None:
    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (3, 2, 1, 1.0 / sqrt(2.0)))
    payload = build_superposition_current_field(state, time=1.0, seed_count=4)

    assert payload.arc_step_bohr == pytest.approx(0.03)
    assert payload.seed_density_floor * 9.0**3 == pytest.approx(1e-4, rel=1e-12)


def test_probe_score_ranking_uses_candidate_index_for_numeric_ties() -> None:
    """Last-bit noise inside the documented tie width must not reorder probes."""

    maximum = 1.0
    epsilon = np.finfo(np.float64).eps
    scores = np.asarray(
        [
            maximum - 16.0 * epsilon,
            maximum,
            0.5,
            maximum - 32.0 * epsilon,
            0.75,
        ]
    )

    assert _rank_probe_scores(scores).tolist() == [0, 1, 3, 4, 2]


def test_superposition_streamline_defaults_and_probes_scale_with_z_and_a_mu() -> None:
    terms = (
        (1, 0, 0, 1.0 / sqrt(2.0)),
        (3, 2, 1, 1.0 / sqrt(2.0)),
    )
    reference = _state(*terms)
    contracted = _state(*terms, z=2.0, a_mu=0.5)
    reference_payload = build_superposition_current_field(reference, time=1.0, seed_count=4)
    contracted_payload = build_superposition_current_field(
        contracted,
        time=0.125,
        seed_count=4,
    )

    assert contracted_payload.arc_step_bohr == pytest.approx(
        0.25 * reference_payload.arc_step_bohr,
        rel=2e-14,
    )
    assert contracted_payload.seed_density_floor == pytest.approx(
        64.0 * reference_payload.seed_density_floor,
        rel=2e-14,
    )
    assert select_continuity_probes(contracted, count=8) == pytest.approx(
        0.25 * select_continuity_probes(reference, count=8),
        rel=2e-14,
    )
    assert contracted_payload.continuity_residual == pytest.approx(
        reference_payload.continuity_residual,
        rel=0.04,
    )


def test_time_dependent_superposition_flow_payload_is_covariant_at_z_point_one() -> None:
    terms = (
        (1, 0, 0, 1.0 / sqrt(2.0)),
        (2, 1, 1, 1.0 / sqrt(2.0)),
    )
    reference = build_superposition_current_field(
        _state(*terms),
        time=1.0,
        seed_count=2,
        arc_step=0.125,
        lattice=9,
    )
    diffuse = build_superposition_current_field(
        _state(*terms, z=0.1),
        time=100.0,
        seed_count=2,
        arc_step=1.25,
        lattice=9,
    )

    assert diffuse.seed_count == reference.seed_count > 0
    assert diffuse.max_speed == pytest.approx(0.1 * reference.max_speed, rel=1e-10)
    assert diffuse.seed_density_floor == pytest.approx(
        0.1**3 * reference.seed_density_floor, rel=2e-15
    )
    for reference_line, diffuse_line, reference_speed, diffuse_speed in zip(
        reference.lines,
        diffuse.lines,
        reference.speed,
        diffuse.speed,
        strict=True,
    ):
        assert np.asarray(diffuse_line) / 10.0 == pytest.approx(
            np.asarray(reference_line), rel=2e-15, abs=2e-15
        )
        assert np.asarray(diffuse_speed) / 0.1 == pytest.approx(
            np.asarray(reference_speed), rel=1e-9, abs=0.0
        )


def test_time_dependent_superposition_flow_payload_is_covariant_in_a_mu() -> None:
    terms = (
        (1, 0, 0, 1.0 / sqrt(2.0)),
        (2, 1, 1, 1.0 / sqrt(2.0)),
    )
    reference = build_superposition_current_field(
        _state(*terms),
        time=1.0,
        seed_count=2,
        arc_step=0.125,
        lattice=9,
    )
    contracted = build_superposition_current_field(
        _state(*terms, a_mu=0.1),
        time=0.1,
        seed_count=2,
        arc_step=0.0125,
        lattice=9,
    )

    assert contracted.seed_count == reference.seed_count > 0
    assert contracted.max_speed == pytest.approx(reference.max_speed, rel=1e-10)
    assert contracted.seed_density_floor == pytest.approx(
        1_000.0 * reference.seed_density_floor, rel=2e-15
    )
    for reference_line, contracted_line, reference_speed, contracted_speed in zip(
        reference.lines,
        contracted.lines,
        reference.speed,
        contracted.speed,
        strict=True,
    ):
        assert np.asarray(contracted_line) / 0.1 == pytest.approx(
            np.asarray(reference_line), rel=2e-15, abs=2e-15
        )
        assert np.asarray(contracted_speed) == pytest.approx(
            np.asarray(reference_speed), rel=1e-9, abs=0.0
        )


def test_turning_point_has_a_nonzero_continuity_reference_scale() -> None:
    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_current_field(state, time=0.0, seed_count=8)

    assert payload.metadata.is_stationary is False
    assert payload.density_rate_scale < 1e-14
    assert payload.continuity_scale > 0.0
    assert payload.continuity_scale_kind == "transition_coherence"
    assert payload.continuity_probe_count >= 4
    assert payload.continuity_phase_count >= 4
    assert payload.continuity_residual < 1e-3


def test_turning_point_audit_rejects_an_implementation_with_no_current(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A t=0-only check would miss this deliberately broken current."""

    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))

    def residual_without_current(
        audited_state: SuperpositionState,
        points: np.ndarray,
        *,
        time: float = 0.0,
        gradient_step: float | None = None,
        divergence_step: float | None = None,
    ) -> tuple[np.ndarray, float]:
        del gradient_step, divergence_step
        rate = density_time_derivative(audited_state, points, time=time)
        scale = float(np.max(transition_coherence_scale(audited_state, points)))
        return rate, scale

    monkeypatch.setattr(scene_builders, "continuity_residual", residual_without_current)
    payload = scene_builders.build_superposition_current_field(state, time=0.0, seed_count=4)

    assert payload.density_rate_scale < 1e-14
    assert payload.continuity_residual > 0.9


def test_transition_coherence_has_the_closed_form_and_mass_scale_covariance() -> None:
    reference = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    points = np.asarray([[0.7, 0.4, 0.9], [-1.2, 0.5, 0.8]])
    radius, polar, azimuth = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
    one_s = hydrogenic_wavefunction(1, 0, 0, radius, polar, azimuth).real
    two_p = hydrogenic_wavefunction(2, 1, 0, radius, polar, azimuth).real
    expected = 3.0 / 8.0 * np.abs(one_s * two_p)

    obtained = transition_coherence_scale(reference, points)
    assert obtained == pytest.approx(expected, rel=2e-14, abs=1e-18)

    scaled = _state(
        (1, 0, 0, 1.0 / sqrt(2.0)),
        (2, 1, 0, 1.0 / sqrt(2.0)),
        z=2.0,
        a_mu=0.5,
    )
    factor = 2.0**5 / 0.5**4
    assert transition_coherence_scale(scaled, 0.25 * points) == pytest.approx(
        factor * obtained,
        rel=3e-14,
    )

    reference_residual, reference_scale = continuity_residual(reference, points, time=1.9)
    scaled_residual, scaled_scale = continuity_residual(
        scaled,
        0.25 * points,
        time=1.9 / 8.0,
    )
    assert scaled_scale == pytest.approx(factor * reference_scale, rel=3e-14)
    assert float(np.max(np.abs(scaled_residual))) == pytest.approx(
        factor * float(np.max(np.abs(reference_residual))),
        rel=0.03,
    )


def test_selected_transition_probes_cover_both_active_shell_scales() -> None:
    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    radius = np.linalg.norm(select_continuity_probes(state, count=8), axis=1)

    assert float(np.min(radius)) < 2.0
    assert float(np.max(radius)) > 2.0


def test_continuity_scale_tracks_a_weak_active_component() -> None:
    scales: list[float] = []
    for epsilon in (1e-2, 1e-3):
        state = _state(
            (1, 0, 0, sqrt(1.0 - epsilon * epsilon)),
            (2, 1, 0, epsilon),
        )
        scales.append(
            build_superposition_current_field(state, time=0.0, seed_count=8).continuity_scale
        )

    assert scales[0] / scales[1] == pytest.approx(10.0, rel=0.03)


def test_transition_scale_does_not_square_an_active_tiny_term_to_zero() -> None:
    epsilon = 1e-200
    state = _state((1, 0, 0, 1.0), (2, 1, 0, epsilon))
    probes = select_continuity_probes(state, count=8)
    local_scale = transition_coherence_scale(state, probes)
    payload = build_superposition_current_field(
        state,
        time=0.0,
        seed_count=1,
        lattice=5,
    )

    assert len(state.terms) == 2
    assert float(np.max(local_scale)) > 0.0
    assert payload.continuity_scale_kind == "transition_coherence"
    assert payload.continuity_scale > 0.0
    # Float64 cannot resolve this deliberately extreme current accurately;
    # the diagnostic must expose that failure, never turn it into 0/0 -> 0.
    assert payload.continuity_residual > 1.0


def test_nonstationary_zero_transition_reference_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))

    def zero_scale(
        audited_state: SuperpositionState,
        points: np.ndarray,
        *,
        time: float = 0.0,
        gradient_step: float | None = None,
        divergence_step: float | None = None,
    ) -> tuple[np.ndarray, float]:
        del audited_state, time, gradient_step, divergence_step
        return np.zeros(points.shape[0]), 0.0

    monkeypatch.setattr(scene_builders, "continuity_residual", zero_scale)
    with pytest.raises(ScientificComputationError, match="no resolvable transition scale"):
        scene_builders.build_superposition_current_field(
            state,
            time=0.0,
            seed_count=1,
            lattice=5,
        )


def test_degenerate_zero_flow_is_identified_without_a_vacuous_ratio() -> None:
    state = _state((2, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_current_field(state, time=3.0, seed_count=8)

    assert payload.metadata.is_stationary is True
    assert payload.continuity_scale == 0.0
    assert payload.continuity_scale_kind == "analytic_zero_current"
    assert payload.continuity_absolute_residual == 0.0
    assert payload.continuity_probe_count == 0
    assert payload.continuity_phase_count == 0


def test_complex_conjugate_pair_is_identified_as_a_real_zero_current_state() -> None:
    payload = build_superposition_current_field(
        _state((2, 1, 1, 1.0 / sqrt(2.0)), (2, 1, -1, 1.0 / sqrt(2.0))),
        time=3.0,
        seed_count=4,
    )

    assert payload.metadata.is_stationary is True
    assert payload.continuity_scale_kind == "analytic_zero_current"
    assert payload.continuity_absolute_residual == 0.0
    assert payload.continuity_scale == 0.0
    assert payload.continuity_residual == 0.0
    assert payload.continuity_probe_count == 0
    assert payload.continuity_phase_count == 0


def test_complex_reality_relation_keeps_the_condon_shortley_parity() -> None:
    payload = build_superposition_current_field(
        _state((2, 1, 0, 1.0 / sqrt(2.0)), (2, 1, 1, -0.5), (2, 1, -1, 0.5)),
        time=3.0,
        seed_count=4,
    )

    assert payload.continuity_scale_kind == "analytic_zero_current"
    assert payload.lines == []
    assert payload.max_speed == 0.0


def test_contracted_analytic_zero_state_cannot_emit_roundoff_streamlines() -> None:
    contracted = _state(
        (2, 1, 1, 1.0 / sqrt(2.0)),
        (2, 1, -1, 1.0 / sqrt(2.0)),
        z=20.0,
        a_mu=0.01,
    )
    payload = build_superposition_current_field(contracted, time=3.0, seed_count=4)

    assert payload.continuity_scale_kind == "analytic_zero_current"
    assert payload.lines == []
    assert payload.speed == []
    assert payload.seed_count == 0
    assert payload.max_speed == 0.0


def test_unequal_complex_conjugate_pair_is_not_mislabeled_as_zero_current() -> None:
    payload = build_superposition_current_field(
        _state((2, 1, 1, sqrt(3.0) / 2.0), (2, 1, -1, 0.5)),
        time=3.0,
        seed_count=4,
    )

    assert payload.metadata.is_stationary is True
    assert payload.continuity_scale_kind == "stationary_current"
    assert payload.continuity_scale > 0.0
    assert payload.continuity_residual < 1e-3


def test_tiny_active_real_basis_phase_is_not_swallowed_by_reality_tolerance() -> None:
    epsilon = 1e-15
    state = SuperpositionState(
        terms=(
            SuperpositionTerm(2, 0, 0, sqrt(1.0 - epsilon * epsilon)),
            SuperpositionTerm(2, 1, 0, 1j * epsilon),
        ),
        basis=BasisKind.REAL,
    )
    payload = build_superposition_current_field(state, time=3.0, seed_count=4)

    assert len(state.terms) == 2
    assert payload.metadata.is_stationary is True
    assert payload.continuity_scale_kind == "stationary_current"
    assert payload.continuity_scale > 0.0


def test_stationary_superposition_with_nonzero_flow_uses_a_current_scale() -> None:
    payload = build_superposition_current_field(
        _state((3, 2, 2, 1.0)),
        time=2.0,
        seed_count=4,
    )

    assert payload.metadata.is_stationary is True
    assert payload.continuity_scale_kind == "stationary_current"
    assert payload.continuity_scale > 0.0
    assert payload.continuity_residual < 1e-3


def test_same_parity_mixed_shell_grid_error_is_classified_as_phase_dependent() -> None:
    # Use two p shells so this remains a deliberate coarse-grid diagnostic,
    # rather than invoking the separate excited-s topology convergence gate.
    state = _state((2, 1, 0, 1.0 / sqrt(2.0)), (4, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_isosurface(state, time=0.0, resolution=81)

    assert payload.finite_box_tail_mass_upper_bound < 3e-5
    two_p_tail = finite_box_tail_mass_upper_bound(_state((2, 1, 0, 1.0)), payload.extent_bohr)
    four_p_tail = finite_box_tail_mass_upper_bound(_state((4, 1, 0, 1.0)), payload.extent_bohr)
    expected_variation_bound = 2.0 * sqrt(two_p_tail * four_p_tail)
    assert payload.finite_box_mass_variation_upper_bound > 0.0
    assert payload.finite_box_mass_variation_upper_bound == pytest.approx(
        expected_variation_bound,
        rel=2e-14,
    )
    assert payload.finite_box_mass_variation_upper_bound < 2e-9
    assert (
        payload.finite_grid_phase_variation_bound > 100.0 * payload.finite_box_tail_mass_upper_bound
    )
    assert payload.finite_grid_mass_error_lower_bound > 0.005
    assert payload.finite_grid_aliasing_variation_lower_bound > 0.002
    assert (
        payload.finite_grid_aliasing_variation_lower_bound
        > 1_000_000.0 * payload.finite_box_mass_variation_upper_bound
    )
    assert payload.finite_grid_mass_status == "phase_dependent_quadrature_error"
    assert any("phase-dependent quadrature" in warning for warning in payload.metadata.warnings)


def test_finite_box_tail_bound_matches_the_closed_form_one_s_sphere_tail() -> None:
    state = _state((1, 0, 0, 1.0))
    extent = 7.25
    expected = np.exp(-2.0 * extent) * (1.0 + 2.0 * extent + 2.0 * extent * extent)

    obtained = finite_box_tail_mass_upper_bound(state, extent)
    scaled = finite_box_tail_mass_upper_bound(
        SuperpositionState(
            terms=(SuperpositionTerm(1, 0, 0, 1.0),),
            z=2.0,
            a_mu=0.5,
        ),
        0.25 * extent,
    )

    assert obtained > 0.0
    assert obtained == pytest.approx(expected, rel=2e-13)
    assert scaled == pytest.approx(expected, rel=2e-13)


def test_finite_box_tail_bound_matches_the_closed_form_two_s_sphere_tail() -> None:
    extent = 7.25
    expected = np.exp(-extent) * (1.0 + extent + 0.5 * extent * extent + extent**4 / 8.0)
    obtained = finite_box_tail_mass_upper_bound(_state((2, 0, 0, 1.0)), extent)

    assert obtained > 0.0
    assert obtained == pytest.approx(expected, rel=3e-13)


def test_finite_box_tail_bound_matches_the_closed_form_two_p_sphere_tail() -> None:
    extent = 7.25
    expected = np.exp(-extent) * sum(extent**power / factorial(power) for power in range(5))
    obtained = finite_box_tail_mass_upper_bound(_state((2, 1, 0, 1.0)), extent)

    assert obtained > 0.0
    assert obtained == pytest.approx(expected, rel=2e-13)


def test_opposite_parity_mixed_shell_grid_error_is_time_invariant() -> None:
    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    payload = build_superposition_isosurface(state, time=0.0, resolution=49)

    assert payload.finite_box_tail_mass_upper_bound < 3e-5
    assert payload.finite_box_mass_variation_upper_bound == 0.0
    assert payload.finite_grid_phase_variation_bound < 1e-12
    assert payload.finite_grid_aliasing_variation_lower_bound < 1e-12
    assert payload.finite_grid_mass_error_lower_bound > 0.01
    assert payload.finite_grid_mass_status == "time_invariant_quadrature_error"
    warning = " ".join(payload.metadata.warnings)
    assert "time-invariant quadrature" in warning
    assert "phase-dependent quadrature" not in warning


def test_same_parity_grid_drift_matches_the_reported_mode_not_boundary_flux() -> None:
    state = _state((2, 1, 0, 1.0 / sqrt(2.0)), (4, 1, 0, 1.0 / sqrt(2.0)))
    early = build_superposition_isosurface(state, time=0.0, resolution=81)
    half_period = pi / abs(state.energies[1] - state.energies[0])
    late = build_superposition_isosurface(state, time=half_period, resolution=81)
    observed = abs(late.finite_grid_density_integral - early.finite_grid_density_integral)

    assert observed == pytest.approx(early.finite_grid_phase_variation_bound, rel=2e-13)
    assert observed > 1_000_000.0 * early.finite_box_mass_variation_upper_bound


def test_opposite_parity_grid_mass_is_constant_at_half_period() -> None:
    state = _state((1, 0, 0, 1.0 / sqrt(2.0)), (2, 1, 0, 1.0 / sqrt(2.0)))
    early = build_superposition_isosurface(state, time=0.0, resolution=49)
    half_period = pi / abs(state.energies[1] - state.energies[0])
    late = build_superposition_isosurface(state, time=half_period, resolution=49)

    assert late.finite_grid_density_integral == pytest.approx(
        early.finite_grid_density_integral,
        abs=2e-15,
    )


def test_equal_gap_interference_is_summed_coherently_before_classification() -> None:
    state = _state(
        (2, 1, 1, 0.5),
        (2, 1, -1, 0.5),
        (3, 1, 1, 0.5),
        (3, 1, -1, -0.5),
    )
    payload = build_superposition_isosurface(state, time=0.0, resolution=65)

    assert payload.finite_grid_phase_variation_bound < 1e-12
    assert payload.finite_grid_aliasing_variation_lower_bound < 1e-12
    assert payload.finite_grid_reporting_tolerance == pytest.approx(0.002)
    assert payload.finite_grid_mass_status == "no_error_above_tolerance_proven"
    assert not any("phase-dependent" in warning for warning in payload.metadata.warnings)
