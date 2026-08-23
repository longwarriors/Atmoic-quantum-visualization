"""Gates for probability-flow streamlines.

The integrator is written for a general velocity field, but stationary
hydrogenic states give it an exact oracle. Since

    v = j / rho = (m / mu) * (-y, x, 0) / (x^2 + y^2),

every flow line is a circle of constant cylindrical radius and constant height,
closing after arc length ``2 pi s``. The integrator is not told this, so
conservation of ``s`` and ``z`` is a genuine check on both the integrator and
the current formula rather than a restatement of either.
"""

from __future__ import annotations

from math import pi

import numpy as np
import pytest

from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.physics.hydrogenic import cartesian_to_spherical, hydrogenic_wavefunction
from quviz.physics.observables import probability_density
from quviz.scene.builders import build_current_field
from quviz.scene.streamlines import hydrogenic_flow_velocity, integrate_streamline


def _cylindrical_radius(points: np.ndarray) -> np.ndarray:
    return np.hypot(points[:, 0], points[:, 1])


@pytest.mark.parametrize(("n", "l", "m"), [(2, 1, 1), (3, 2, 2), (3, 2, -1), (4, 3, 3)])
def test_integrated_streamline_conserves_cylindrical_radius_and_height(
    n: int, l: int, m: int
) -> None:
    seed = np.asarray([2.6, 0.0, 1.4])
    velocity = hydrogenic_flow_velocity(n, l, m, basis=BasisKind.COMPLEX)
    line = integrate_streamline(velocity, seed, arc_step=0.05, max_points=400)

    radius = _cylindrical_radius(line.vertices)
    assert line.vertices.shape[1] == 3
    assert line.vertices.shape[0] > 100
    assert float(np.max(np.abs(radius - radius[0]))) / radius[0] < 1e-6
    assert float(np.max(np.abs(line.vertices[:, 2] - seed[2]))) < 1e-6


def test_streamline_closes_after_one_analytic_period() -> None:
    seed = np.asarray([3.0, 0.0, 0.5])
    circumference = 2.0 * pi * 3.0
    steps = 720
    velocity = hydrogenic_flow_velocity(2, 1, 1, basis=BasisKind.COMPLEX)
    line = integrate_streamline(
        velocity, seed, arc_step=circumference / steps, max_points=steps + 1
    )

    assert float(np.linalg.norm(line.vertices[-1] - seed)) < 1e-5


@pytest.mark.parametrize(("n", "l", "m"), [(2, 1, 1), (3, 2, 2)])
def test_circulation_reverses_with_the_sign_of_m(n: int, l: int, m: int) -> None:
    seed = np.asarray([2.2, 0.0, 0.8])
    forward = integrate_streamline(
        hydrogenic_flow_velocity(n, l, m, basis=BasisKind.COMPLEX),
        seed,
        arc_step=0.05,
        max_points=40,
    )
    reverse = integrate_streamline(
        hydrogenic_flow_velocity(n, l, -m, basis=BasisKind.COMPLEX),
        seed,
        arc_step=0.05,
        max_points=40,
    )

    # Mirror image through the y = 0 plane, traversed the other way round.
    mirrored = reverse.vertices * np.asarray([1.0, -1.0, 1.0])
    assert forward.vertices == pytest.approx(mirrored, abs=1e-9)
    assert forward.speed == pytest.approx(reverse.speed, rel=1e-12)


def test_real_basis_has_no_probability_flow() -> None:
    velocity = hydrogenic_flow_velocity(2, 1, 1, basis=BasisKind.REAL)
    assert velocity(np.asarray([[1.3, 0.7, 0.4]])) == pytest.approx(np.zeros((1, 3)), abs=0.0)

    line = integrate_streamline(velocity, np.asarray([1.3, 0.7, 0.4]), arc_step=0.05, max_points=50)
    assert line.vertices.shape[0] == 1  # a stalled seed emits no line


def test_integration_stops_where_the_field_vanishes() -> None:
    # On the z axis the azimuthal field is singular and masked to zero; the
    # integrator must stop rather than emit NaNs.
    velocity = hydrogenic_flow_velocity(2, 1, 1, basis=BasisKind.COMPLEX)
    line = integrate_streamline(velocity, np.asarray([0.0, 0.0, 1.0]), arc_step=0.05, max_points=50)

    assert line.vertices.shape[0] == 1
    assert np.all(np.isfinite(line.vertices))


def test_speed_matches_the_analytic_azimuthal_magnitude() -> None:
    seed = np.asarray([2.0, 0.0, 1.0])
    velocity = hydrogenic_flow_velocity(3, 2, 2, basis=BasisKind.COMPLEX)
    line = integrate_streamline(velocity, seed, arc_step=0.05, max_points=20)

    # |v| = |m| / (mu * s) with s the cylindrical radius, independent of the
    # radial function because rho cancels in j / rho.
    assert float(line.speed[0]) == pytest.approx(2.0 / 2.0, rel=1e-12)


def test_velocity_on_the_polar_axis_is_silent_rather_than_warning() -> None:
    # On the axis both j and rho vanish for m != 0, so the quotient is 0/0.
    # The masked branch exists to keep that quiet: a library that emits numpy
    # RuntimeWarnings during ordinary rendering trains callers to ignore them.
    velocity = hydrogenic_flow_velocity(2, 1, 1, basis=BasisKind.COMPLEX)
    with np.errstate(all="raise"):
        value = velocity(np.asarray([[0.0, 0.0, 1.0]]))
    assert value == pytest.approx(np.zeros((1, 3)), abs=0.0)


# --- Scene contract ----------------------------------------------------------


def test_current_field_payload_declares_current_and_streamlines() -> None:
    payload = build_current_field(3, 2, 2, basis=BasisKind.COMPLEX, seed_count=24)

    assert payload.metadata.observable is ObservableKind.PROBABILITY_CURRENT
    assert payload.metadata.representation is RepresentationKind.STREAMLINES
    assert len(payload.lines) > 0
    assert len(payload.lines) == len(payload.speed)
    for line, speed in zip(payload.lines, payload.speed, strict=True):
        assert len(line) == len(speed)
        assert all(len(vertex) == 3 for vertex in line)
    assert payload.max_speed > 0.0


def test_current_field_reports_its_own_continuity_residual() -> None:
    # A stationary state has d(rho)/dt = 0, so continuity demands div j = 0.
    # The payload carries the measured residual instead of asserting quality.
    payload = build_current_field(2, 1, 1, basis=BasisKind.COMPLEX, seed_count=16)
    assert payload.continuity_residual < 1e-3


def test_real_basis_current_field_is_empty_and_says_why() -> None:
    payload = build_current_field(2, 1, 1, basis=BasisKind.REAL, seed_count=16)

    assert payload.lines == []
    assert payload.max_speed == 0.0
    assert any("real" in warning.lower() for warning in payload.metadata.warnings)


def test_opposite_m_have_identical_density_but_mirrored_flow() -> None:
    # The teaching point of docs/concepts/probability-current.md: |psi|^2 cannot
    # tell +m from -m, and the current can.
    forward = build_current_field(3, 2, 2, basis=BasisKind.COMPLEX, seed_count=16)
    reverse = build_current_field(3, 2, -2, basis=BasisKind.COMPLEX, seed_count=16)

    assert len(forward.lines) == len(reverse.lines)
    assert forward.max_speed == pytest.approx(reverse.max_speed, rel=1e-12)
    first = np.asarray(forward.lines[0])
    mirrored = np.asarray(reverse.lines[0]) * np.asarray([1.0, -1.0, 1.0])
    assert first == pytest.approx(mirrored, abs=1e-9)


def test_seeds_avoid_the_negligible_density_region() -> None:
    payload = build_current_field(2, 1, 1, basis=BasisKind.COMPLEX, seed_count=32)
    starts = np.asarray([line[0] for line in payload.lines])
    radius, polar, azimuth = cartesian_to_spherical(starts[:, 0], starts[:, 1], starts[:, 2])
    density = probability_density(
        hydrogenic_wavefunction(2, 1, 1, radius, polar, azimuth, basis=BasisKind.COMPLEX)
    )

    assert np.all(density > payload.seed_density_floor)
    assert np.all(radius < payload.extent_bohr)


def test_current_field_metadata_describes_streamlines_not_a_density_surface() -> None:
    # Caught by browser verification: the metadata inherited the isosurface's
    # wording, so the Scene Contract panel claimed the picture was a density
    # level set coloured by wavefunction phase. It is neither. Metadata that
    # misdescribes the asset defeats the entire point of the contract.
    payload = build_current_field(3, 2, 2, basis=BasisKind.COMPLEX, seed_count=8)
    geometry = payload.metadata.geometry_semantics
    color = payload.metadata.color_semantics

    assert "level set" not in geometry
    assert "streamline" in geometry.lower()
    assert "phase" not in color.lower()
    assert "speed" in color.lower()
    # docs/concepts/probability-current.md requires the disclaimer to be
    # carried by the asset itself, not left to the reader.
    assert "not electron trajectories" in geometry
