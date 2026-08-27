from __future__ import annotations

import struct

import numpy as np
import pytest

from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.physics.hydrogenic import cartesian_to_spherical, hydrogenic_wavefunction
from quviz.physics.observables import probability_density
from quviz.sampling.point_cloud import OrbitalPointCloud, sample_orbital_point_cloud
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
        np.asarray([[1.0, 2.0, 3.0, 0.25, 0.0], [-1.0, -2.0, -3.0, 0.75, np.pi]]),
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
    payload = build_isosurface(1, 0, 0, resolution=49, probability_mass=0.8)
    assert len(payload.vertices) > 20
    assert len(payload.faces) > 20
    assert len(payload.phase) == len(payload.vertices)
    assert payload.metadata.observable is ObservableKind.PROBABILITY_DENSITY
    assert payload.metadata.representation is RepresentationKind.ISOSURFACE
    assert payload.requested_probability_mass == pytest.approx(0.8)
    assert payload.captured_probability_mass == pytest.approx(0.8, abs=0.02)
    assert payload.finite_grid_density_integral == pytest.approx(1.0, abs=0.003)
    assert payload.density_level == pytest.approx(0.00441053295, rel=0.04)
    assert payload.grid_spacing_bohr > 0.0


def _mesh_component_count(faces: np.ndarray) -> int:
    vertices = np.unique(faces)
    parent = {int(vertex): int(vertex) for vertex in vertices}

    def find(vertex: int) -> int:
        while parent[vertex] != vertex:
            parent[vertex] = parent[parent[vertex]]
            vertex = parent[vertex]
        return vertex

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for first, second, third in faces:
        union(int(first), int(second))
        union(int(second), int(third))
    return len({find(int(vertex)) for vertex in vertices})


def test_pz_isosurface_preserves_nodal_plane_and_winding() -> None:
    payload = build_isosurface(2, 1, 0, resolution=49, probability_mass=0.9)
    vertices = np.asarray(payload.vertices)
    faces = np.asarray(payload.faces)
    normals = np.asarray(payload.normals)

    assert _mesh_component_count(faces) == 2
    assert np.min(np.abs(vertices[:, 2])) > 0.0
    assert np.max(np.abs(vertices)) < payload.extent_bohr

    face_normals = np.cross(
        vertices[faces[:, 1]] - vertices[faces[:, 0]],
        vertices[faces[:, 2]] - vertices[faces[:, 0]],
    )
    mean_vertex_normals = np.mean(normals[faces], axis=1)
    alignment = np.einsum("ij,ij->i", face_normals, mean_vertex_normals)
    # Fraction, not mean: the unnormalized dot products are area-weighted, so a
    # positive mean can hide a large minority of inconsistently wound faces.
    assert float(np.mean(alignment > 0.0)) > 0.99


def test_isosurface_rejects_even_or_underresolved_grids() -> None:
    with pytest.raises(ValueError, match="odd"):
        build_isosurface(1, 0, 0, resolution=50)
    with pytest.raises(ValueError, match="between 65 and 81"):
        build_isosurface(3, 1, 0, resolution=49)


def test_3p_surface_preserves_angular_and_radial_nodes() -> None:
    payload = build_isosurface(3, 1, 0, resolution=65, probability_mass=0.9)
    assert _mesh_component_count(np.asarray(payload.faces)) == 4
    assert payload.finite_grid_density_integral == pytest.approx(1.0, abs=0.002)


def test_complex_surface_carries_full_phase_cycle() -> None:
    payload = build_isosurface(
        2,
        1,
        1,
        basis=BasisKind.COMPLEX,
        resolution=49,
        probability_mass=0.8,
    )
    vertex_phase = np.asarray(payload.phase)
    assert float(np.ptp(vertex_phase)) > 5.5
    assert any("color carries wavefunction phase" in item for item in payload.metadata.warnings)


@pytest.mark.parametrize(("n", "l", "m", "resolution"), [(1, 0, 0, 49), (2, 1, 0, 49)])
def test_isosurface_normals_point_away_from_higher_density(
    n: int, l: int, m: int, resolution: int
) -> None:
    # A density superlevel set must expose outward normals, otherwise the mesh
    # renders back-facing under the front-side material the frontend uses.
    payload = build_isosurface(n, l, m, resolution=resolution, probability_mass=0.9)
    vertices = np.asarray(payload.vertices)
    normals = np.asarray(payload.normals)
    step = 1e-3

    def density_at(points: np.ndarray) -> np.ndarray:
        radius, polar, azimuth = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
        return probability_density(
            hydrogenic_wavefunction(n, l, m, radius, polar, azimuth, basis=BasisKind.REAL)
        )

    outward = density_at(vertices + step * normals) < density_at(vertices - step * normals)
    assert float(np.mean(outward)) > 0.99


def test_encoder_reproduces_the_committed_qvpc_golden_bytes() -> None:
    # Half of a cross-language contract: web/src/api/qvpc.test.ts decodes the
    # same file. Changing POINT_CLOUD_STRIDE or the header layout on one side
    # alone must break both, so the wire format cannot drift silently.
    import json
    from pathlib import Path

    fixtures = Path(__file__).resolve().parent / "fixtures"
    spec = json.loads((fixtures / "qvpc_golden.json").read_text(encoding="utf-8"))
    cloud = OrbitalPointCloud(
        positions=np.asarray(spec["positions"], dtype=np.float32),
        intensity=np.asarray(spec["intensity"], dtype=np.float32),
        phase=np.asarray(spec["phase"], dtype=np.float32),
        radial_mass_captured=1.0,
        extent_bohr=100.0,
    )

    assert encode_point_cloud(cloud) == (fixtures / "qvpc_golden.bin").read_bytes()
    assert spec["stride"] == POINT_CLOUD_STRIDE
    assert spec["version"] == POINT_CLOUD_VERSION
    assert spec["magic"].encode() == POINT_CLOUD_MAGIC


def _decode_point_cloud_body(payload: bytes) -> np.ndarray:
    """Read the interleaved records back out of an encoded payload."""

    count, stride = struct.unpack("<II", payload[8:16])
    return np.frombuffer(payload, dtype="<f4", offset=16).reshape(count, stride)


def test_encoded_body_stays_inside_the_ranges_the_decoder_enforces() -> None:
    # The producer half of the body contract that web/src/api/qvpc.ts enforces
    # on the consumer side: it refuses any payload whose intensity leaves
    # [0, 1] or whose phase leaves the float32 [-pi, pi] range. Asserting the
    # same bounds over the bytes this encoder actually writes means a sampler
    # change that broke either bound fails here, loudly, instead of surfacing
    # as a browser-side decode error against a server that is "working".
    cloud = sample_orbital_point_cloud(2, 1, 1, count=2000, seed=11, basis=BasisKind.COMPLEX)
    values = _decode_point_cloud_body(encode_point_cloud(cloud))

    assert values.dtype == np.dtype("<f4")
    assert values.shape == (2000, POINT_CLOUD_STRIDE)
    assert bool(np.all(np.isfinite(values)))

    intensity = values[:, 3]
    assert float(intensity.min()) >= 0.0
    assert float(intensity.max()) <= 1.0

    phase = values[:, 4]
    # float32, not double: np.angle returns exactly pi for a negative real
    # amplitude, and float32(pi) is greater than pi in double, so a
    # double-precision bound would be violated by a value the encoder is
    # entitled to write. The decoder uses Math.fround(Math.PI) for the same
    # reason.
    bound = np.float32(np.pi)
    assert float(bound) > float(np.pi)
    assert float(np.abs(phase).max()) <= float(bound)
    # Guard against a vacuous assertion: an m=1 complex orbital has phase
    # e^{i phi} with phi uniform, so the samples must actually reach the
    # branch cut this bound is about.
    assert float(np.ptp(phase)) > 6.0
