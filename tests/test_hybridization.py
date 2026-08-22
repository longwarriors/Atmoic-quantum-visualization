from __future__ import annotations

import numpy as np
import pytest

from quviz.physics.hybridization import sp3_coefficient_matrix, tetrahedral_directions


def test_sp3_transformation_is_orthogonal() -> None:
    matrix = sp3_coefficient_matrix()
    assert matrix.shape == (4, 4)
    assert matrix @ matrix.T == pytest.approx(np.eye(4), abs=1e-15)


def test_sp3_directions_form_regular_tetrahedron() -> None:
    directions = tetrahedral_directions()
    gram = directions @ directions.T
    assert np.diag(gram) == pytest.approx(np.ones(4), abs=1e-15)
    off_diagonal = gram[~np.eye(4, dtype=bool)]
    assert off_diagonal == pytest.approx(np.full(12, -1.0 / 3.0), abs=1e-15)
