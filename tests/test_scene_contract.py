from __future__ import annotations

import struct

import numpy as np
import pytest

from quviz.conventions import (
    BasisKind,
    ObservableKind,
    PrincipalPlane,
    RepresentationKind,
    SliceObservable,
)
from quviz.physics.hydrogenic import cartesian_to_spherical, hydrogenic_wavefunction
from quviz.physics.observables import probability_density
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.sampling.point_cloud import OrbitalPointCloud, sample_orbital_point_cloud
from quviz.scene.binary import (
    POINT_CLOUD_MAGIC,
    POINT_CLOUD_STRIDE,
    POINT_CLOUD_VERSION,
    encode_point_cloud,
)
from quviz.scene.builders import build_isosurface, orbital_metadata, superposition_metadata
from quviz.scene.models import (
    SLICE_VALUE_UNITS,
    OrbitalMetadata,
    QuantumStateSpec,
    SliceDetail,
    SlicePayload,
    SuperpositionSlicePayload,
)


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


_SLICE_RESOLUTION = 65
_SLICE_SAMPLES = _SLICE_RESOLUTION * _SLICE_RESOLUTION
_SLICE_EXTENT = 8.0

_SLICE_OBSERVABLE_KIND = {
    SliceObservable.PROBABILITY_DENSITY: ObservableKind.PROBABILITY_DENSITY,
    SliceObservable.WAVEFUNCTION_REAL: ObservableKind.WAVEFUNCTION,
    SliceObservable.WAVEFUNCTION_IMAG: ObservableKind.WAVEFUNCTION,
    SliceObservable.PHASE: ObservableKind.PHASE,
}


def _slice_metadata(observable: SliceObservable) -> OrbitalMetadata:
    return orbital_metadata(
        2,
        1,
        0,
        z=1.0,
        basis=BasisKind.REAL,
        observable=_SLICE_OBSERVABLE_KIND[observable],
        representation=RepresentationKind.SLICE,
        slice_detail=SliceDetail(plane=PrincipalPlane.XY, slice_observable=observable),
    )


def _slice_kwargs(observable: SliceObservable, **overrides: object) -> dict[str, object]:
    """A payload that satisfies every cross-field rule, so a test can break one."""

    spacing = 2.0 * _SLICE_EXTENT / (_SLICE_RESOLUTION - 1)
    values = [0.25] * _SLICE_SAMPLES
    kwargs: dict[str, object] = {
        "metadata": _slice_metadata(observable),
        "plane": PrincipalPlane.XY,
        "slice_observable": observable,
        "origin_bohr": [0.0, 0.0, 0.0],
        "u_axis": [1.0, 0.0, 0.0],
        "v_axis": [0.0, 1.0, 0.0],
        "normal": [0.0, 0.0, 1.0],
        "extent_bohr": _SLICE_EXTENT,
        "spacing_bohr": spacing,
        "resolution": _SLICE_RESOLUTION,
        "layout": "row_major_v_rows_u_columns",
        "value_unit": SLICE_VALUE_UNITS[observable],
        "values": values,
        "max_amplitude_on_plane": 1.0,
    }
    if observable is SliceObservable.PHASE:
        mask = [True] * _SLICE_SAMPLES
        mask[0] = False
        masked_values = list(values)
        masked_values[0] = 0.0
        kwargs |= {
            "values": masked_values,
            "valid_mask": mask,
            "phase_mask_relative_amplitude": 1e-6,
            "phase_mask_amplitude_scale": 1.0,
            "phase_mask_amplitude_threshold": 1e-6,
            "phase_mask_numeric_floor": 64.0 * float(np.finfo(np.float64).eps),
            "phase_masked_fraction": 1.0 / _SLICE_SAMPLES,
        }
    return kwargs | overrides


def _slice_values(observable: SliceObservable) -> list[float]:
    values = _slice_kwargs(observable)["values"]
    assert isinstance(values, list)
    return [float(item) for item in values]


def test_orbital_metadata_scales_energy_with_the_reduced_mass_length() -> None:
    # a_mu enters the energy as mu/m_e = 1/a_mu, so E = -(Z^2/a_mu)/(2 n^2).
    # Reporting the a_mu = 1 energy for a muonic length would attach a number
    # to the asset that no state on screen has.
    scaled = orbital_metadata(
        2,
        1,
        0,
        z=1.0,
        a_mu=0.5,
        basis=BasisKind.REAL,
        observable=ObservableKind.PROBABILITY_DENSITY,
        representation=RepresentationKind.ISOSURFACE,
    )
    assert scaled.state.a_mu == pytest.approx(0.5)
    assert scaled.energy_hartree == pytest.approx(-(1.0 / 0.5) / (2 * 2 * 2))

    default = orbital_metadata(
        2,
        1,
        0,
        z=1.0,
        basis=BasisKind.REAL,
        observable=ObservableKind.PROBABILITY_DENSITY,
        representation=RepresentationKind.ISOSURFACE,
    )
    assert default.state.a_mu == pytest.approx(1.0)
    assert default.energy_hartree == pytest.approx(-0.125)


def test_slice_detail_fails_closed_in_both_directions() -> None:
    # A slice with no plane would describe a picture the metadata cannot name;
    # a plane on an isosurface would name a plane the asset does not have.
    detail = SliceDetail(
        plane=PrincipalPlane.XZ, slice_observable=SliceObservable.PROBABILITY_DENSITY
    )
    with pytest.raises(ValueError, match="slice representation requires slice_detail"):
        orbital_metadata(
            2,
            1,
            0,
            z=1.0,
            basis=BasisKind.REAL,
            observable=ObservableKind.PROBABILITY_DENSITY,
            representation=RepresentationKind.SLICE,
        )
    with pytest.raises(ValueError, match="slice_detail requires the slice representation"):
        orbital_metadata(
            2,
            1,
            0,
            z=1.0,
            basis=BasisKind.REAL,
            observable=ObservableKind.PROBABILITY_DENSITY,
            representation=RepresentationKind.ISOSURFACE,
            slice_detail=detail,
        )

    state = SuperpositionState(terms=(SuperpositionTerm(2, 1, 0, 1.0),), basis=BasisKind.REAL)
    with pytest.raises(ValueError, match="slice representation requires slice_detail"):
        superposition_metadata(
            state,
            time=0.0,
            observable=ObservableKind.PROBABILITY_DENSITY,
            representation=RepresentationKind.SLICE,
        )
    with pytest.raises(ValueError, match="slice_detail requires the slice representation"):
        superposition_metadata(
            state,
            time=0.0,
            observable=ObservableKind.PROBABILITY_DENSITY,
            representation=RepresentationKind.ISOSURFACE,
            slice_detail=detail,
        )


def test_slice_metadata_names_the_plane_and_never_calls_the_mask_a_node() -> None:
    metadata = _slice_metadata(SliceObservable.PHASE)
    assert "xy" in metadata.geometry_semantics
    assert "xz" not in metadata.geometry_semantics
    assert "row" in metadata.geometry_semantics
    assert "phase-undefined" in metadata.color_semantics
    assert "not a certificate of a node" in metadata.color_semantics


def test_slice_payload_carries_the_plane_frame_and_the_mask_report() -> None:
    density = SlicePayload(**_slice_kwargs(SliceObservable.PROBABILITY_DENSITY))
    assert density.value_unit == "bohr^-3"
    assert density.valid_mask is None
    assert density.phase_masked_fraction is None
    assert density.masked_value_sentinel == 0.0
    assert density.layout == "row_major_v_rows_u_columns"

    real = SlicePayload(**_slice_kwargs(SliceObservable.WAVEFUNCTION_REAL))
    assert real.value_unit == "bohr^-3/2"

    phase_slice = SlicePayload(**_slice_kwargs(SliceObservable.PHASE))
    assert phase_slice.value_unit == "radian"
    assert phase_slice.valid_mask is not None
    assert len(phase_slice.valid_mask) == _SLICE_SAMPLES
    assert phase_slice.values[0] == phase_slice.masked_value_sentinel
    assert phase_slice.phase_mask_amplitude_scale == pytest.approx(1.0)
    assert phase_slice.phase_masked_fraction == pytest.approx(1.0 / _SLICE_SAMPLES)


def test_slice_payload_requires_the_mask_exactly_for_phase() -> None:
    with pytest.raises(ValueError, match="valid_mask is defined only for the phase observable"):
        SlicePayload(
            **_slice_kwargs(
                SliceObservable.PROBABILITY_DENSITY,
                valid_mask=[True] * _SLICE_SAMPLES,
            )
        )
    with pytest.raises(ValueError, match="phase slice requires valid_mask"):
        SlicePayload(**_slice_kwargs(SliceObservable.PHASE, valid_mask=None))


def test_slice_payload_rejects_length_mismatches() -> None:
    with pytest.raises(ValueError, match=r"values must hold resolution\*\*2"):
        SlicePayload(
            **_slice_kwargs(
                SliceObservable.PROBABILITY_DENSITY,
                values=[0.25] * (_SLICE_SAMPLES - 1),
            )
        )
    with pytest.raises(ValueError, match=r"valid_mask must hold resolution\*\*2"):
        SlicePayload(
            **_slice_kwargs(SliceObservable.PHASE, valid_mask=[True] * (_SLICE_SAMPLES - 1))
        )
    with pytest.raises(ValueError, match="u_axis must have three components"):
        SlicePayload(**_slice_kwargs(SliceObservable.PROBABILITY_DENSITY, u_axis=[1.0, 0.0]))


def test_slice_payload_rejects_a_masked_entry_that_is_not_the_sentinel() -> None:
    # A masked sample carries no phase. If it also carried a leftover number, a
    # client that ignored the mask would render residue as a measurement.
    values = _slice_values(SliceObservable.PHASE)
    values[0] = 3.14159
    with pytest.raises(ValueError, match="masked values must equal masked_value_sentinel"):
        SlicePayload(**_slice_kwargs(SliceObservable.PHASE, values=values))


def test_slice_payload_rejects_non_finite_values() -> None:
    # Starlette's pinned JSONResponse rejects these values only while rendering
    # the response. The payload contract must fail earlier, where the invalid
    # scientific field is still named and attributable.
    values = _slice_values(SliceObservable.PROBABILITY_DENSITY)
    values[7] = float("nan")
    with pytest.raises(ValueError, match="values must all be finite"):
        SlicePayload(**_slice_kwargs(SliceObservable.PROBABILITY_DENSITY, values=values))
    values[7] = float("inf")
    with pytest.raises(ValueError, match="values must all be finite"):
        SlicePayload(**_slice_kwargs(SliceObservable.PROBABILITY_DENSITY, values=values))


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("origin_bohr", lambda bad: [bad, 0.0, 0.0], "origin_bohr must have only finite"),
        ("u_axis", lambda bad: [1.0, bad, 0.0], "u_axis must have only finite"),
        ("v_axis", lambda bad: [0.0, 1.0, bad], "v_axis must have only finite"),
        ("normal", lambda bad: [bad, 0.0, 1.0], "normal must have only finite"),
        ("extent_bohr", lambda bad: bad, "extent_bohr"),
        ("spacing_bohr", lambda bad: bad, "spacing_bohr"),
    ],
)
def test_slice_payload_rejects_non_finite_geometry(
    bad: float,
    field: str,
    value: object,
    message: str,
) -> None:
    resolved = value(bad) if callable(value) else value
    with pytest.raises(ValueError, match=message):
        SlicePayload(
            **_slice_kwargs(
                SliceObservable.PROBABILITY_DENSITY,
                **{field: resolved},
            )
        )


def test_slice_payload_rejects_a_unit_that_contradicts_the_observable() -> None:
    with pytest.raises(ValueError, match="value_unit must be"):
        SlicePayload(**_slice_kwargs(SliceObservable.PROBABILITY_DENSITY, value_unit="radian"))


def test_superposition_slice_payload_enforces_the_same_rules() -> None:
    state = SuperpositionState(terms=(SuperpositionTerm(2, 1, 0, 1.0),), basis=BasisKind.REAL)
    metadata = superposition_metadata(
        state,
        time=0.0,
        observable=ObservableKind.PHASE,
        representation=RepresentationKind.SLICE,
        slice_detail=SliceDetail(plane=PrincipalPlane.YZ, slice_observable=SliceObservable.PHASE),
    )
    payload = SuperpositionSlicePayload(
        **(_slice_kwargs(SliceObservable.PHASE) | {"metadata": metadata})
    )
    assert payload.metadata.time_au == 0.0
    assert payload.valid_mask is not None
    assert payload.metadata.a_mu == pytest.approx(1.0)

    values = _slice_values(SliceObservable.PHASE)
    values[0] = -1.0
    with pytest.raises(ValueError, match="masked values must equal masked_value_sentinel"):
        SuperpositionSlicePayload(
            **_slice_kwargs(SliceObservable.PHASE, metadata=metadata, values=values)
        )
