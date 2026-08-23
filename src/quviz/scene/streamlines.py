r"""Probability-flow streamlines.

A streamline of the probability current is an integral curve of

.. math::

   \mathbf v=\frac{\mathbf j}{\rho},

parameterised by arc length so that rendered vertices are evenly spaced no
matter how fast the flow is. Speed is carried as a separate per-vertex scalar
rather than being baked into the spacing, keeping geometry and magnitude
independent the way ``docs/concepts/semantics.md`` requires.

These are **probability-flow** lines, not electron trajectories. Only under an
explicitly Bohmian reading may they be given trajectory ontology; see
``docs/concepts/probability-current.md``.

A velocity field maps ``(N, 3)`` positions to ``(N, 3)`` velocities, and whole
bundles of streamlines advance in lockstep. That is not incidental: evaluating
one point at a time spends all its time in per-call SciPy overhead, and the
numerical fields planned for M1 will be grid-interpolated, which is also
naturally batched.

The integrator takes an arbitrary velocity callable so the analytic stationary
case and those later numerical states share one implementation.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    hydrogenic_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.observables import probability_current_hydrogenic, probability_density

FloatArray = NDArray[np.float64]
VelocityField = Callable[[FloatArray], FloatArray]


@dataclass(frozen=True, slots=True)
class Streamline:
    """An arc-length sampled integral curve with per-vertex flow speed."""

    vertices: FloatArray
    speed: FloatArray


def hydrogenic_flow_velocity(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    reduced_mass_atomic_units: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    density_floor: float = 1e-14,
) -> VelocityField:
    r"""Return a batched :math:`\mathbf v=\mathbf j/\rho` for one hydrogenic state.

    The density cancels analytically, so the speed depends only on geometry,
    but the quotient is still formed from the masked current so that the nodal
    surfaces and the polar axis stay masked instead of producing infinities.
    """

    validate_quantum_numbers(n, l, m)
    basis_kind = BasisKind(basis)

    def velocity(points: FloatArray) -> FloatArray:
        position = np.atleast_2d(np.asarray(points, dtype=np.float64))
        radius, polar, azimuth = cartesian_to_spherical(
            position[:, 0], position[:, 1], position[:, 2]
        )
        current = probability_current_hydrogenic(
            n,
            l,
            m,
            radius,
            polar,
            azimuth,
            z=z,
            a_mu=a_mu,
            reduced_mass_atomic_units=reduced_mass_atomic_units,
            basis=basis_kind,
            density_floor=density_floor,
        )
        psi = hydrogenic_wavefunction(
            n, l, m, radius, polar, azimuth, z=z, a_mu=a_mu, basis=basis_kind
        )
        density = probability_density(psi)
        result = np.zeros_like(current)
        live = density > density_floor
        np.divide(current, density[:, None], out=result, where=live[:, None])
        return np.asarray(result, dtype=np.float64)

    return velocity


def _unit_directions(
    velocity: VelocityField, points: FloatArray, speed_floor: float
) -> tuple[FloatArray, FloatArray]:
    values = np.asarray(velocity(points), dtype=np.float64)
    magnitude = np.linalg.norm(values, axis=1)
    usable = np.isfinite(magnitude) & (magnitude > speed_floor)
    directions = np.zeros_like(values)
    np.divide(values, magnitude[:, None], out=directions, where=usable[:, None])
    return directions, np.where(usable, magnitude, 0.0)


def integrate_streamlines(
    velocity: VelocityField,
    seeds: FloatArray,
    *,
    arc_step: float,
    max_points: int,
    speed_floor: float = 1e-12,
    close_tolerance: float | None = None,
) -> list[Streamline]:
    """Integrate a bundle of streamlines with classical RK4 in arc length.

    Advancing along the *unit* direction makes ``arc_step`` a true geometric
    spacing. A line stops where the field vanishes or is masked, which is what
    keeps nodal surfaces and the polar axis from producing NaN vertices.

    ``close_tolerance`` retires a closed orbit once it returns to its seed.
    Every stationary hydrogenic streamline does close, but the test is
    geometric rather than assumed, so a field that does not close simply runs
    to ``max_points``.
    """

    if arc_step <= 0.0:
        raise ValueError("arc_step must be positive")
    if max_points < 1:
        raise ValueError("max_points must be at least one")

    position = np.atleast_2d(np.asarray(seeds, dtype=np.float64)).copy()
    count = position.shape[0]
    _, speed = _unit_directions(velocity, position, speed_floor)

    vertices: list[list[FloatArray]] = [[position[i].copy()] for i in range(count)]
    speeds: list[list[float]] = [[float(speed[i])] for i in range(count)]
    active = speed > speed_floor

    for _ in range(max_points - 1):
        if not active.any():
            break
        k1, _ = _unit_directions(velocity, position, speed_floor)
        k2, _ = _unit_directions(velocity, position + 0.5 * arc_step * k1, speed_floor)
        k3, _ = _unit_directions(velocity, position + 0.5 * arc_step * k2, speed_floor)
        k4, _ = _unit_directions(velocity, position + arc_step * k3, speed_floor)
        increment = (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0

        stalled = ~np.any(increment, axis=1)
        active &= ~stalled
        candidate = position + arc_step * increment
        _, magnitude = _unit_directions(velocity, candidate, speed_floor)
        active &= magnitude > speed_floor

        for index in np.flatnonzero(active):
            position[index] = candidate[index]
            vertices[index].append(candidate[index].copy())
            speeds[index].append(float(magnitude[index]))
            if (
                close_tolerance is not None
                and len(vertices[index]) > 3
                and float(np.linalg.norm(candidate[index] - vertices[index][0])) < close_tolerance
            ):
                active[index] = False

    return [
        Streamline(
            vertices=np.asarray(vertices[i], dtype=np.float64),
            speed=np.asarray(speeds[i], dtype=np.float64),
        )
        for i in range(count)
    ]


def integrate_streamline(
    velocity: VelocityField,
    seed: FloatArray,
    *,
    arc_step: float,
    max_points: int,
    speed_floor: float = 1e-12,
    close_tolerance: float | None = None,
) -> Streamline:
    """Integrate a single streamline. Thin wrapper over the batched form."""

    return integrate_streamlines(
        velocity,
        np.asarray(seed, dtype=np.float64).reshape(1, 3),
        arc_step=arc_step,
        max_points=max_points,
        speed_floor=speed_floor,
        close_tolerance=close_tolerance,
    )[0]
