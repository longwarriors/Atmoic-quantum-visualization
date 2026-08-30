"""HTTP routes for scientific scene assets."""

from __future__ import annotations

from functools import lru_cache
from math import tau

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from quviz import __version__
from quviz.conventions import (
    BasisKind,
    ObservableKind,
    PrincipalPlane,
    RepresentationKind,
    SliceObservable,
)
from quviz.errors import ScientificComputationError
from quviz.physics.hydrogenic import hydrogenic_energy_hartree, validate_quantum_numbers
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.sampling.point_cloud import sample_orbital_point_cloud
from quviz.scene.binary import encode_point_cloud
from quviz.scene.builders import (
    CurrentFieldWorkEstimate,
    build_current_field,
    build_isosurface,
    build_superposition_current_field,
    build_superposition_isosurface,
    estimate_current_field_workload,
    estimate_superposition_current_workload,
    estimate_superposition_isosurface_workload,
    orbital_metadata,
)
from quviz.scene.models import (
    CurrentFieldPayload,
    IsosurfacePayload,
    OrbitalMetadata,
    SlicePayload,
    SuperpositionCurrentPayload,
    SuperpositionIsosurfacePayload,
    SuperpositionSlicePayload,
)
from quviz.scene.slices import (
    DEFAULT_SLICE_RESOLUTION,
    MAXIMUM_SLICE_RESOLUTION,
    MINIMUM_SLICE_RESOLUTION,
    build_slice,
    build_superposition_slice,
    superposition_slice_resolution_floor,
)

router = APIRouter(prefix="/api", tags=["QuViz"])
_SCIENTIFIC_REQUEST_ERRORS = (
    ValueError,
    ScientificComputationError,
    FloatingPointError,
    OverflowError,
)


def _isolated_cached_payload[PayloadModel: BaseModel](payload: PayloadModel) -> PayloadModel:
    """Keep mutable response models from becoming shared cache state."""

    return payload.model_copy(deep=True)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/orbitals/catalog")
def orbital_catalog() -> list[dict[str, object]]:
    """Curated presets that have immediately recognizable geometry."""

    return [
        {"id": "1s", "n": 1, "l": 0, "m": 0, "z": 1.0, "basis": "real", "label": "1s"},
        {"id": "2px", "n": 2, "l": 1, "m": 1, "z": 1.0, "basis": "real", "label": "2pₓ"},
        {"id": "2py", "n": 2, "l": 1, "m": -1, "z": 1.0, "basis": "real", "label": "2pᵧ"},
        {"id": "2pz", "n": 2, "l": 1, "m": 0, "z": 1.0, "basis": "real", "label": "2p_z"},
        {
            "id": "3dxy",
            "n": 3,
            "l": 2,
            "m": -2,
            "z": 1.0,
            "basis": "real",
            "label": "3dₓᵧ",
        },
        {
            "id": "3dz2",
            "n": 3,
            "l": 2,
            "m": 0,
            "z": 1.0,
            "basis": "real",
            "label": "3d_z²",
        },
        {
            "id": "3d-complex",
            "n": 3,
            "l": 2,
            "m": 2,
            "z": 1.0,
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


@router.get(
    "/orbitals/point-cloud",
    response_class=Response,
    responses={
        200: {
            "description": "QVPC/1 little-endian Float32 point-cloud payload",
            "content": {
                "application/vnd.quviz.point-cloud": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
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
    try:
        payload, radial_mass, extent = _point_cloud_bytes(n, l, m, z, basis, samples, seed)
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _isolated_cached_payload(result)


@lru_cache(maxsize=4)
def _cached_current_field(
    n: int,
    l: int,
    m: int,
    z: float,
    basis: BasisKind,
    seed_count: int,
    arc_step: float | None,
) -> CurrentFieldPayload:
    return build_current_field(n, l, m, z=z, basis=basis, seed_count=seed_count, arc_step=arc_step)


@router.get("/orbitals/current-field")
def current_field(
    n: int = Query(3, ge=1, le=6),
    l: int = Query(2, ge=0, le=5),
    m: int = Query(2, ge=-5, le=5),
    z: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.COMPLEX,
    seed_count: int = Query(48, ge=1, le=96),
    arc_step: float | None = Query(None, gt=0.0),
) -> CurrentFieldPayload:
    """Probability-flow streamlines.

    Real stationary orbitals have zero current; the payload is then empty and
    carries a warning rather than an error, because "no flow" is the physically
    correct answer rather than a failure.
    """

    _validate_or_422(n, l, m)
    try:
        estimate = estimate_current_field_workload(
            n,
            l,
            m,
            z=z,
            basis=basis,
            seed_count=seed_count,
            arc_step=arc_step,
        )
        _enforce_current_field_workload("eigenstate current-field", estimate)
        return _isolated_cached_payload(
            _cached_current_field(n, l, m, z, basis, seed_count, arc_step)
        )
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/orbitals/slice")
def orbital_slice(
    n: int = Query(2, ge=1, le=12),
    l: int = Query(1, ge=0, le=11),
    m: int = Query(0, ge=-11, le=11),
    z: float = Query(1.0, gt=0.0, le=20.0),
    a_mu: float = Query(1.0, gt=0.0, le=20.0),
    basis: BasisKind = BasisKind.REAL,
    plane: PrincipalPlane = PrincipalPlane.XZ,
    observable: SliceObservable = SliceObservable.PROBABILITY_DENSITY,
    resolution: int = Query(
        DEFAULT_SLICE_RESOLUTION,
        ge=MINIMUM_SLICE_RESOLUTION,
        le=MAXIMUM_SLICE_RESOLUTION,
    ),
) -> SlicePayload:
    """One scalar field of an eigenstate on a principal plane through the origin.

    The extent is derived from the state and reported; it is not a parameter.
    ``resolution`` is bounded here only by the outermost limits both payloads
    share -- the parity rule and the ``n``-dependent floor live in the builder,
    which raises, and those refusals arrive as a 422 naming the reason.

    This is the only eigenstate route that exposes ``a_mu``: a slice is where
    the reduced-mass length is legible, because it rescales both the derived
    extent and the amplitude scale the phase mask is referenced to.
    """

    _validate_or_422(n, l, m)
    try:
        return build_slice(
            n,
            l,
            m,
            z=z,
            a_mu=a_mu,
            basis=basis,
            plane=plane,
            observable=observable,
            resolution=resolution,
        )
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# --- Time-dependent superpositions (M1) --------------------------------------

_TERM_SPEC_HELP = (
    "semicolon-separated terms 'n,l,m,re[,im]', e.g. '1,0,0,0.70710678;2,1,0,0.70710678'"
)
_DEFAULT_SUPERPOSITION_TERMS = "1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"
_MAXIMUM_TERM_SPEC_LENGTH = 512
_MAXIMUM_SUPERPOSITION_TERMS = 8
_MAXIMUM_ISOSURFACE_N = 4
_MAXIMUM_CURRENT_FIELD_N = 6
_MAXIMUM_SLICE_N = 12
_ISOSURFACE_WORK_LIMIT = 2_500_000
_ADAPTIVE_ISOSURFACE_WORK_LIMIT = 16_000_000
_SLICE_WORK_LIMIT = 1_500_000
_CURRENT_FIELD_PATH_SAMPLE_LIMIT = 100_000
_CURRENT_FIELD_WORK_LIMIT = 2_000_000
_MAXIMUM_SUPERPOSITION_CURRENT_SEEDS = 40


def _enforce_request_workload(
    operation: str,
    *,
    active_terms: int,
    work_per_term: int,
    limit: int,
    unit: str,
    multiplicand_label: str = "active terms",
) -> None:
    """Reject a combined request before a scientific builder allocates its arrays."""

    cost = active_terms * work_per_term
    if cost > limit:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{operation} request work is {cost} {unit} "
                f"({active_terms} {multiplicand_label} * {work_per_term}); limit is {limit}"
            ),
        )


def _enforce_current_field_workload(operation: str, estimate: CurrentFieldWorkEstimate) -> None:
    """Reject RK4 work or serialized geometry before entering a builder cache."""

    _enforce_request_workload(
        f"{operation} serialized output",
        active_terms=estimate.requested_seeds,
        work_per_term=estimate.max_points_per_line,
        limit=_CURRENT_FIELD_PATH_SAMPLE_LIMIT,
        unit="path samples",
        multiplicand_label="requested seeds",
    )
    _enforce_request_workload(
        operation,
        active_terms=estimate.active_terms,
        work_per_term=estimate.velocity_evaluations_per_term,
        limit=_CURRENT_FIELD_WORK_LIMIT,
        unit="term-velocity evaluations",
    )


def _superposition_current_seed_count_max(state: SuperpositionState) -> int:
    """Largest route-valid seed count that both current-field guards accept.

    The web client never sends an explicit ``arc_step``, so one one-seed
    estimate at the route default supplies the per-seed output and RK4 costs.
    The same estimator fields and limits used by
    :func:`_enforce_current_field_workload` derive the catalogue ceiling; the
    browser therefore consumes the guard's answer instead of reimplementing
    its geometric workload model.
    """

    one_seed = estimate_superposition_current_workload(state, seed_count=1)
    for seed_count in range(_MAXIMUM_SUPERPOSITION_CURRENT_SEEDS, 0, -1):
        candidate = CurrentFieldWorkEstimate(
            active_terms=one_seed.active_terms,
            requested_seeds=seed_count,
            max_points_per_line=one_seed.max_points_per_line,
            seed_filter_evaluations_per_term=one_seed.seed_filter_evaluations_per_term,
        )
        try:
            _enforce_current_field_workload("superposition current-field", candidate)
        except HTTPException:
            continue
        return seed_count
    raise ValueError("superposition current-field workload admits no positive seed_count")


def _hydrogenic_beat_period_au(first_n: int, second_n: int) -> float:
    """Return ``2*pi/|E_b-E_a|`` for the default hydrogenic energy scale."""

    gap = abs(hydrogenic_energy_hartree(second_n) - hydrogenic_energy_hartree(first_n))
    return 0.0 if gap == 0.0 else tau / gap


class SuperpositionCatalogEntry(BaseModel):
    """One client-ready preset, including its builder-derived capabilities."""

    id: str
    label: str
    terms: str
    period_au: float
    note: str
    slice_resolution_floor: int = Field(
        ge=MINIMUM_SLICE_RESOLUTION,
        le=MAXIMUM_SLICE_RESOLUTION,
        description=(
            "First odd uniform grid accepted by the superposition slice builder for this "
            "preset; independent of Z and a_mu because all relevant lengths scale together."
        ),
    )
    streamline_seed_count_max: int = Field(
        ge=1,
        le=_MAXIMUM_SUPERPOSITION_CURRENT_SEEDS,
        description=(
            "Largest seed_count accepted by both superposition current-field workload "
            "guards for this preset in either basis at the route-default arc_step; "
            "independent of Z and a_mu because the extent and default arc step scale "
            "together."
        ),
    )


def _parse_superposition(
    spec: str,
    basis: BasisKind,
    *,
    z: float = 1.0,
    a_mu: float = 1.0,
    maximum_n: int = _MAXIMUM_SLICE_N,
    operation: str = "superposition",
) -> SuperpositionState:
    """Parse the compact query encoding, turning any error into a 422."""

    if len(spec) > _MAXIMUM_TERM_SPEC_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=(
                f"terms must contain at most {_MAXIMUM_TERM_SPEC_LENGTH} characters; "
                f"got {len(spec)}"
            ),
        )

    chunks = spec.split(";")
    if len(chunks) > _MAXIMUM_SUPERPOSITION_TERMS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"terms must contain at most {_MAXIMUM_SUPERPOSITION_TERMS} encoded terms; "
                f"got {len(chunks)}"
            ),
        )

    terms: list[SuperpositionTerm] = []
    for index, chunk in enumerate(chunks, start=1):
        fields = [piece.strip() for piece in chunk.split(",")]
        if len(fields) not in (4, 5):
            raise HTTPException(
                status_code=422,
                detail=f"malformed term {index} {chunk!r}; expected {_TERM_SPEC_HELP}",
            )
        if any(not field for field in fields):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"malformed term {index} {chunk!r}: empty fields are not allowed; "
                    f"expected {_TERM_SPEC_HELP}"
                ),
            )
        try:
            n, l, m = (int(value) for value in fields[:3])
            real = float(fields[3])
            imag = float(fields[4]) if len(fields) == 5 else 0.0
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"unparsable term {index} {chunk!r}"
            ) from exc
        _validate_or_422(n, l, m)
        if n > maximum_n:
            raise HTTPException(
                status_code=422,
                detail=f"{operation} supports n <= {maximum_n}; term {index} has n={n}",
            )
        try:
            terms.append(SuperpositionTerm(n, l, m, complex(real, imag)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        state = SuperpositionState(terms=tuple(terms), z=z, a_mu=a_mu, basis=basis)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if len(state.terms) > _MAXIMUM_SUPERPOSITION_TERMS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"a superposition may contain at most {_MAXIMUM_SUPERPOSITION_TERMS} active terms; "
                f"got {len(state.terms)}"
            ),
        )
    return state


def _superposition_catalog_entry(
    *,
    preset_id: str,
    label: str,
    terms: str,
    period_au: float,
    note: str,
) -> dict[str, object]:
    """Attach the actual builder floor rather than a duplicated client literal."""

    complex_state = _parse_superposition(
        terms,
        BasisKind.COMPLEX,
        maximum_n=_MAXIMUM_CURRENT_FIELD_N,
        operation="superposition catalogue current-field",
    )
    real_state = _parse_superposition(
        terms,
        BasisKind.REAL,
        maximum_n=_MAXIMUM_CURRENT_FIELD_N,
        operation="superposition catalogue current-field",
    )
    return {
        "id": preset_id,
        "label": label,
        "terms": terms,
        "period_au": period_au,
        "note": note,
        "slice_resolution_floor": superposition_slice_resolution_floor(complex_state),
        # The panel may render one preset in either basis.  Publish the safe
        # intersection so changing basis cannot turn an advertised request
        # into one the workload guard rejects.
        "streamline_seed_count_max": min(
            _superposition_current_seed_count_max(complex_state),
            _superposition_current_seed_count_max(real_state),
        ),
    }


@router.get("/superposition/catalog", response_model=list[SuperpositionCatalogEntry])
def superposition_catalog() -> list[dict[str, object]]:
    """Presets chosen to make the physics legible, including a negative control."""

    return [
        _superposition_catalog_entry(
            preset_id="1s-2pz",
            label="1s + 2p_z (Bohr oscillation)",
            terms="1,0,0,0.7071067811865476;2,1,0,0.7071067811865476",
            period_au=_hydrogenic_beat_period_au(1, 2),
            note="Dipole oscillates at omega = 3/8 hartree; the textbook radiating state.",
        ),
        _superposition_catalog_entry(
            preset_id="2s-2pz",
            label="2s + 2p_z (degenerate, stationary)",
            terms="2,0,0,0.7071067811865476;2,1,0,0.7071067811865476",
            period_au=_hydrogenic_beat_period_au(2, 2),
            note="Same energy, so nothing moves. A control: visible motion here is a bug.",
        ),
        _superposition_catalog_entry(
            preset_id="1s-3dz2",
            label="1s + 3d_z2",
            terms="1,0,0,0.7071067811865476;3,2,0,0.7071067811865476",
            period_au=_hydrogenic_beat_period_au(1, 3),
            note="omega = 4/9 hartree. No dipole coupling, so the breathing is quadrupolar.",
        ),
        _superposition_catalog_entry(
            preset_id="2pplus-2pminus",
            label="2p(+1) + 2p(-1)",
            terms="2,1,1,0.7071067811865476;2,1,-1,0.7071067811865476",
            period_au=_hydrogenic_beat_period_au(2, 2),
            note="Degenerate: a real p orbital in disguise, with zero net current.",
        ),
    ]


@lru_cache(maxsize=4)
def _cached_superposition_isosurface(
    state: SuperpositionState,
    time: float,
    resolution: int,
    probability_mass: float,
) -> SuperpositionIsosurfacePayload:
    return build_superposition_isosurface(
        state, time=time, resolution=resolution, probability_mass=probability_mass
    )


@router.get("/superposition/isosurface")
def superposition_isosurface(
    terms: str = Query(
        _DEFAULT_SUPERPOSITION_TERMS,
        min_length=1,
        max_length=_MAXIMUM_TERM_SPEC_LENGTH,
        description=_TERM_SPEC_HELP,
    ),
    time: float = Query(0.0, ge=-1_000.0, le=1_000.0),
    basis: BasisKind = BasisKind.COMPLEX,
    z: float = Query(1.0, gt=0.0, le=20.0),
    a_mu: float = Query(1.0, gt=0.0, le=20.0),
    resolution: int = Query(65, ge=49, le=81),
    probability_mass: float = Query(0.90, ge=0.50, le=0.99),
) -> SuperpositionIsosurfacePayload:
    r"""The :math:`|\Psi(t)|^2` level set of a superposition at one instant."""

    state = _parse_superposition(
        terms,
        basis,
        z=z,
        a_mu=a_mu,
        maximum_n=_MAXIMUM_ISOSURFACE_N,
        operation="superposition isosurface",
    )
    try:
        work_estimate = estimate_superposition_isosurface_workload(
            state,
            resolution=resolution,
            probability_mass=probability_mass,
        )
        work_limit = (
            _ADAPTIVE_ISOSURFACE_WORK_LIMIT
            if work_estimate.uses_adaptive_isosurface_budget
            else _ISOSURFACE_WORK_LIMIT
        )
        _enforce_request_workload(
            "superposition isosurface",
            active_terms=work_estimate.active_terms,
            work_per_term=sum(value**3 for value in work_estimate.resolutions),
            limit=work_limit,
            unit="term-voxel evaluations",
        )
        return _isolated_cached_payload(
            _cached_superposition_isosurface(
                state,
                time,
                resolution,
                probability_mass,
            )
        )
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@lru_cache(maxsize=2)
def _cached_superposition_current(
    state: SuperpositionState,
    time: float,
    seed_count: int,
    arc_step: float | None,
) -> SuperpositionCurrentPayload:
    return build_superposition_current_field(
        state, time=time, seed_count=seed_count, arc_step=arc_step
    )


@router.get("/superposition/current-field")
def superposition_current_field(
    terms: str = Query(
        _DEFAULT_SUPERPOSITION_TERMS,
        min_length=1,
        max_length=_MAXIMUM_TERM_SPEC_LENGTH,
        description=_TERM_SPEC_HELP,
    ),
    time: float = Query(0.0, ge=-1_000.0, le=1_000.0),
    basis: BasisKind = BasisKind.COMPLEX,
    z: float = Query(1.0, gt=0.0, le=20.0),
    a_mu: float = Query(1.0, gt=0.0, le=20.0),
    seed_count: int = Query(24, ge=1, le=_MAXIMUM_SUPERPOSITION_CURRENT_SEEDS),
    arc_step: float | None = Query(None, gt=0.0),
) -> SuperpositionCurrentPayload:
    """Probability-flow streamlines of a superposition, with its continuity residual."""

    state = _parse_superposition(
        terms,
        basis,
        z=z,
        a_mu=a_mu,
        maximum_n=_MAXIMUM_CURRENT_FIELD_N,
        operation="superposition current-field",
    )
    try:
        estimate = estimate_superposition_current_workload(
            state,
            seed_count=seed_count,
            arc_step=arc_step,
        )
        _enforce_current_field_workload("superposition current-field", estimate)
        return _isolated_cached_payload(
            _cached_superposition_current(
                state,
                time,
                seed_count,
                arc_step,
            )
        )
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/superposition/slice")
def superposition_slice(
    terms: str = Query(
        _DEFAULT_SUPERPOSITION_TERMS,
        min_length=1,
        max_length=_MAXIMUM_TERM_SPEC_LENGTH,
        description=_TERM_SPEC_HELP,
    ),
    time: float = Query(0.0, ge=-1_000.0, le=1_000.0),
    basis: BasisKind = BasisKind.COMPLEX,
    z: float = Query(1.0, gt=0.0, le=20.0),
    a_mu: float = Query(1.0, gt=0.0, le=20.0),
    plane: PrincipalPlane = PrincipalPlane.XZ,
    observable: SliceObservable = SliceObservable.PROBABILITY_DENSITY,
    resolution: int = Query(
        DEFAULT_SLICE_RESOLUTION,
        ge=MINIMUM_SLICE_RESOLUTION,
        le=MAXIMUM_SLICE_RESOLUTION,
    ),
) -> SuperpositionSlicePayload:
    """One scalar field of a superposition on a principal plane at one instant.

    The largest term sets both the extent and the resolution floor, so a
    resolution that is honest for a 1s slice can be refused here; the refusal
    names the shell that demands more samples.
    """

    state = _parse_superposition(
        terms,
        basis,
        z=z,
        a_mu=a_mu,
        maximum_n=_MAXIMUM_SLICE_N,
        operation="superposition slice",
    )
    _enforce_request_workload(
        "superposition slice",
        active_terms=len(state.terms),
        work_per_term=resolution**2,
        limit=_SLICE_WORK_LIMIT,
        unit="term-pixel evaluations",
    )
    try:
        return build_superposition_slice(
            state,
            time=time,
            plane=plane,
            observable=observable,
            resolution=resolution,
        )
    except _SCIENTIFIC_REQUEST_ERRORS as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
