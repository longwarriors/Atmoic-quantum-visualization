"""Observable fields derived from quantum states."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import roots_legendre

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import (
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    radial_wavefunction,
    validate_quantum_numbers,
)

type FloatArray = NDArray[np.float64]


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
    reduced_mass_atomic_units: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    density_floor: float = 1e-14,
) -> FloatArray:
    r"""Return the stationary hydrogenic probability current in Cartesian form.

    In atomic units and the complex :math:`Y_\ell^m` basis,

    .. math::

       \mathbf j = \frac{m}{\mu r\sin\theta}|\psi|^2\,\mathbf e_\phi.

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
    if reduced_mass_atomic_units <= 0.0:
        raise ValueError("reduced_mass_atomic_units must be positive")

    psi = hydrogenic_wavefunction(
        n, l, m, r_array, theta_array, phi_array, z=z, a_mu=a_mu, basis=basis_kind
    )
    density = probability_density(psi)
    denominator = reduced_mass_atomic_units * r_array * np.sin(theta_array)
    safe = (np.abs(denominator) > 1e-12) & (density > density_floor)
    j_phi = np.zeros_like(density)
    np.divide(m * density, denominator, out=j_phi, where=safe)
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

    The quadrature domain is validated: if it fails to capture unit norm the
    function raises instead of silently returning a truncated expectation.
    """

    validate_quantum_numbers(n, l, 0)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if a_mu <= 0.0:
        raise ValueError("a_mu must be positive")
    if power <= -3:
        raise ValueError("power must be greater than -3 for a convergent integral")

    r_max = max(30.0 * n * n * a_mu / z, 40.0 * a_mu / z)
    nodes, weights = roots_legendre(quadrature_nodes)
    radius = 0.5 * r_max * (np.asarray(nodes, dtype=np.float64) + 1.0)
    quadrature = 0.5 * r_max * np.asarray(weights, dtype=np.float64)

    radial = radial_wavefunction(n, l, radius, z=z, a_mu=a_mu)
    measure = quadrature * radius * radius * radial * radial
    norm = float(np.sum(measure))
    if abs(norm - 1.0) > 1e-9:
        raise RuntimeError(
            f"radial quadrature captured norm {norm:.12f}; widen the domain or add nodes"
        )
    return float(np.sum(measure * np.power(radius, power)) / norm)


def radial_hamiltonian_residual(
    n: int,
    l: int,
    r: ArrayLike,
    *,
    z: float = 1.0,
    step: float = 1e-4,
) -> tuple[FloatArray, float]:
    r"""Return the reduced-radial eigenvalue residual and its energy scale.

    With :math:`u=rR_{n\ell}` the radial equation in atomic units is

    .. math::

       -\tfrac12 u''+\left[\frac{\ell(\ell+1)}{2r^2}-\frac{Z}{r}\right]u=Eu.

    The second derivative is taken by central differences on :math:`u` itself,
    so the check is independent of the closed form used to build ``R``. The
    returned scale is :math:`\max|Eu|`, which makes the residual tolerance
    dimensionless.
    """

    validate_quantum_numbers(n, l, 0)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if step <= 0.0:
        raise ValueError("step must be positive")

    radius = np.asarray(r, dtype=np.float64)
    if np.any(radius - step <= 0.0):
        raise ValueError("r must exceed step so the central difference stays in the domain")

    def reduced(values: FloatArray) -> FloatArray:
        return np.asarray(values * radial_wavefunction(n, l, values, z=z), dtype=np.float64)

    u_here = reduced(radius)
    second_derivative = (reduced(radius + step) - 2.0 * u_here + reduced(radius - step)) / step**2
    effective = l * (l + 1) / (2.0 * radius * radius) - z / radius
    energy = hydrogenic_energy_hartree(n, z=z)

    residual = -0.5 * second_derivative + effective * u_here - energy * u_here
    return np.asarray(residual, dtype=np.float64), float(np.max(np.abs(energy * u_here)))
