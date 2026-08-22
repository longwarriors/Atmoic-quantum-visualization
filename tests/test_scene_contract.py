from __future__ import annotations

import struct

import numpy as np
import pytest

from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.sampling.point_cloud import OrbitalPointCloud
from quviz.scene.binary import (
    POINT_CLOUD_MAGIC,
    POINT_CLOUD_STRIDE,
    POINT_CLOUD_VERSION,
    encode_point_cloud,
)
from quviz.scene.builders import build_isosurface, orbital_metadata
from quviz.scene.models import QuantumStateSpec


def test_quantum_state_contract_rejects_inconsistent_numbers() -> None:
    value = QuantumStateSpec(n=2, l=1, m=1, z=1.0, basis=BasisKind.REAL)
    assert value.model_dump(mode="json")["basis"] == "real"
    with pytest.raises(ValueError, match=r"l must satisfy"):
        QuantumStateSpec(n=2, l=2, m=0, z=1.0, basis=BasisKind.REAL)
    with pytest.raises(ValueError, match=r"\|m\| <= l"):
        QuantumStateSpec(n=2, l=1, m=2, z=1.0, basis=BasisKind.REAL)


def test_point_cloud_binary_header_and_interleaving() -> None:
    cloud = OrbitalPointCloud(
        positions=np.asarray([[1.0, 2.0, 3.0], [-1.0, -2.0, -3.0]], dtype=np.float32),
        intensity=np.asarray([0.25, 0.75], dtype=np.float32),
        phase=np.asarray([0.0, np.pi], dtype=np.float32),
        radial_mass_captured=1.0,
        extent_bohr=3.0,
    )
    payload = encode_point_cloud(cloud)
    magic, version, flags, count, stride = struct.unpack("<4sHHII", payload[:16])
    assert magic == POINT_CLOUD_MAGIC
    assert version == POINT_CLOUD_VERSION
    assert flags == 0
    assert count == 2
    assert stride == POINT_CLOUD_STRIDE
    values = np.frombuffer(payload, dtype="<f4", offset=16).reshape(2, 5)
    np.testing.assert_allclose(
        values,
        np.asarray(
            [[1.0, 2.0, 3.0, 0.25, 0.0], [-1.0, -2.0, -3.0, 0.75, np.pi]]
        ),
        rtol=1e-7,
        atol=1e-7,
    )


def test_metadata_separates_observable_from_representation() -> None:
    value = orbital_metadata(
        2,
        1,
        0,
        z=1.0,
        basis=BasisKind.REAL,
        observable=ObservableKind.PROBABILITY_DENSITY,
        representation=RepresentationKind.POINT_CLOUD,
    )
    assert value.observable is ObservableKind.PROBABILITY_DENSITY
    assert value.representation is RepresentationKind.POINT_CLOUD
    assert value.normalization == "integral(|psi|^2 dV)=1"
    assert "scipy-sph-harm-y" in value.references


def test_isosurface_payload_is_semantically_complete() -> None:
    payload = build_isosurface(1, 0, 0, resolution=24, probability_mass=0.8)
    assert len(payload.vertices) > 20
    assert len(payload.faces) > 20
    assert len(payload.phase) == len(payload.vertices)
    assert payload.metadata.observable is ObservableKind.PROBABILITY_DENSITY
    assert payload.metadata.representation is RepresentationKind.ISOSURFACE
    assert payload.requested_probability_mass == pytest.approx(0.8)
    assert payload.captured_probability_mass == pytest.approx(0.8, abs=0.02)
