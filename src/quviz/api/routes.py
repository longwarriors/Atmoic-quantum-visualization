"""HTTP routes for scientific scene assets."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import ORJSONResponse

from quviz import __version__
from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.physics.hydrogenic import validate_quantum_numbers
from quviz.sampling.point_cloud import sample_orbital_point_cloud
from quviz.scene.binary import encode_point_cloud
from quviz.scene.builders import build_isosurface, orbital_metadata

router = APIRouter(prefix="/api", tags=["QuViz"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/orbitals/catalog")
def orbital_catalog() -> list[dict[str, object]]:
    """Curated presets that have immediately recognizable geometry."""

    return [
        {"id": "1s", "n": 1, "l": 0, "m": 0, "basis": "real", "label": "1s"},
        {"id": "2px", "n": 2, "l": 1, "m": 1, "basis": "real", "label": "2pₓ"},
        {"id": "2py", "n": 2, "l": 1, "m": -1, "basis": "real", "label": "2pᵧ"},
        {"id": "2pz", "n": 2, "l": 1, "m": 0, "basis": "real", "label": "2p_z"},
        {"id": "3dxy", "n": 3, "l": 2, "m": -2, "basis": "real", "label": "3dₓᵧ"},
        {"id": "3dz2", "n": 3, "l": 2, "m": 0, "basis": "real", "label": "3d_z²"},
        {
            "id": "3d-complex",
            "n": 3,
            "l": 2,
            "m": 2,
            "basis": "complex",
            "label": "3d, m=2",
        },
    ]


def _validate_or_422(n: int, l: int, m: int) -> None:
    try:
        validate_quantum_numbers(n, l, m)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/orbitals/metadata")
def metadata(
    n: int = Query(2, ge=1, le=12),
    l: int = Query(1, ge=0, le=11),
    m: int = Query(0, ge=-11, le=11),
    z: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.REAL,
) -> ORJSONResponse:
    _validate_or_422(n, l, m)
    value = orbital_metadata(
        n,
        l,
        m,
        z=z,
        basis=basis,
        observable=ObservableKind.PROBABILITY_DENSITY,
        representation=RepresentationKind.POINT_CLOUD,
    )
    return ORJSONResponse(value.model_dump(mode="json"))


@lru_cache(maxsize=32)
def _point_cloud_bytes(
    n: int,
    l: int,
    m: int,
    z: float,
    basis: BasisKind,
    samples: int,
    seed: int,
) -> tuple[bytes, float, float]:
    cloud = sample_orbital_point_cloud(
        n,
        l,
        m,
        z=z,
        basis=basis,
        count=samples,
        seed=seed,
    )
    return encode_point_cloud(cloud), cloud.radial_mass_captured, cloud.extent_bohr


@router.get("/orbitals/point-cloud")
def point_cloud(
    n: int = Query(2, ge=1, le=12),
    l: int = Query(1, ge=0, le=11),
    m: int = Query(0, ge=-11, le=11),
    z: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.REAL,
    samples: int = Query(20_000, ge=1_000, le=120_000),
    seed: int = Query(7, ge=0, le=2_147_483_647),
) -> Response:
    _validate_or_422(n, l, m)
    payload, radial_mass, extent = _point_cloud_bytes(n, l, m, z, basis, samples, seed)
    headers = {
        "X-QuViz-Format": "QVPC/1",
        "X-QuViz-Radial-Mass": f"{radial_mass:.9f}",
        "X-QuViz-Extent-Bohr": f"{extent:.6f}",
        "Cache-Control": "public, max-age=3600",
    }
    return Response(payload, media_type="application/vnd.quviz.point-cloud", headers=headers)


@lru_cache(maxsize=16)
def _cached_isosurface(
    n: int,
    l: int,
    m: int,
    z: float,
    basis: BasisKind,
    resolution: int,
    probability_mass: float,
) -> dict[str, object]:
    payload = build_isosurface(
        n,
        l,
        m,
        z=z,
        basis=basis,
        resolution=resolution,
        probability_mass=probability_mass,
    )
    return payload.model_dump(mode="json")


@router.get("/orbitals/isosurface")
def isosurface(
    n: int = Query(2, ge=1, le=8),
    l: int = Query(1, ge=0, le=7),
    m: int = Query(0, ge=-7, le=7),
    z: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.REAL,
    resolution: int = Query(52, ge=24, le=72),
    probability_mass: float = Query(0.90, ge=0.50, le=0.99),
) -> ORJSONResponse:
    _validate_or_422(n, l, m)
    try:
        result = _cached_isosurface(n, l, m, z, basis, resolution, probability_mass)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ORJSONResponse(result)
