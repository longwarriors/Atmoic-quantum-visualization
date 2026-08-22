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
