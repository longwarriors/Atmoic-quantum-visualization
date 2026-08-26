"""Observable fields derived from quantum states."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import roots_legendre

from quviz.conventions import BasisKind
from quviz.physics.continuity import state_support_lengths, transition_coherence_scale
from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    radial_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.superposition import SuperpositionState

type FloatArray = NDArray[np.float64]


_RADIAL_MOMENT_NORM_TOLERANCE = 1e-9
_RADIAL_MOMENT_NODE_TOLERANCE = 5e-10
_RADIAL_MOMENT_TAIL_TOLERANCE = 5e-11
_RADIAL_MOMENT_DOMAIN_GROWTH = 1.5
_RADIAL_MOMENT_MAX_EXPANSIONS = 10
_LOG_FLOAT64_MAX = float(np.log(np.finfo(np.float64).max))
_LOG_FLOAT64_MIN = float(np.log(np.nextafter(0.0, 1.0)))


@lru_cache(maxsize=16)
def _legendre_rule(nodes: int) -> tuple[FloatArray, FloatArray]:
    """Cache the dimensionless rules reused by radial convergence checks."""

    roots, weights = roots_legendre(nodes)
    return (
        np.asarray(roots, dtype=np.float64),
        np.asarray(weights, dtype=np.float64),
    )


def _dimensionless_radial_integrals(
    n: int,
    l: int,
    power: int,
    extent: float,
    rule: tuple[FloatArray, FloatArray],
) -> tuple[float, float]:
    """Return the captured norm and log moment on ``[0, extent]``.

    Coordinates are measured in ``a_mu / Z``.  This keeps the quadrature
    finite even when the requested physical scale is close to the limits of a
    float; the exact scale factor is restored only after convergence.
    """

    roots, weights = rule
    radius = 0.5 * extent * (roots + 1.0)
    quadrature = 0.5 * extent * weights
    radial = radial_wavefunction(n, l, radius)
    if not np.all(np.isfinite(radial)):
        raise RuntimeError("radial wavefunction became non-finite during quadrature")

    norm_measure = quadrature * radius * radius * radial * radial
    norm = float(np.sum(norm_measure))

    nonzero = radial != 0.0
    if not np.any(nonzero):
        raise RuntimeError("radial moment quadrature sampled no non-zero integrand")
    log_terms = (
        np.log(quadrature[nonzero])
        + (power + 2) * np.log(radius[nonzero])
        + 2.0 * np.log(np.abs(radial[nonzero]))
    )
    largest_log_term = float(np.max(log_terms))
    # Terms far below the maximum contribute exactly zero at float64
    # precision.  That benign underflow is local and deliberately silenced;
    # callers may run with ``np.errstate(all="raise")`` to catch real leaks.
    with np.errstate(under="ignore"):
        log_moment = largest_log_term + float(np.log(np.sum(np.exp(log_terms - largest_log_term))))
    if not np.isfinite(norm) or not np.isfinite(log_moment):
        raise RuntimeError("radial moment quadrature produced a non-finite intermediate")
    return norm, log_moment


def probability_density(psi: ArrayLike) -> FloatArray:
    r"""Return :math:`|\psi|^2`, the density with respect to physical volume."""

    values = np.asarray(psi)
    return np.asarray(np.abs(values) ** 2, dtype=np.float64)


def phase(psi: ArrayLike) -> FloatArray:
    """Return the principal phase in ``[-pi, pi]``."""

    return np.asarray(np.angle(np.asarray(psi)), dtype=np.float64)


def probability_current_hydrogenic(
    n: int,
    l: int,
    m: int,
    r: ArrayLike,
    theta: ArrayLike,
    phi: ArrayLike,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    density_floor: float = 1e-14,
) -> FloatArray:
    r"""Return the stationary hydrogenic probability current in Cartesian form.

    In atomic units and the complex :math:`Y_\ell^m` basis,

    .. math::

       \mathbf j = \frac{a_\mu m}{r\sin\theta}|\psi|^2\,\mathbf e_\phi,

    where :math:`a_\mu=m_e/\mu` in ordinary-Bohr units.  The same ``a_mu``
    therefore fixes both the orbital's spatial scale and the current prefactor;
    accepting an independent mass here would permit an inconsistent state.

    Real stationary orbitals have zero current. The expression is masked at the
    coordinate singularity and at negligible density.
    """

    basis_kind = BasisKind(basis)
    r_array = np.asarray(r, dtype=np.float64)
    theta_array = np.asarray(theta, dtype=np.float64)
    phi_array = np.asarray(phi, dtype=np.float64)
    broadcast_shape = np.broadcast_shapes(r_array.shape, theta_array.shape, phi_array.shape)
    if basis_kind is BasisKind.REAL or m == 0:
        return np.zeros((*broadcast_shape, 3), dtype=np.float64)
    psi = hydrogenic_wavefunction(
        n, l, m, r_array, theta_array, phi_array, z=z, a_mu=a_mu, basis=basis_kind
    )
    density = probability_density(psi)
    denominator = r_array * np.sin(theta_array)
    coordinate_floor = 1e-12 * a_mu / z
    safe = (np.abs(denominator) > coordinate_floor) & (density > density_floor)
    j_phi = np.zeros_like(density)
    np.divide(a_mu * m * density, denominator, out=j_phi, where=safe)
    e_phi = np.stack((-np.sin(phi_array), np.cos(phi_array), np.zeros_like(phi_array)), axis=-1)
    return np.asarray(j_phi[..., None] * e_phi, dtype=np.float64)


def expectation_radial(
    n: int,
    l: int,
    power: int,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    quadrature_nodes: int = 4_096,
) -> float:
    r"""Return :math:`\langle r^{p}\rangle` for the radial state :math:`R_{n\ell}`.

    The integral

    .. math::

       \langle r^{p}\rangle=\int_0^\infty r^{2+p}|R_{n\ell}(r)|^2\,dr

    is evaluated by Gauss--Legendre quadrature over the implemented radial
    function, not from a table of closed forms, so a wrong Laguerre polynomial
    or a wrong normalization changes the result.

    A captured unit norm is not sufficient evidence for a high-order moment:
    multiplying by ``r**power`` moves its mass into the far tail.  The result
    is therefore returned only after both a half-sized node rule and two
    successive domain expansions agree.  Positive terms are accumulated in
    log space so a representable answer is not lost to an intermediate power
    overflow; an unrepresentable answer raises explicitly.
    """

    validate_quantum_numbers(n, l, 0)
    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if a_mu <= 0.0 or not np.isfinite(a_mu):
        raise ValueError("a_mu must be positive and finite")
    if isinstance(power, bool) or not isinstance(power, (int, np.integer)):
        raise TypeError("power must be an integer")
    if power <= -3:
        raise ValueError("power must be greater than -3 for a convergent integral")
    if (
        isinstance(quadrature_nodes, bool)
        or not isinstance(quadrature_nodes, (int, np.integer))
        or quadrature_nodes < 4
    ):
        raise ValueError("quadrature_nodes must be an integer of at least 4")

    fine_rule = _legendre_rule(int(quadrature_nodes))
    coarse_rule = _legendre_rule(int(quadrature_nodes) // 2)
    extent = max(30.0 * n * n, 40.0)
    scale_log = float(np.log(a_mu) - np.log(z))
    convergence_log = float(np.log1p(_RADIAL_MOMENT_TAIL_TOLERANCE))
    node_convergence_log = float(np.log1p(_RADIAL_MOMENT_NODE_TOLERANCE))
    previous_log_moment: float | None = None
    stable_expansions = 0

    for _ in range(_RADIAL_MOMENT_MAX_EXPANSIONS):
        norm, log_moment = _dimensionless_radial_integrals(n, l, power, extent, fine_rule)
        if abs(norm - 1.0) > _RADIAL_MOMENT_NORM_TOLERANCE:
            raise RuntimeError(
                f"radial quadrature captured norm {norm:.12f}; widen the domain or add nodes"
            )

        coarse_norm, coarse_log_moment = _dimensionless_radial_integrals(
            n, l, power, extent, coarse_rule
        )
        if (
            abs(coarse_norm - norm) > _RADIAL_MOMENT_NORM_TOLERANCE
            or abs(coarse_log_moment - log_moment) > node_convergence_log
        ):
            raise RuntimeError("radial moment failed node refinement; increase quadrature_nodes")

        scaled_partial_log = log_moment + power * scale_log
        if scaled_partial_log > _LOG_FLOAT64_MAX:
            # The integrand is non-negative, so even this finite-domain partial
            # integral proves the full moment cannot fit in float64.
            raise OverflowError("radial moment exceeds the float64 range")

        if (
            previous_log_moment is not None
            and abs(log_moment - previous_log_moment) <= convergence_log
        ):
            stable_expansions += 1
        else:
            stable_expansions = 0

        if stable_expansions >= 2:
            final_log = log_moment - float(np.log(norm)) + power * scale_log
            if final_log > _LOG_FLOAT64_MAX:
                raise OverflowError("radial moment exceeds the float64 range")
            if final_log < _LOG_FLOAT64_MIN:
                raise FloatingPointError("radial moment underflows the float64 range")
            result = float(np.exp(final_log))
            if not np.isfinite(result):
                raise OverflowError("radial moment exceeds the float64 range")
            return result

        previous_log_moment = log_moment
        extent *= _RADIAL_MOMENT_DOMAIN_GROWTH

    raise RuntimeError("radial moment tail failed to converge under finite-domain expansion")


@dataclass(frozen=True, slots=True)
class HamiltonianResidualDiagnostic:
    """Residual plus the finite-difference convergence evidence."""

    residual: FloatArray
    energy_scale: float
    initial_step: float
    final_step: float
    refinements: int
    estimated_relative_difference_error: float


def radial_hamiltonian_diagnostic(
    n: int,
    l: int,
    r: ArrayLike,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    step: float | None = None,
) -> HamiltonianResidualDiagnostic:
    r"""Return the radial residual together with stencil convergence evidence.

    With :math:`u=rR_{n\ell}` the radial equation in atomic units is

    .. math::

       -\frac{a_\mu}{2}u''+
       \left[\frac{a_\mu\ell(\ell+1)}{2r^2}-\frac{Z}{r}\right]u=Eu.

    The second derivative is a five-point central difference on :math:`u`
    itself, Richardson-extrapolated from ``h`` and ``h/2``.  With no explicit
    ``step``, the calculation starts at ``0.16 * n * a_mu / Z`` and halves the
    step until the independent difference estimate is below ``1e-7`` relative
    to :math:`\max|Eu|`.  An explicit step exposes the unadapted Richardson
    result for convergence tests.  The returned scale is :math:`\max|Eu|`,
    keeping the existing residual tolerance dimensionless.
    """

    validate_quantum_numbers(n, l, 0)
    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if a_mu <= 0.0 or not np.isfinite(a_mu):
        raise ValueError("a_mu must be positive and finite")
    if step is not None and (step <= 0.0 or not np.isfinite(step)):
        raise ValueError("step must be positive and finite")

    radius = np.asarray(r, dtype=np.float64)
    if np.any(radius <= 0.0) or not np.all(np.isfinite(radius)):
        raise ValueError("r must be positive and finite")

    adaptive = step is None
    difference_step = 0.16 * n * a_mu / z if step is None else step
    if adaptive:
        # The five-point stencil samples r - 2h.  Near-origin probes should not
        # make the otherwise scale-aware default invalid, so reduce h before
        # starting the convergence loop.
        difference_step = min(difference_step, 0.24 * float(np.min(radius)))
    elif np.any(radius - 2.0 * difference_step <= 0.0):
        raise ValueError(
            "r must exceed step; the five-point central difference requires r > 2 * step"
        )

    def reduced(values: FloatArray) -> FloatArray:
        return np.asarray(
            values * radial_wavefunction(n, l, values, z=z, a_mu=a_mu),
            dtype=np.float64,
        )

    def five_point_second_derivative(h: float) -> FloatArray:
        return np.asarray(
            (
                -reduced(radius + 2.0 * h)
                + 16.0 * reduced(radius + h)
                - 30.0 * reduced(radius)
                + 16.0 * reduced(radius - h)
                - reduced(radius - 2.0 * h)
            )
            / (12.0 * h * h),
            dtype=np.float64,
        )

    u_here = reduced(radius)
    energy = hydrogenic_energy_hartree(n, z=z, reduced_mass_ratio=1.0 / a_mu)
    energy_scale = float(np.max(np.abs(energy * u_here)))
    if not np.isfinite(energy_scale) or energy_scale <= 0.0:
        raise RuntimeError("Hamiltonian residual has no finite non-zero |E u| scale")
    effective = a_mu * l * (l + 1) / (2.0 * radius * radius) - z / radius

    initial_step = difference_step
    for refinement in range(9):
        coarse = five_point_second_derivative(difference_step)
        fine = five_point_second_derivative(0.5 * difference_step)
        second_derivative = (16.0 * fine - coarse) / 15.0
        residual = -0.5 * a_mu * second_derivative + effective * u_here - energy * u_here
        difference_error = float(
            np.max(np.abs(-0.5 * a_mu * (second_derivative - fine))) / energy_scale
        )
        if not adaptive or difference_error <= 1e-7:
            return HamiltonianResidualDiagnostic(
                residual=np.asarray(residual, dtype=np.float64),
                energy_scale=energy_scale,
                initial_step=initial_step,
                final_step=difference_step,
                refinements=refinement,
                estimated_relative_difference_error=difference_error,
            )
        difference_step *= 0.5

    raise RuntimeError(
        "Hamiltonian finite difference did not converge below relative error 1e-7 "
        "after 9 refinements"
    )


def radial_hamiltonian_residual(
    n: int,
    l: int,
    r: ArrayLike,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    step: float | None = None,
) -> tuple[FloatArray, float]:
    """Return the residual and energy scale; see the diagnostic for evidence."""

    diagnostic = radial_hamiltonian_diagnostic(n, l, r, z=z, a_mu=a_mu, step=step)
    return diagnostic.residual, diagnostic.energy_scale


def _spherical_from_cartesian(points: FloatArray) -> tuple[FloatArray, FloatArray, FloatArray]:
    position = np.atleast_2d(np.asarray(points, dtype=np.float64))
    return cartesian_to_spherical(position[:, 0], position[:, 1], position[:, 2])


def superposition_current(
    state: SuperpositionState,
    points: ArrayLike,
    *,
    time: float = 0.0,
    step: float | None = None,
) -> FloatArray:
    r"""Return :math:`\mathbf j=a_\mu\operatorname{Im}(\Psi^*\nabla\Psi)`.

    The gradient is taken by central differences on :math:`\Psi` in Cartesian
    coordinates. That is deliberate: a general superposition has no closed-form
    azimuthal current the way a single eigenstate does, and differencing the
    wavefunction keeps one implementation valid for every state. For a
    one-term superposition it must reproduce
    :func:`probability_current_hydrogenic`, which is gated.
    """

    differential_length, _, _ = state_support_lengths(state)
    difference_step = 1e-5 * differential_length if step is None else step
    if difference_step <= 0.0 or not np.isfinite(difference_step):
        raise ValueError("step must be positive")

    position = np.atleast_2d(np.asarray(points, dtype=np.float64))
    here = state.evaluate(*_spherical_from_cartesian(position), time=time)

    gradient = np.empty((position.shape[0], 3), dtype=np.complex128)
    for axis in range(3):
        offset = np.zeros(3)
        offset[axis] = difference_step
        forward = state.evaluate(*_spherical_from_cartesian(position + offset), time=time)
        backward = state.evaluate(*_spherical_from_cartesian(position - offset), time=time)
        gradient[:, axis] = (forward - backward) / (2.0 * difference_step)

    current = state.a_mu * np.imag(np.conj(here)[:, None] * gradient)
    return np.asarray(current, dtype=np.float64)


def density_time_derivative(
    state: SuperpositionState,
    points: ArrayLike,
    *,
    time: float = 0.0,
) -> FloatArray:
    r"""Return :math:`\partial\rho/\partial t=2\operatorname{Re}(\Psi^*\partial_t\Psi)`.

    Closed form, so the continuity check below measures the current rather than
    the error of a time-difference scheme.
    """

    position = np.atleast_2d(np.asarray(points, dtype=np.float64))
    spherical = _spherical_from_cartesian(position)
    here = state.evaluate(*spherical, time=time)
    rate = state.time_derivative(*spherical, time=time)
    return np.asarray(2.0 * np.real(np.conj(here) * rate), dtype=np.float64)


def continuity_residual(
    state: SuperpositionState,
    points: ArrayLike,
    *,
    time: float = 0.0,
    gradient_step: float | None = None,
    divergence_step: float | None = None,
) -> tuple[FloatArray, float]:
    r"""Return the continuity residual and the scale it should be judged against.

    .. math::

       \frac{\partial\rho}{\partial t}+\nabla\cdot\mathbf j=0.

    The returned scale is a time-independent root-sum-square transition-
    coherence reference: exact equal-energy gaps are grouped coherently, then
    distinct gaps are combined in quadrature.  Unlike the instantaneous
    ``max|d(rho)/dt|``, it remains meaningful
    at a density turning point and scales linearly with a weak active term.
    A genuinely stationary state has no transition scale and returns zero;
    callers must then use a stationary-current scale or explicitly report an
    analytic zero-current case.
    """

    position = np.atleast_2d(np.asarray(points, dtype=np.float64))
    differential_length, _, _ = state_support_lengths(state)
    gradient_difference = 1e-5 * differential_length if gradient_step is None else gradient_step
    divergence_difference = (
        1e-3 * differential_length if divergence_step is None else divergence_step
    )
    if gradient_difference <= 0.0 or not np.isfinite(gradient_difference):
        raise ValueError("gradient_step must be positive and finite")
    if divergence_difference <= 0.0 or not np.isfinite(divergence_difference):
        raise ValueError("divergence_step must be positive and finite")
    divergence = np.zeros(position.shape[0], dtype=np.float64)
    for axis in range(3):
        offset = np.zeros(3)
        offset[axis] = divergence_difference
        forward = superposition_current(
            state,
            position + offset,
            time=time,
            step=gradient_difference,
        )[:, axis]
        backward = superposition_current(
            state,
            position - offset,
            time=time,
            step=gradient_difference,
        )[:, axis]
        divergence += (forward - backward) / (2.0 * divergence_difference)

    rate = density_time_derivative(state, position, time=time)
    coherence = transition_coherence_scale(state, position)
    return np.asarray(rate + divergence, dtype=np.float64), float(np.max(coherence))
