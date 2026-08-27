"""Project-wide physical and rendering conventions.

The point of this module is not convenience. It prevents coordinate, phase,
unit, and observable conventions from becoming implicit implementation details.
"""

from enum import StrEnum


class BasisKind(StrEnum):
    """Angular basis used to represent hydrogenic states."""

    COMPLEX = "complex"
    REAL = "real"


class ObservableKind(StrEnum):
    """Physical quantity represented by a scene asset."""

    WAVEFUNCTION = "wavefunction"
    PROBABILITY_DENSITY = "probability_density"
    PHASE = "phase"
    PROBABILITY_CURRENT = "probability_current"


class PrincipalPlane(StrEnum):
    """Cartesian plane through the origin on which a slice is sampled.

    Each member names its in-plane axes in ``(u, v)`` order; the frames
    themselves, including the right-handed ``xz`` normal ``-y``, live in
    :mod:`quviz.physics.planes`.
    """

    XY = "xy"
    XZ = "xz"
    YZ = "yz"


class SliceObservable(StrEnum):
    """Scalar field a slice reports on its plane.

    This is deliberately narrower than :class:`ObservableKind`: a slice carries
    real and imaginary wavefunction components as separate fields, and it has no
    slice representation of a vector-valued probability current.
    """

    PROBABILITY_DENSITY = "probability_density"
    WAVEFUNCTION_REAL = "wavefunction_real"
    WAVEFUNCTION_IMAG = "wavefunction_imag"
    PHASE = "phase"


class RepresentationKind(StrEnum):
    """Rendering representation, deliberately separate from the observable."""

    POINT_CLOUD = "point_cloud"
    ISOSURFACE = "isosurface"
    SLICE = "slice"
    STREAMLINES = "streamlines"


ANGLE_CONVENTION = "theta=polar[0,pi], phi=azimuth[0,2pi)"
SPHERICAL_HARMONIC_CONVENTION = "SciPy sph_harm_y; Condon-Shortley phase included"
LENGTH_UNIT = "bohr"
ENERGY_UNIT = "hartree"
