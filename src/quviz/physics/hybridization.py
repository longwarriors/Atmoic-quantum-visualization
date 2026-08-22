"""Symmetry-transparent orbital hybridization helpers."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

FloatMatrix = NDArray[np.float64]


def sp3_coefficient_matrix() -> FloatMatrix:
    r"""Return the orthogonal transformation from ``(s, px, py, pz)`` to sp3.

    The four p-direction vectors point to the vertices of a regular tetrahedron.
    """

    return 0.5 * np.asarray(
        [
            [1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, -1.0, -1.0],
            [1.0, -1.0, 1.0, -1.0],
            [1.0, -1.0, -1.0, 1.0],
        ],
        dtype=np.float64,
    )


def tetrahedral_directions() -> FloatMatrix:
    """Return the normalized p-space directions of the four sp3 hybrids."""

    directions = 2.0 * sp3_coefficient_matrix()[:, 1:]
    return directions / np.linalg.norm(directions, axis=1, keepdims=True)
