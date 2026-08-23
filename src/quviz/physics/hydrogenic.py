"""Hydrogenic orbitals in explicit, tested conventions.

All coordinates are expressed in reduced-Bohr-radius units unless ``a_mu`` is
changed. The angular convention follows :func:`scipy.special.sph_harm_y`:
``theta`` is polar/colatitudinal and ``phi`` is azimuthal.
"""

from __future__ import annotations

from math import pi

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import eval_genlaguerre, gammaln, sph_harm_y

from quviz.conventions import BasisKind

type FloatArray = NDArray[np.float64]
type ComplexArray = NDArray[np.complex128]


def validate_quantum_numbers(n: int, l: int, m: int) -> None:
    """Validate the hydrogenic quantum-number domain."""

    if n < 1:
        raise ValueError("n must be a positive integer")
    if l < 0 or l >= n:
        raise ValueError("l must satisfy 0 <= l < n")
    if abs(m) > l:
        raise ValueError("m must satisfy |m| <= l")


def hydrogenic_energy_hartree(n: int, *, z: float = 1.0, reduced_mass_ratio: float = 1.0) -> float:
    r"""Return the nonrelativistic Coulomb energy in Hartree units.

    ``reduced_mass_ratio`` is :math:`\mu/m_e`; it is one in the infinite-nuclear-
    mass approximation.
    """

    if n < 1:
        raise ValueError("n must be positive")
    if z <= 0.0:
        raise ValueError("z must be positive")
    if reduced_mass_ratio <= 0.0:
        raise ValueError("reduced_mass_ratio must be positive")
    return -0.5 * reduced_mass_ratio * z * z / (n * n)


def radial_wavefunction(
    n: int,
    l: int,
    r: ArrayLike,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
) -> FloatArray:
    r"""Evaluate the normalized hydrogenic radial function :math:`R_{n\ell}(r)`.

    The implemented expression is

    .. math::

       R_{n\ell}(r)=\left(\frac{2Z}{na_\mu}\right)^{3/2}
       \sqrt{\frac{(n-\ell-1)!}{2n(n+\ell)!}}
       e^{-\rho/2}\rho^\ell L_{n-\ell-1}^{2\ell+1}(\rho),
       \quad \rho=\frac{2Zr}{na_\mu}.
    """

    validate_quantum_numbers(n, l, 0)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if a_mu <= 0.0:
        raise ValueError("a_mu must be positive")

    radius = np.asarray(r, dtype=np.float64)
    if np.any(radius < 0.0):
        raise ValueError("r must be non-negative")

    rho = 2.0 * z * radius / (n * a_mu)
    log_factorial_ratio = gammaln(n - l) - gammaln(n + l + 1)
    normalization = (2.0 * z / (n * a_mu)) ** 1.5 * np.exp(
        0.5 * (log_factorial_ratio - np.log(2.0 * n))
    )
    polynomial = eval_genlaguerre(n - l - 1, 2 * l + 1, rho)
    return np.asarray(
        normalization * np.exp(-rho / 2.0) * np.power(rho, l) * polynomial,
        dtype=np.float64,
    )


def complex_spherical_harmonic(
    l: int,
    m: int,
    theta: ArrayLike,
    phi: ArrayLike,
) -> ComplexArray:
    r"""Evaluate the standard complex spherical harmonic :math:`Y_\ell^m`."""

    if l < 0 or abs(m) > l:
        raise ValueError("spherical harmonic requires l >= 0 and |m| <= l")
    theta_array = np.asarray(theta, dtype=np.float64)
    phi_array = np.asarray(phi, dtype=np.float64)
    return np.asarray(sph_harm_y(l, m, theta_array, phi_array), dtype=np.complex128)


def real_spherical_harmonic(
    l: int,
    m: int,
    theta: ArrayLike,
    phi: ArrayLike,
) -> FloatArray:
    r"""Evaluate a real tesseral harmonic.

    QuViz uses the chemistry-friendly convention

    .. math::

       Y_{\ell m}^{\mathrm{real}} =
       \begin{cases}
       \sqrt{2}(-1)^m\operatorname{Re}Y_\ell^m,&m>0,\\
       Y_\ell^0,&m=0,\\
       \sqrt{2}(-1)^m\operatorname{Im}Y_\ell^{|m|},&m<0.
       \end{cases}

    Under SciPy's Condon--Shortley convention this makes ``l=1,m=1`` the
    :math:`p_x` direction and ``l=1,m=-1`` the :math:`p_y` direction.
    """

    if l < 0 or abs(m) > l:
        raise ValueError("spherical harmonic requires l >= 0 and |m| <= l")
    if m == 0:
        return np.asarray(complex_spherical_harmonic(l, 0, theta, phi).real)
    harmonic = complex_spherical_harmonic(l, abs(m), theta, phi)
    factor = np.sqrt(2.0) * ((-1.0) ** m)
    component = harmonic.real if m > 0 else harmonic.imag
    return np.asarray(factor * component, dtype=np.float64)


def hydrogenic_wavefunction(
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
) -> ComplexArray | FloatArray:
    r"""Evaluate :math:`\psi_{n\ell m}=R_{n\ell}Y_\ell^m`."""

    validate_quantum_numbers(n, l, m)
    basis_kind = BasisKind(basis)
    radial = radial_wavefunction(n, l, r, z=z, a_mu=a_mu)
    angular = (
        complex_spherical_harmonic(l, m, theta, phi)
        if basis_kind is BasisKind.COMPLEX
        else real_spherical_harmonic(l, m, theta, phi)
    )
    values = radial * angular
    if basis_kind is BasisKind.COMPLEX:
        return np.asarray(values, dtype=np.complex128)
    return np.asarray(values, dtype=np.float64)


def cartesian_to_spherical(
    x: ArrayLike,
    y: ArrayLike,
    z_coord: ArrayLike,
) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Convert Cartesian coordinates to ``(r, theta, phi)``.

    At the origin ``theta`` and ``phi`` are set to zero because angular values
    are physically irrelevant there.
    """

    x_array = np.asarray(x, dtype=np.float64)
    y_array = np.asarray(y, dtype=np.float64)
    z_array = np.asarray(z_coord, dtype=np.float64)
    radius = np.sqrt(x_array * x_array + y_array * y_array + z_array * z_array)
    safe_radius = np.where(radius > 0.0, radius, 1.0)
    theta = np.arccos(np.clip(z_array / safe_radius, -1.0, 1.0))
    phi = np.mod(np.arctan2(y_array, x_array), 2.0 * pi)
    theta = np.where(radius > 0.0, theta, 0.0)
    phi = np.where(radius > 0.0, phi, 0.0)
    return radius, theta, phi


def orbital_label(n: int, l: int, m: int, *, basis: BasisKind | str = BasisKind.COMPLEX) -> str:
    """Return a compact human-readable orbital label."""

    validate_quantum_numbers(n, l, m)
    letters = "spdfghiklmnoqrtuvwxyz"
    shell = letters[l] if l < len(letters) else f"l{l}"
    basis_kind = BasisKind(basis)
    if basis_kind is BasisKind.REAL and l == 1:
        suffix = {1: "x", -1: "y", 0: "z"}[m]
        return f"{n}p{suffix}"
    if basis_kind is BasisKind.REAL and l == 2:
        suffix = {2: "x²-y²", 1: "xz", 0: "z²", -1: "yz", -2: "xy"}[m]
        return f"{n}d({suffix})"
    return f"{n}{shell}, m={m}"
