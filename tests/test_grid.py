from __future__ import annotations

import numpy as np
import pytest

from quviz.solvers.grid import DirichletGrid1D, PeriodicGrid1D


def test_dirichlet_grid_coordinates_and_dx_share_one_contract() -> None:
    grid = DirichletGrid1D(-1.0, 1.0, points=3)
    assert grid.dx == pytest.approx(0.5)
    assert grid.coordinates == pytest.approx([-0.5, 0.0, 0.5])
    assert np.diff(grid.coordinates) == pytest.approx(np.full(2, grid.dx))

    expected = np.asarray(
        [[-2.0, 1.0, 0.0], [1.0, -2.0, 1.0], [0.0, 1.0, -2.0]]
    ) / grid.dx**2
    assert grid.laplacian().toarray() == pytest.approx(expected)


def test_periodic_grid_is_half_open() -> None:
    grid = PeriodicGrid1D(0.0, 2.0, points=4)
    assert grid.dx == pytest.approx(0.5)
    assert grid.coordinates == pytest.approx([0.0, 0.5, 1.0, 1.5])
    assert 2.0 not in grid.coordinates
