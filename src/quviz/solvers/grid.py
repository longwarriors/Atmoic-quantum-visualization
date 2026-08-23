"""Grid contracts that keep coordinates, spacing, quadrature and BCs aligned."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.sparse import csr_matrix, diags

FloatArray = NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class DirichletGrid1D:
    """Interior points on ``[x_min, x_max]`` with zero-valued boundary nodes."""

    x_min: float
    x_max: float
    points: int

    def __post_init__(self) -> None:
        if self.x_max <= self.x_min:
            raise ValueError("x_max must be greater than x_min")
        if self.points < 3:
            raise ValueError("points must be at least 3")

    @property
    def dx(self) -> float:
        """Spacing including the two omitted boundary nodes."""

        return (self.x_max - self.x_min) / (self.points + 1)

    @property
    def coordinates(self) -> FloatArray:
        return np.linspace(self.x_min, self.x_max, self.points + 2, dtype=np.float64)[1:-1]

    def laplacian(self) -> csr_matrix:
        main = -2.0 * np.ones(self.points, dtype=np.float64)
        off = np.ones(self.points - 1, dtype=np.float64)
        matrix: csr_matrix[np.float64] = diags(
            [off.tolist(), main.tolist(), off.tolist()],
            offsets=[-1, 0, 1],
            shape=(self.points, self.points),
            format="csr",
            dtype=np.float64,
        )
        return matrix / self.dx**2


@dataclass(frozen=True, slots=True)
class PeriodicGrid1D:
    """Cell-aligned periodic grid on ``[x_min, x_max)``."""

    x_min: float
    x_max: float
    points: int

    def __post_init__(self) -> None:
        if self.x_max <= self.x_min:
            raise ValueError("x_max must be greater than x_min")
        if self.points < 4:
            raise ValueError("points must be at least 4")

    @property
    def dx(self) -> float:
        return (self.x_max - self.x_min) / self.points

    @property
    def coordinates(self) -> FloatArray:
        return np.linspace(self.x_min, self.x_max, self.points, endpoint=False, dtype=np.float64)
