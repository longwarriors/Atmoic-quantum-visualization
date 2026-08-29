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
one point at a time spends all its time in per-call SciPy overhead. The M1
analytic superpositions use the same batched path, and later grid-interpolated
numerical fields will also be naturally batched.

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
from quviz.physics.observables import (
    hydrogenic_density_floor,
    probability_current_hydrogenic,
    probability_density,
)

FloatArray = NDArray[np.float64]
VelocityField = Callable[[FloatArray], FloatArray]
DEFAULT_RELATIVE_SPEED_FLOOR = 1e-12


@dataclass(frozen=True, slots=True)
class Streamline:
    """An arc-length sampled integral curve with per-vertex flow speed."""

    vertices: FloatArray
    speed: FloatArray


def stable_vector_magnitudes(values: FloatArray) -> FloatArray:
    """Return row-wise Euclidean magnitudes without squaring the components.

    ``np.linalg.norm`` forms a sum of squares, so a perfectly representable
    current component near ``1e-163`` can become an exact zero before the square
    root. Repeated ``hypot`` rescales internally and is stable at both ends of
    the float64 range.
    """

    vectors = np.asarray(values, dtype=np.float64)
    if vectors.ndim != 2:
        raise ValueError("vector magnitudes require a two-dimensional array")
    return np.asarray(np.hypot.reduce(np.abs(vectors), axis=1), dtype=np.float64)


def hydrogenic_flow_velocity(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    density_floor: float | None = None,
) -> VelocityField:
    r"""Return a batched :math:`\mathbf v=\mathbf j/\rho` for one hydrogenic state.

    The density cancels analytically, so the speed depends only on geometry,
    but the quotient is still formed from the masked current so that the nodal
    surfaces and the polar axis stay masked instead of producing infinities.
    """

    validate_quantum_numbers(n, l, m)
    basis_kind = BasisKind(basis)
    resolved_density_floor = (
        hydrogenic_density_floor(z=z, a_mu=a_mu) if density_floor is None else float(density_floor)
    )
    if resolved_density_floor < 0.0 or not np.isfinite(resolved_density_floor):
        raise ValueError("density_floor must be non-negative and finite")

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
            basis=basis_kind,
            density_floor=resolved_density_floor,
        )
        psi = hydrogenic_wavefunction(
            n, l, m, radius, polar, azimuth, z=z, a_mu=a_mu, basis=basis_kind
        )
        density = probability_density(psi)
        result = np.zeros_like(current)
        live = density > resolved_density_floor
        np.divide(current, density[:, None], out=result, where=live[:, None])
        return np.asarray(result, dtype=np.float64)

    return velocity


def _unit_directions(
    velocity: VelocityField,
    points: FloatArray,
    speed_floor: float | FloatArray | None,
) -> tuple[FloatArray, FloatArray]:
    values = np.asarray(velocity(points), dtype=np.float64)
    magnitude = stable_vector_magnitudes(values)
    finite = np.isfinite(magnitude)
    if speed_floor is None:
        # Each streamline owns its reference. A slow physical line must not be
        # erased merely because a faster seed happened to share this batch.
        resolved_speed_floor: float | FloatArray = DEFAULT_RELATIVE_SPEED_FLOOR * magnitude
    else:
        resolved_speed_floor = np.asarray(speed_floor, dtype=np.float64)
        if resolved_speed_floor.ndim > 1 or (
            resolved_speed_floor.ndim == 1 and resolved_speed_floor.shape != magnitude.shape
        ):
            raise ValueError("per-line speed_floor must match the number of points")
        if np.any(resolved_speed_floor < 0.0) or not np.all(np.isfinite(resolved_speed_floor)):
            raise ValueError("speed_floor must be non-negative and finite")
    usable = finite & (magnitude > resolved_speed_floor)
    directions = np.zeros_like(values)
    np.divide(values, magnitude[:, None], out=directions, where=usable[:, None])
    return directions, np.where(usable, magnitude, 0.0)


def integrate_streamlines(
    velocity: VelocityField,
    seeds: FloatArray,
    *,
    arc_step: float,
    max_points: int,
    speed_floor: float | None = None,
    close_tolerance: float | None = None,
) -> list[Streamline]:
    """Integrate a bundle of streamlines with classical RK4 in arc length.

    Advancing along the *unit* direction makes ``arc_step`` a true geometric
    spacing. A line stops where the field vanishes or is masked, which is what
    keeps nodal surfaces and the polar axis from producing NaN vertices.

    By default each line fixes its zero-speed cutoff at ``1e-12`` of that
    seed's initial finite speed. It is therefore invariant when the entire
    field is multiplied by a physical scale factor and when unrelated seeds
    are batched, reordered, or split. ``close_tolerance`` retires a closed
    orbit once it returns to its seed.
    Every stationary hydrogenic streamline does close, but the test is
    geometric rather than assumed, so a field that does not close simply runs
    to ``max_points``.
    """

    if arc_step <= 0.0:
        raise ValueError("arc_step must be positive")
    if max_points < 1:
        raise ValueError("max_points must be at least one")
    if speed_floor is not None and (speed_floor < 0.0 or not np.isfinite(speed_floor)):
        raise ValueError("speed_floor must be non-negative and finite")

    position = np.atleast_2d(np.asarray(seeds, dtype=np.float64)).copy()
    count = position.shape[0]
    _, speed = _unit_directions(velocity, position, speed_floor)
    resolved_speed_floor: float | FloatArray = (
        DEFAULT_RELATIVE_SPEED_FLOOR * speed if speed_floor is None else speed_floor
    )

    vertices: list[list[FloatArray]] = [[position[i].copy()] for i in range(count)]
    speeds: list[list[float]] = [[float(speed[i])] for i in range(count)]
    active = speed > 0.0

    for _ in range(max_points - 1):
        if not active.any():
            break
        k1, _ = _unit_directions(velocity, position, resolved_speed_floor)
        k2, _ = _unit_directions(velocity, position + 0.5 * arc_step * k1, resolved_speed_floor)
        k3, _ = _unit_directions(velocity, position + 0.5 * arc_step * k2, resolved_speed_floor)
        k4, _ = _unit_directions(velocity, position + arc_step * k3, resolved_speed_floor)
        increment = (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0

        stalled = ~np.any(increment, axis=1)
        active &= ~stalled
        candidate = position + arc_step * increment
        _, magnitude = _unit_directions(velocity, candidate, resolved_speed_floor)
        active &= magnitude > 0.0

        for index in np.flatnonzero(active):
            position[index] = candidate[index]
            vertices[index].append(candidate[index].copy())
            speeds[index].append(float(magnitude[index]))
            if (
                close_tolerance is not None
                and len(vertices[index]) > 3
                and float(np.hypot.reduce(np.abs(candidate[index] - vertices[index][0])))
                < close_tolerance
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
    speed_floor: float | None = None,
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
