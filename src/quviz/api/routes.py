"""HTTP routes for scientific scene assets."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Response

from quviz import __version__
from quviz.conventions import BasisKind, ObservableKind, RepresentationKind
from quviz.physics.hydrogenic import validate_quantum_numbers
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.sampling.point_cloud import sample_orbital_point_cloud
from quviz.scene.binary import encode_point_cloud
from quviz.scene.builders import (
    build_current_field,
    build_isosurface,
    build_superposition_current_field,
    build_superposition_isosurface,
    orbital_metadata,
)
from quviz.scene.models import (
    CurrentFieldPayload,
    IsosurfacePayload,
    OrbitalMetadata,
    SuperpositionCurrentPayload,
    SuperpositionIsosurfacePayload,
)

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
) -> OrbitalMetadata:
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
    return value


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
) -> IsosurfacePayload:
    return build_isosurface(
        n,
        l,
        m,
        z=z,
        basis=basis,
        resolution=resolution,
        probability_mass=probability_mass,
    )


@router.get("/orbitals/isosurface")
def isosurface(
    n: int = Query(2, ge=1, le=4),
    l: int = Query(1, ge=0, le=3),
    m: int = Query(0, ge=-3, le=3),
    z: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.REAL,
    resolution: int = Query(65, ge=49, le=81),
    probability_mass: float = Query(0.90, ge=0.50, le=0.99),
) -> IsosurfacePayload:
    _validate_or_422(n, l, m)
    try:
        result = _cached_isosurface(n, l, m, z, basis, resolution, probability_mass)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@lru_cache(maxsize=16)
def _cached_current_field(
    n: int,
    l: int,
    m: int,
    z: float,
    basis: BasisKind,
    seed_count: int,
    arc_step: float,
) -> CurrentFieldPayload:
    return build_current_field(n, l, m, z=z, basis=basis, seed_count=seed_count, arc_step=arc_step)


@router.get("/orbitals/current-field")
def current_field(
    n: int = Query(3, ge=1, le=6),
    l: int = Query(2, ge=0, le=5),
    m: int = Query(2, ge=-5, le=5),
    z: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.COMPLEX,
    seed_count: int = Query(48, ge=1, le=256),
    arc_step: float = Query(0.12, gt=0.01, le=1.0),
) -> CurrentFieldPayload:
    """Probability-flow streamlines.

    Real stationary orbitals have zero current; the payload is then empty and
    carries a warning rather than an error, because "no flow" is the physically
    correct answer rather than a failure.
    """

    _validate_or_422(n, l, m)
    try:
        return _cached_current_field(n, l, m, z, basis, seed_count, arc_step)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# --- Time-dependent superpositions (M1) --------------------------------------

_TERM_SPEC_HELP = (
    "semicolon-separated terms 'n,l,m,re[,im]', e.g. '1,0,0,0.70710678;2,1,0,0.70710678'"
)


def _parse_superposition(spec: str, basis: BasisKind) -> SuperpositionState:
    """Parse the compact query encoding, turning any error into a 422."""

    terms: list[SuperpositionTerm] = []
    for chunk in spec.split(";"):
        fields = [piece.strip() for piece in chunk.split(",") if piece.strip()]
        if len(fields) not in (4, 5):
            raise HTTPException(
                status_code=422, detail=f"malformed term {chunk!r}; expected {_TERM_SPEC_HELP}"
            )
        try:
            n, l, m = (int(value) for value in fields[:3])
            real = float(fields[3])
            imag = float(fields[4]) if len(fields) == 5 else 0.0
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"unparsable term {chunk!r}") from exc
        _validate_or_422(n, l, m)
        terms.append(SuperpositionTerm(n, l, m, complex(real, imag)))

    try:
        return SuperpositionState(terms=tuple(terms), basis=basis)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/superposition/catalog")
def superposition_catalog() -> list[dict[str, object]]:
    """Presets chosen to make the physics legible, including a negative control."""

    return [
        {
            "id": "1s-2pz",
            "label": "1s + 2p_z (Bohr oscillation)",
            "terms": "1,0,0,0.7071067811865476;2,1,0,0.7071067811865476",
            "period_au": 16.755160819145562,
            "note": "Dipole oscillates at omega = 3/8 hartree; the textbook radiating state.",
        },
        {
            "id": "2s-2pz",
            "label": "2s + 2p_z (degenerate, stationary)",
            "terms": "2,0,0,0.7071067811865476;2,1,0,0.7071067811865476",
            "period_au": 0.0,
            "note": "Same energy, so nothing moves. A control: visible motion here is a bug.",
        },
        {
            "id": "1s-3dz2",
            "label": "1s + 3d_z2",
            "terms": "1,0,0,0.7071067811865476;3,2,0,0.7071067811865476",
            "period_au": 14.139717579927678,
            "note": "omega = 4/9 hartree. No dipole coupling, so the breathing is quadrupolar.",
        },
        {
            "id": "2pplus-2pminus",
            "label": "2p(+1) + 2p(-1)",
            "terms": "2,1,1,0.7071067811865476;2,1,-1,0.7071067811865476",
            "period_au": 0.0,
            "note": "Degenerate: a real p orbital in disguise, with zero net current.",
        },
    ]


@lru_cache(maxsize=32)
def _cached_superposition_isosurface(
    spec: str, basis: BasisKind, time: float, resolution: int, probability_mass: float
) -> SuperpositionIsosurfacePayload:
    state = _parse_superposition(spec, basis)
    return build_superposition_isosurface(
        state, time=time, resolution=resolution, probability_mass=probability_mass
    )


@router.get("/superposition/isosurface")
def superposition_isosurface(
    terms: str = Query("1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"),
    time: float = Query(0.0, ge=-1_000.0, le=1_000.0),
    basis: BasisKind = BasisKind.COMPLEX,
    resolution: int = Query(65, ge=49, le=81),
    probability_mass: float = Query(0.90, ge=0.50, le=0.99),
) -> SuperpositionIsosurfacePayload:
    r"""The :math:`|\Psi(t)|^2` level set of a superposition at one instant."""

    try:
        return _cached_superposition_isosurface(terms, basis, time, resolution, probability_mass)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@lru_cache(maxsize=16)
def _cached_superposition_current(
    spec: str, basis: BasisKind, time: float, seed_count: int, arc_step: float
) -> SuperpositionCurrentPayload:
    state = _parse_superposition(spec, basis)
    return build_superposition_current_field(
        state, time=time, seed_count=seed_count, arc_step=arc_step
    )


@router.get("/superposition/current-field")
def superposition_current_field(
    terms: str = Query("1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"),
    time: float = Query(0.0, ge=-1_000.0, le=1_000.0),
    basis: BasisKind = BasisKind.COMPLEX,
    seed_count: int = Query(24, ge=1, le=128),
    arc_step: float = Query(0.15, gt=0.01, le=1.0),
) -> SuperpositionCurrentPayload:
    """Probability-flow streamlines of a superposition, with its continuity residual."""

    try:
        return _cached_superposition_current(terms, basis, time, seed_count, arc_step)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
