"""Hydrogenic orbitals in explicit, tested conventions.

Coordinates are reported in ordinary Bohr radii. ``a_mu=m_e/mu`` is the
dimensionless reduced-Bohr-radius scale in those units; changing it rescales
the wavefunction and its reciprocal rescales energy. The angular convention
follows :func:`scipy.special.sph_harm_y`: ``theta`` is polar/colatitudinal and
``phi`` is azimuthal.
"""

from __future__ import annotations

from decimal import Decimal, localcontext
from math import factorial, pi
from numbers import Integral

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import eval_genlaguerre, gammaln, roots_genlaguerre, sph_harm_y

from quviz.conventions import BasisKind

type FloatArray = NDArray[np.float64]
type ComplexArray = NDArray[np.complex128]

_DECIMAL_FALLBACK_PRECISION = 100
_FLOAT64_DIRECT_LOWER_BOUND = float(np.finfo(np.float64).tiny)
_FLOAT64_DIRECT_UPPER_BOUND = float(np.finfo(np.float64).max / 2.0)


def _validate_angular_quantum_numbers(l: int, m: int) -> None:
    """Validate the integer domain of a spherical harmonic."""

    if isinstance(l, bool) or not isinstance(l, Integral) or l < 0:
        raise ValueError("l must be a non-negative integer")
    if isinstance(m, bool) or not isinstance(m, Integral) or abs(m) > l:
        raise ValueError("m must be an integer satisfying |m| <= l")


def validate_quantum_numbers(n: int, l: int, m: int) -> None:
    """Validate the hydrogenic quantum-number domain."""

    if isinstance(n, bool) or not isinstance(n, Integral) or n < 1:
        raise ValueError("n must be a positive integer")
    if isinstance(l, bool) or not isinstance(l, Integral) or l < 0 or l >= n:
        raise ValueError("l must be an integer satisfying 0 <= l < n")
    if isinstance(m, bool) or not isinstance(m, Integral) or abs(m) > l:
        raise ValueError("m must be an integer satisfying |m| <= l")


def hydrogenic_energy_hartree(n: int, *, z: float = 1.0, reduced_mass_ratio: float = 1.0) -> float:
    r"""Return the nonrelativistic Coulomb energy in Hartree units.

    ``reduced_mass_ratio`` is :math:`\mu/m_e`; it is one in the infinite-nuclear-
    mass approximation.
    """

    validate_quantum_numbers(n, 0, 0)
    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if reduced_mass_ratio <= 0.0 or not np.isfinite(reduced_mass_ratio):
        raise ValueError("reduced_mass_ratio must be positive and finite")
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
    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if a_mu <= 0.0 or not np.isfinite(a_mu):
        raise ValueError("a_mu must be positive and finite")
    z_value = float(z)
    a_mu_value = float(a_mu)

    radius = np.asarray(r, dtype=np.float64)
    if not np.all(np.isfinite(radius)):
        raise ValueError("r must contain only finite values")
    if np.any(radius < 0.0):
        raise ValueError("r must be non-negative")

    with np.errstate(over="ignore", under="ignore", invalid="ignore", divide="ignore"):
        direct_rho = np.asarray(2.0 * z_value * radius / (n * a_mu_value), dtype=np.float64)
    if np.all(np.isfinite(direct_rho)):
        rho = direct_rho
    else:
        # The requested ratio can be perfectly ordinary even when ``2*z`` or
        # ``n*a_mu`` overflows first. Re-evaluate only the affected extreme
        # path without changing the operation order of established payloads.
        with localcontext() as context:
            context.prec = _DECIMAL_FALLBACK_PRECISION
            decimal_rho_scale = (
                Decimal(2)
                * Decimal.from_float(z_value)
                / (Decimal(n) * Decimal.from_float(a_mu_value))
            )
            decimal_rho = [
                decimal_rho_scale * Decimal.from_float(float(value)) for value in radius.flat
            ]
        try:
            rho = np.asarray([float(value) for value in decimal_rho], dtype=np.float64).reshape(
                radius.shape
            )
        except OverflowError as error:
            raise ValueError(
                "radial coordinate scale cannot be represented in float64 for the supplied radii"
            ) from error
        if not np.all(np.isfinite(rho)):
            raise ValueError(
                "radial coordinate scale cannot be represented in float64 for the supplied radii"
            )
    log_factorial_ratio = gammaln(n - l) - gammaln(n + l + 1)
    # Preserve the established arithmetic (and therefore committed payload
    # bytes) whenever all of its intermediates are representable.
    try:
        direct_normalization = (2.0 * z_value / (n * a_mu_value)) ** 1.5 * np.exp(
            0.5 * (log_factorial_ratio - np.log(2.0 * n))
        )
    except OverflowError:
        direct_normalization = float("inf")
    if (
        np.isfinite(direct_normalization)
        and _FLOAT64_DIRECT_LOWER_BOUND <= direct_normalization <= _FLOAT64_DIRECT_UPPER_BOUND
    ):
        normalization = float(direct_normalization)
    else:
        # A float64 intermediate can overflow or underflow even when the
        # complete expression rounds to a representable value.  Decimal is
        # used only on that exceptional path; unlike a log-space predicate it
        # also makes the decision correctly at the two float64 boundaries.
        with localcontext() as context:
            context.prec = _DECIMAL_FALLBACK_PRECISION
            decimal_scale = (
                Decimal(2)
                * Decimal.from_float(z_value)
                / (Decimal(n) * Decimal.from_float(a_mu_value))
            )
            decimal_factorial_ratio = Decimal(factorial(n - l - 1)) / (
                Decimal(2 * n) * Decimal(factorial(n + l))
            )
            decimal_normalization = decimal_scale * (decimal_scale * decimal_factorial_ratio).sqrt()
        try:
            normalization = float(decimal_normalization)
        except OverflowError:
            normalization = float("inf")
        if not np.isfinite(normalization) or normalization <= 0.0:
            raise ValueError(
                "radial wavefunction normalization cannot be represented in float64 "
                f"for z={z:.6g}, a_mu={a_mu:.6g}"
            )
    polynomial = eval_genlaguerre(n - l - 1, 2 * l + 1, rho)
    result = np.asarray(
        normalization * np.exp(-rho / 2.0) * np.power(rho, l) * polynomial,
        dtype=np.float64,
    )
    if not np.all(np.isfinite(result)):
        raise ValueError(
            "radial wavefunction values cannot be represented in float64 for the supplied radii"
        )
    return result


def radial_node_radii(
    n: int,
    l: int,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
) -> FloatArray:
    r"""Return every positive radial node in increasing order, in Bohr radii.

    The nodes are the roots of :math:`L_{n-\ell-1}^{2\ell+1}(\rho)` with
    :math:`\rho=2Zr/(na_\mu)`.  Keeping this scale information next to the
    wavefunction formula lets render-grid validation distinguish the compact
    innermost oscillation from the much larger :math:`n^2a_\mu/Z` support.
    """

    validate_quantum_numbers(n, l, 0)
    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if a_mu <= 0.0 or not np.isfinite(a_mu):
        raise ValueError("a_mu must be positive and finite")
    z_value = float(z)
    a_mu_value = float(a_mu)

    node_count = n - l - 1
    if node_count == 0:
        return np.empty(0, dtype=np.float64)
    dimensionless_nodes, _ = roots_genlaguerre(node_count, 2 * l + 1)
    with np.errstate(over="ignore", under="ignore", invalid="ignore", divide="ignore"):
        direct_nodes = np.asarray(
            dimensionless_nodes * n * a_mu_value / (2.0 * z_value), dtype=np.float64
        )
    if (
        np.all(np.isfinite(direct_nodes))
        and np.all(direct_nodes >= _FLOAT64_DIRECT_LOWER_BOUND)
        and np.all(direct_nodes <= _FLOAT64_DIRECT_UPPER_BOUND)
    ):
        # Retain the established operation order for ordinary inputs so
        # committed scientific payloads remain byte-for-byte stable.
        return direct_nodes

    with localcontext() as context:
        context.prec = _DECIMAL_FALLBACK_PRECISION
        decimal_scale = (
            Decimal(n) * Decimal.from_float(a_mu_value) / (Decimal(2) * Decimal.from_float(z_value))
        )
        decimal_nodes = [
            Decimal.from_float(float(node)) * decimal_scale for node in dimensionless_nodes
        ]
    try:
        nodes = np.asarray([float(node) for node in decimal_nodes], dtype=np.float64)
    except OverflowError as error:
        raise ValueError(
            f"radial node radii cannot be represented in float64 for z={z:.6g}, a_mu={a_mu:.6g}"
        ) from error
    if not np.all(np.isfinite(nodes)) or not np.all(nodes > 0.0):
        raise ValueError(
            f"radial node radii cannot be represented in float64 for z={z:.6g}, a_mu={a_mu:.6g}"
        )
    return nodes


def complex_spherical_harmonic(
    l: int,
    m: int,
    theta: ArrayLike,
    phi: ArrayLike,
) -> ComplexArray:
    r"""Evaluate the standard complex spherical harmonic :math:`Y_\ell^m`."""

    _validate_angular_quantum_numbers(l, m)
    theta_array = np.asarray(theta, dtype=np.float64)
    phi_array = np.asarray(phi, dtype=np.float64)
    if not np.all(np.isfinite(theta_array)):
        raise ValueError("theta must contain only finite values")
    if not np.all(np.isfinite(phi_array)):
        raise ValueError("phi must contain only finite values")
    if np.any((theta_array < 0.0) | (theta_array > pi)):
        raise ValueError("theta must lie in the polar range [0, pi]")
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

    _validate_angular_quantum_numbers(l, m)
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
