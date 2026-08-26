"""Auditable finite-box probability-mass diagnostics.

The render grid and the physical finite box are deliberately kept separate.
The former is a quadrature rule; the latter is a subregion of an analytically
normalised state.  Confusing them can make a grid alias look like probability
non-conservation.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache
from math import comb, exp, factorial, fsum, sqrt
from typing import Literal

import numpy as np

from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    hydrogenic_wavefunction,
)
from quviz.physics.superposition import SuperpositionState

type FiniteGridMassStatus = Literal[
    "no_error_above_tolerance_proven",
    "phase_dependent_quadrature_error",
    "time_invariant_quadrature_error",
    "quadrature_error_at_reported_time",
]


@dataclass(frozen=True, slots=True)
class FiniteGridMassDiagnostic:
    """Bounds that distinguish box truncation from render-grid quadrature."""

    tail_mass_upper_bound: float
    box_mass_variation_upper_bound: float
    phase_variation_bound: float
    aliasing_variation_lower_bound: float
    mass_error_lower_bound: float
    reporting_tolerance: float
    status: FiniteGridMassStatus


def _simpson_weights_3d(resolution: int, spacing: float) -> np.ndarray:
    axis_weights = np.ones(resolution, dtype=np.float64)
    axis_weights[1:-1:2] = 4.0
    axis_weights[2:-1:2] = 2.0
    axis_weights *= spacing / 3.0
    return axis_weights[:, None, None] * axis_weights[None, :, None] * axis_weights[None, None, :]


@lru_cache(maxsize=128)
def _component_radial_tail(
    n: int,
    l: int,
    z: float,
    a_mu: float,
    extent: float,
) -> float:
    """Evaluate the analytic polynomial--exponential radial tail.

    Squaring the finite generalized-Laguerre polynomial reduces the integral
    to a finite sum of upper incomplete gamma functions of integer order.  The
    latter use their terminating exponential series, so no numerical
    quadrature or unverified quadrature-error estimate enters the bound.
    """

    polynomial_order = n - l - 1
    alpha = 2 * l + 1
    coefficients = [
        Fraction(
            (-1) ** index * comb(polynomial_order + alpha, polynomial_order - index),
            factorial(index),
        )
        for index in range(polynomial_order + 1)
    ]
    squared = [Fraction(0) for _ in range(2 * polynomial_order + 1)]
    for first, first_coefficient in enumerate(coefficients):
        for second, second_coefficient in enumerate(coefficients):
            squared[first + second] += first_coefficient * second_coefficient

    rho = 2.0 * z * extent / (n * a_mu)
    normalization = Fraction(factorial(polynomial_order), 2 * n * factorial(n + l))
    terms: list[float] = []
    for power, coefficient in enumerate(squared):
        order = 2 * l + 3 + power
        series_terms = [1.0]
        running = 1.0
        for index in range(1, order):
            running *= rho / index
            series_terms.append(running)
        upper_gamma = factorial(order - 1) * exp(-rho) * fsum(series_terms)
        terms.append(float(normalization * coefficient) * upper_gamma)

    tail = fsum(terms)
    rounding_allowance = 256.0 * np.finfo(np.float64).eps * fsum(abs(term) for term in terms)
    upper = min(1.0, max(0.0, tail + rounding_allowance))
    return 1.0 if upper == 1.0 else float(np.nextafter(upper, np.inf))


def _component_tails(state: SuperpositionState, extent: float) -> tuple[float, ...]:
    return tuple(
        _component_radial_tail(term.n, term.l, state.z, state.a_mu, extent) for term in state.terms
    )


def finite_box_tail_mass_upper_bound(state: SuperpositionState, extent: float) -> float:
    r"""Return a conservative analytic upper bound outside the cube.

    The cube ``[-extent, extent]^3`` contains the sphere of radius ``extent``.
    The triangle inequality in :math:`L^2` therefore gives

    .. math::

       P(\mathbb R^3\setminus B) \le
       \left(\sum_k |c_k|\sqrt{P_k(r>R)}\right)^2.
    """

    if extent <= 0.0 or not np.isfinite(extent):
        raise ValueError("extent must be finite and positive")

    root_bound = sum(
        abs(term.coefficient) * sqrt(tail)
        for term, tail in zip(state.terms, _component_tails(state, extent), strict=True)
    )
    return min(1.0, root_bound * root_bound)


def finite_grid_mass_diagnostic(
    state: SuperpositionState,
    *,
    extent: float,
    resolution: int,
    integrated_mass: float,
    reporting_tolerance: float = 0.002,
) -> FiniteGridMassDiagnostic:
    """Measure phase-sensitive grid aliasing and bound the physical box error.

    Equal energy gaps are first added coherently in the off-diagonal Gram
    matrix. ``phase_variation_bound`` is then a peak-to-peak upper envelope on
    the *render grid*. ``box_mass_variation_upper_bound`` comes independently
    from component tails and parity, while
    ``aliasing_variation_lower_bound`` proves that at least one Fourier mode of
    the grid error varies by the reported amount.  This separates numerical
    aliasing from genuine probability flux through the finite-box boundary.
    """

    if resolution < 3 or resolution % 2 == 0:
        raise ValueError("resolution must be an odd integer of at least three")
    if extent <= 0.0 or not np.isfinite(extent):
        raise ValueError("extent must be finite and positive")
    if not np.isfinite(integrated_mass) or integrated_mass <= 0.0:
        raise ValueError("integrated_mass must be finite and positive")
    if reporting_tolerance <= 0.0 or not np.isfinite(reporting_tolerance):
        raise ValueError("reporting_tolerance must be finite and positive")

    axis = np.linspace(-extent, extent, resolution, dtype=np.float64)
    spacing = float(axis[1] - axis[0])
    x, y, z_coord = np.meshgrid(axis, axis, axis, indexing="ij")
    spherical = cartesian_to_spherical(x, y, z_coord)
    weights = _simpson_weights_3d(resolution, spacing)

    components = [
        np.asarray(
            hydrogenic_wavefunction(
                term.n,
                term.l,
                term.m,
                *spherical,
                z=state.z,
                a_mu=state.a_mu,
                basis=state.basis,
            ),
            dtype=np.complex128,
        )
        for term in state.terms
    ]

    grid_modes: dict[Fraction, complex] = {}
    box_mode_bounds: dict[Fraction, float] = {}
    all_time_dependent_pairs_have_odd_parity = True
    energies = state.energies
    tails = _component_tails(state, extent)
    for first in range(len(state.terms)):
        for second in range(first + 1, len(state.terms)):
            if energies[first] == energies[second]:
                continue
            first_n = state.terms[first].n
            second_n = state.terms[second].n
            gap_key = abs(Fraction(1, first_n * first_n) - Fraction(1, second_n * second_n))

            if energies[first] < energies[second]:
                lower, higher = first, second
            else:
                lower, higher = second, first
            overlap = complex(np.sum(np.conj(components[lower]) * components[higher] * weights))
            coefficient = np.conj(state.terms[lower].coefficient) * state.terms[higher].coefficient
            grid_modes[gap_key] = grid_modes.get(gap_key, 0.0j) + coefficient * overlap

            # Opposite-parity products integrate to exactly zero on a centered
            # cube.  Otherwise full-space orthogonality plus Cauchy--Schwarz on
            # the exterior bounds the true cube overlap by the spherical tails.
            if (state.terms[lower].l + state.terms[higher].l) % 2:
                overlap_bound = 0.0
            else:
                overlap_bound = sqrt(tails[lower] * tails[higher])
                all_time_dependent_pairs_have_odd_parity = False
            pair_bound = abs(coefficient) * overlap_bound
            box_mode_bounds[gap_key] = box_mode_bounds.get(gap_key, 0.0) + pair_bound

    phase_variation = 4.0 * sum(abs(amplitude) for amplitude in grid_modes.values())
    box_variation = 4.0 * sum(box_mode_bounds.values())
    # If |A_grid| exceeds every physically possible |A_box| for a Fourier
    # mode, the reverse triangle inequality proves a non-zero grid-error mode.
    # Any real periodic function has range at least twice the magnitude of one
    # of its complex Fourier coefficients.
    aliasing_variation = 2.0 * max(
        (
            max(0.0, abs(amplitude) - box_mode_bounds.get(key, 0.0))
            for key, amplitude in grid_modes.items()
        ),
        default=0.0,
    )

    tail_bound = finite_box_tail_mass_upper_bound(state, extent)
    physical_interval_low = 1.0 - tail_bound
    mass_error_lower = max(0.0, integrated_mass - 1.0, physical_interval_low - integrated_mass)

    status: FiniteGridMassStatus
    if aliasing_variation > reporting_tolerance:
        status = "phase_dependent_quadrature_error"
    elif mass_error_lower > reporting_tolerance:
        status = (
            "time_invariant_quadrature_error"
            if all_time_dependent_pairs_have_odd_parity
            else "quadrature_error_at_reported_time"
        )
    else:
        # These diagnostics provide lower bounds on render-grid errors, not a
        # two-sided quadrature certificate.  Falling below the reporting
        # threshold therefore means only that no above-threshold error was
        # proved; it must not be reported as a proved-accurate grid.
        status = "no_error_above_tolerance_proven"

    return FiniteGridMassDiagnostic(
        tail_mass_upper_bound=float(tail_bound),
        box_mass_variation_upper_bound=float(box_variation),
        phase_variation_bound=float(phase_variation),
        aliasing_variation_lower_bound=float(aliasing_variation),
        mass_error_lower_bound=float(mass_error_lower),
        reporting_tolerance=float(reporting_tolerance),
        status=status,
    )
