"""Reusable one-dimensional inverse-CDF utilities."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]


def normalized_cdf(grid: FloatArray, density: FloatArray) -> tuple[FloatArray, float]:
    """Integrate a non-negative density with the trapezoid rule.

    Returns the normalized CDF and the unnormalized integral over the supplied
    finite grid.
    """

    if grid.ndim != 1 or density.ndim != 1 or grid.shape != density.shape:
        raise ValueError("grid and density must be one-dimensional arrays of equal length")
    if np.any(np.diff(grid) <= 0.0):
        raise ValueError("grid must be strictly increasing")
    clipped = np.maximum(density, 0.0)
    increments = 0.5 * (clipped[1:] + clipped[:-1]) * np.diff(grid)
    cdf = np.concatenate(([0.0], np.cumsum(increments)))
    integral = float(cdf[-1])
    if not np.isfinite(integral) or integral <= 0.0:
        raise ValueError("density must have a positive finite integral")
    cdf /= integral
    cdf[-1] = 1.0
    return cdf, integral


def inverse_transform_sample(
    rng: np.random.Generator,
    grid: FloatArray,
    cdf: FloatArray,
    count: int,
) -> FloatArray:
    """Draw independent samples by linear interpolation of a tabulated CDF."""

    if count < 1:
        raise ValueError("count must be positive")
    uniforms = rng.random(count)
    return np.asarray(np.interp(uniforms, cdf, grid), dtype=np.float64)
