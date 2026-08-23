"""Observable fields derived from quantum states."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import hydrogenic_wavefunction

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
