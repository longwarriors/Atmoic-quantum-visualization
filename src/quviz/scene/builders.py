"""Build geometry from physically named observables."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from math import pi
from typing import Literal

import numpy as np
from skimage.measure import marching_cubes

from quviz.conventions import (
    ANGLE_CONVENTION,
    SPHERICAL_HARMONIC_CONVENTION,
    BasisKind,
    ObservableKind,
    RepresentationKind,
    SliceObservable,
)
from quviz.errors import ScientificComputationError
from quviz.physics.continuity import (
    continuity_audit_times,
    continuity_probe_candidates,
    select_continuity_probes,
    state_support_lengths,
)
from quviz.physics.finite_box import finite_grid_mass_diagnostic
from quviz.physics.hydrogenic import (
    cartesian_to_spherical,
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    orbital_label,
    radial_wavefunction,
    validate_quantum_numbers,
)
from quviz.physics.observables import (
    continuity_residual,
    density_time_derivative,
    phase,
    probability_current_hydrogenic,
    probability_density,
    superposition_current,
)
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.sampling.inverse_cdf import normalized_cdf
from quviz.scene.models import (
    CurrentFieldPayload,
    IsosurfacePayload,
    OrbitalMetadata,
    QuantumStateSpec,
    SliceDetail,
    SuperpositionCurrentPayload,
    SuperpositionIsosurfacePayload,
    SuperpositionMetadata,
    SuperpositionTermSpec,
)
from quviz.scene.streamlines import (
    hydrogenic_flow_velocity,
    integrate_streamlines,
    stable_vector_magnitudes,
)

_STREAMLINE_ARC_FRACTION = 0.03
_STREAMLINE_MAX_POINTS = 4_096
_STREAMLINE_MIN_ARC_FRACTION = 1.0 / _STREAMLINE_MAX_POINTS
_STREAMLINE_MAX_ARC_FRACTION = 1.0 / 8.0
_SEED_DENSITY_SCALED_FLOOR = 1e-4
_CONTINUITY_PROBE_COUNT = 8
_REALITY_RELATION_TOLERANCE = 64.0 * np.finfo(np.float64).eps
_RADIAL_TOPOLOGY_SAMPLES = 32_769
_RADIAL_GAP_SPACING_FRACTION = 0.8
_MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION = 129
_MAXIMUM_GENERAL_ISOSURFACE_RESOLUTION = 137
_GENERAL_TOPOLOGY_LEVEL_RELATIVE_TOLERANCE = 0.02
_GENERAL_TOPOLOGY_MASS_TOLERANCE = 0.002
_GENERAL_TOPOLOGY_CAPTURED_MASS_TOLERANCE = 5e-4
_PAYLOAD_DIMENSIONLESS_DECIMALS = 6
_PAYLOAD_SPEED_SIGNIFICANT_DIGITS = 12
_RK4_VELOCITY_EVALUATIONS_PER_STEP = 5
_SUPERPOSITION_CURRENT_SEED_LATTICE = 21
_MINIMUM_CURRENT_COULOMB_SCALE = float(np.finfo(np.float64).tiny ** 0.25)
_MAXIMUM_CURRENT_COULOMB_SCALE = float(np.finfo(np.float64).max ** 0.25)


_SLICE_FIELD_WORDS: dict[SliceObservable, str] = {
    SliceObservable.PROBABILITY_DENSITY: "probability density |psi|^2",
    SliceObservable.WAVEFUNCTION_REAL: "the real part of psi",
    SliceObservable.WAVEFUNCTION_IMAG: "the imaginary part of psi",
    SliceObservable.PHASE: "the principal phase of psi",
}

_SLICE_COLOR_WORDS: dict[SliceObservable, str] = {
    SliceObservable.PROBABILITY_DENSITY: (
        "probability density in bohr^-3; the density is unsigned, so no sign is encoded"
    ),
    SliceObservable.WAVEFUNCTION_REAL: (
        "signed real part of psi in bohr^-3/2; the sign is the wavefunction's, not a density's"
    ),
    SliceObservable.WAVEFUNCTION_IMAG: (
        "signed imaginary part of psi in bohr^-3/2; the sign is the wavefunction's, not a density's"
    ),
    SliceObservable.PHASE: (
        "principal phase of psi in [-pi, pi]; masked samples mark a low-amplitude, "
        "phase-undefined region and are not a certificate of a node"
    ),
}


def _validate_current_numeric_scale(*, z: float, a_mu: float) -> None:
    """Require the current's fourth-power scale to remain representable."""

    if z <= 0.0 or not np.isfinite(z):
        raise ValueError("z must be positive and finite")
    if a_mu <= 0.0 or not np.isfinite(a_mu):
        raise ValueError("a_mu must be positive and finite")
    log_scale = float(np.log(z) - np.log(a_mu))
    minimum_log = float(np.log(_MINIMUM_CURRENT_COULOMB_SCALE))
    maximum_log = float(np.log(_MAXIMUM_CURRENT_COULOMB_SCALE))
    if not minimum_log <= log_scale <= maximum_log:
        raise ValueError(
            "z / a_mu is outside the finite float64 probability-current range "
            f"[{_MINIMUM_CURRENT_COULOMB_SCALE:.6g}, "
            f"{_MAXIMUM_CURRENT_COULOMB_SCALE:.6g}]"
        )


def _quantize_scaled_values(values: np.ndarray, *, physical_scale: float) -> np.ndarray:
    """Quantize coordinates in dimensionless units, then restore their scale.

    Fixed decimal places in ordinary Bohr would erase contracted-state detail.
    Dividing by the exact Coulomb length before rounding preserves the existing
    ``Z=1, a_mu=1`` representation while making coordinate serialization
    covariant under ``r -> (a_mu/Z) r``.
    """

    if physical_scale <= 0.0 or not np.isfinite(physical_scale):
        raise ValueError("payload physical scale must be positive and finite")
    array = np.asarray(values, dtype=np.float64)
    return np.asarray(
        np.round(array / physical_scale, _PAYLOAD_DIMENSIONLESS_DECIMALS) * physical_scale,
        dtype=np.float64,
    )


def _serialize_scaled_speeds(values: np.ndarray, *, physical_scale: float) -> np.ndarray:
    """Keep weak non-zero flow using per-value significant-digit rounding.

    A fixed number of decimal places is appropriate for coordinates because
    their integration spacing has a fixed dimensionless lower bound.  It is
    not appropriate for speed: a physically active coherence can be many
    decades below one without being zero.  Formatting each dimensionless value
    to significant digits is deterministic, scale-covariant, and independent
    of what other streamlines happened to share the batch.
    """

    if physical_scale <= 0.0 or not np.isfinite(physical_scale):
        raise ValueError("payload physical scale must be positive and finite")
    dimensionless = np.asarray(values, dtype=np.float64) / physical_scale
    serialized = np.fromiter(
        (
            float(format(float(value), f".{_PAYLOAD_SPEED_SIGNIFICANT_DIGITS}g"))
            for value in dimensionless.flat
        ),
        dtype=np.float64,
        count=dimensionless.size,
    ).reshape(dimensionless.shape)
    return np.asarray(serialized * physical_scale, dtype=np.float64)


def _validate_slice_detail(
    representation: RepresentationKind, slice_detail: SliceDetail | None
) -> None:
    """Fail closed in both directions on the slice representation.

    A slice with no plane would leave the metadata unable to name the picture it
    describes; a plane on any other representation would name a plane the asset
    does not have.
    """

    if representation is RepresentationKind.SLICE:
        if slice_detail is None:
            raise ValueError("the slice representation requires slice_detail (plane and field)")
    elif slice_detail is not None:
        raise ValueError(
            f"slice_detail requires the slice representation, got {representation.value}"
        )


def _slice_semantics(slice_detail: SliceDetail) -> tuple[str, str]:
    """Return the geometry and color wording for one slice asset."""

    field = _SLICE_FIELD_WORDS[slice_detail.slice_observable]
    geometry = (
        f"plane section of {field} on the {slice_detail.plane.value} plane through the origin, "
        "sampled row-major with v along rows and u along columns"
    )
    return geometry, _SLICE_COLOR_WORDS[slice_detail.slice_observable]


def orbital_metadata(
    n: int,
    l: int,
    m: int,
    *,
    z: float,
    a_mu: float = 1.0,
    basis: BasisKind | str,
    observable: ObservableKind,
    representation: RepresentationKind,
    slice_detail: SliceDetail | None = None,
    warnings: list[str] | None = None,
) -> OrbitalMetadata:
    """Create metadata from the same inputs used by the numerical calculation.

    ``a_mu`` is the reduced-mass Bohr length in ordinary Bohr radii. It enters
    the energy as the mass ratio ``mu/m_e = 1/a_mu``, so a muonic length reports
    a muonic energy rather than the infinite-nuclear-mass number.
    """

    basis_kind = BasisKind(basis)
    validate_quantum_numbers(n, l, m)
    _validate_slice_detail(representation, slice_detail)
    # One branch per representation. A default that silently reuses another
    # asset's wording makes the Scene Contract describe a picture that is not
    # on screen, which is worse than having no description at all.
    geometry_by_representation = {
        RepresentationKind.POINT_CLOUD: (
            "independent samples from |psi|^2 dV; marker weight is uniform"
        ),
        RepresentationKind.ISOSURFACE: "level set of probability density |psi|^2",
        RepresentationKind.STREAMLINES: (
            "streamlines of probability flow v = j / rho, sampled at equal arc length; "
            "these are flow lines, not electron trajectories"
        ),
        # Reached only if the slice guard above is ever loosened: a slice with a
        # SliceDetail names its plane and field instead of this generic wording.
        RepresentationKind.SLICE: "plane section of the scalar field",
    }
    if slice_detail is not None:
        # Guaranteed by _validate_slice_detail to be exactly the slice case, so
        # the generic wording below never overwrites a named plane.
        geometry_semantics, color_semantics = _slice_semantics(slice_detail)
    else:
        geometry_semantics = geometry_by_representation[representation]
        if representation is RepresentationKind.STREAMLINES:
            color_semantics = "flow speed |j|/rho normalized to the reported maximum"
        elif basis_kind is BasisKind.REAL:
            color_semantics = "wavefunction sign encoded as phase 0 or pi"
        else:
            color_semantics = "principal wavefunction phase in [-pi, pi]"
    return OrbitalMetadata(
        state=QuantumStateSpec(n=n, l=l, m=m, z=z, a_mu=a_mu, basis=basis_kind),
        label=orbital_label(n, l, m, basis=basis_kind),
        energy_hartree=hydrogenic_energy_hartree(n, z=z, reduced_mass_ratio=1.0 / a_mu),
        observable=observable,
        representation=representation,
        coordinate_convention=ANGLE_CONVENTION,
        spherical_harmonic_convention=SPHERICAL_HARMONIC_CONVENTION,
        geometry_semantics=geometry_semantics,
        color_semantics=color_semantics,
        references=[
            "dlmf-spherical-harmonics",
            "dlmf-laguerre",
            "scipy-sph-harm-y",
            "solara-hydrogen-derivation",
        ],
        warnings=warnings or [],
    )


def radial_extent_for_mass(
    n: int,
    l: int,
    z: float,
    *,
    a_mu: float = 1.0,
    target_mass: float = 0.9999,
    grid_size: int = 32_769,
) -> float:
    """Return a padded radial quantile for an efficient finite cube."""

    r_max = max(8.0 * n * n * a_mu / z, 12.0 * a_mu / z)
    captured = 0.0
    for _ in range(8):
        radius = np.linspace(0.0, r_max, grid_size, dtype=np.float64)
        radial = radial_wavefunction(n, l, radius, z=z, a_mu=a_mu)
        radial_density = radius * radius * radial * radial
        cdf, captured = normalized_cdf(radius, radial_density)
        if captured >= target_mass:
            absolute_cdf = cdf * captured
            quantile = float(np.interp(target_mass, absolute_cdf, radius))
            return max(1.05 * quantile, 4.0 * a_mu / z)
        r_max *= 1.7
    raise ScientificComputationError(
        f"radial extent search captured only {captured:.8f}; increase expansion budget"
    )


def _simpson_weights_3d(resolution: int, spacing: float) -> np.ndarray:
    """Return tensor-product Simpson weights for an odd uniform cubic grid."""

    axis_weights = np.ones(resolution, dtype=np.float64)
    axis_weights[1:-1:2] = 4.0
    axis_weights[2:-1:2] = 2.0
    axis_weights *= spacing / 3.0
    return axis_weights[:, None, None] * axis_weights[None, :, None] * axis_weights[None, None, :]


def _density_threshold_for_mass(
    density: np.ndarray, integration_weights: np.ndarray, mass: float
) -> tuple[float, float, float]:
    """Find a superlevel-set threshold for an absolute probability mass.

    Hydrogenic states are analytically normalized. Therefore ``mass=0.90`` means
    90% of the full-space probability, not 90% of whatever fraction happens to
    lie in the finite numerical cube.
    """

    flat = np.asarray(density, dtype=np.float64).ravel()
    weights = np.asarray(integration_weights, dtype=np.float64).ravel()
    if flat.shape != weights.shape:
        raise ValueError("density and integration weights must have the same shape")
    order = np.argsort(flat)[::-1]
    sorted_density = flat[order]
    cumulative = np.cumsum(sorted_density * weights[order])
    total = float(np.sum(flat * weights))
    if total <= 0.0 or not np.isfinite(total):
        raise ValueError("density grid has no finite probability mass")
    if total < mass:
        raise ValueError(f"finite grid captures only {total:.6f}, below requested mass {mass:.6f}")
    index = int(np.searchsorted(cumulative, mass, side="left"))
    index = min(index, sorted_density.size - 1)
    level = float(sorted_density[index])
    captured = float(np.sum(flat[flat >= level] * weights[flat >= level]))
    return level, captured, total


@dataclass(frozen=True, slots=True)
class _MeshResult:
    vertices: np.ndarray
    faces: np.ndarray
    normals: np.ndarray
    vertex_psi: np.ndarray
    level: float
    captured: float
    integrated_mass: float
    spacing: float


def _odd_resolution_for_spacing(extent: float, maximum_spacing: float) -> int:
    """Return the smallest odd grid size whose cubic-axis spacing is small enough."""

    intervals = int(np.ceil(2.0 * extent / maximum_spacing))
    if intervals % 2 != 0:
        intervals += 1
    return intervals + 1


def _s_radial_superlevel_topology(
    n: int,
    *,
    z: float,
    a_mu: float,
    extent: float,
    level: float,
) -> tuple[int, float | None]:
    """Return the exact radial topology sampled on a fine one-dimensional oracle.

    For an s orbital, ``|psi|^2`` is radial.  Every crossing of the requested
    density level is therefore one concentric boundary component.  The narrow
    below-level intervals around radial nodes are the feature that a Cartesian
    marching-cubes grid must not skip.
    """

    radius = np.linspace(0.0, extent, _RADIAL_TOPOLOGY_SAMPLES, dtype=np.float64)
    radial = radial_wavefunction(n, 0, radius, z=z, a_mu=a_mu)
    density = radial * radial / (4.0 * pi)
    above = density >= level
    if not bool(above[0]) or bool(above[-1]):
        raise ScientificComputationError(
            "s-orbital radial topology oracle does not bracket the level set"
        )

    transition_indices = np.flatnonzero(above[1:] != above[:-1])
    crossings: list[float] = []
    for index in transition_indices:
        left_value = float(density[index] - level)
        right_value = float(density[index + 1] - level)
        denominator = right_value - left_value
        fraction = 0.5 if denominator == 0.0 else -left_value / denominator
        crossings.append(float(radius[index] + fraction * (radius[index + 1] - radius[index])))

    # Starting above the level, pairs (falling, rising) delimit the low-density
    # gap around each radial node.  The final unpaired crossing bounds the tail.
    nodal_gaps = [
        crossings[index + 1] - crossings[index] for index in range(0, len(crossings) - 1, 2)
    ]
    return len(crossings), min(nodal_gaps) if nodal_gaps else None


def _s_isosurface_resolution_requirement(
    n: int,
    *,
    z: float,
    a_mu: float,
    extent: float,
    probability_mass: float,
) -> tuple[int, int]:
    """Estimate the grid required to separate every radial-node boundary."""

    radius = np.linspace(0.0, extent, _RADIAL_TOPOLOGY_SAMPLES, dtype=np.float64)
    spacing = float(radius[1] - radius[0])
    radial = radial_wavefunction(n, 0, radius, z=z, a_mu=a_mu)
    density = radial * radial / (4.0 * pi)
    weights = np.ones(_RADIAL_TOPOLOGY_SAMPLES, dtype=np.float64)
    weights[1:-1:2] = 4.0
    weights[2:-1:2] = 2.0
    weights *= spacing / 3.0
    spherical_volume_weights = 4.0 * pi * radius * radius * weights
    level, _, _ = _density_threshold_for_mass(density, spherical_volume_weights, probability_mass)
    expected_components, narrowest_gap = _s_radial_superlevel_topology(
        n,
        z=z,
        a_mu=a_mu,
        extent=extent,
        level=level,
    )
    if narrowest_gap is None:
        return 3, expected_components
    required = _odd_resolution_for_spacing(extent, _RADIAL_GAP_SPACING_FRACTION * narrowest_gap)
    return required, expected_components


def _mesh_component_euler_characteristics(faces: np.ndarray) -> tuple[int, ...]:
    """Return a sorted Euler-characteristic multiset, one value per component."""

    face_array = np.asarray(faces, dtype=np.int64)
    parent = np.arange(int(np.max(face_array)) + 1, dtype=np.int64)

    def root(vertex: int) -> int:
        while parent[vertex] != vertex:
            parent[vertex] = parent[parent[vertex]]
            vertex = int(parent[vertex])
        return vertex

    for first, second, third in face_array:
        for left, right in ((first, second), (second, third)):
            left_root = root(int(left))
            right_root = root(int(right))
            if left_root != right_root:
                parent[right_root] = left_root
    face_roots = np.asarray([root(int(face[0])) for face in face_array], dtype=np.int64)
    return tuple(
        sorted(
            _mesh_euler_characteristic(face_array[face_roots == component_root])
            for component_root in np.unique(face_roots)
        )
    )


def _mesh_component_count(faces: np.ndarray) -> int:
    """Count connected triangle components without depending on mesh tooling."""

    return len(_mesh_component_euler_characteristics(faces))


def _mesh_euler_characteristic(faces: np.ndarray) -> int:
    """Return V-E+F for the indexed triangular surface."""

    face_array = np.asarray(faces, dtype=np.int64)
    edges = np.vstack(
        (
            face_array[:, (0, 1)],
            face_array[:, (1, 2)],
            face_array[:, (2, 0)],
        )
    )
    edges.sort(axis=1)
    vertex_count = np.unique(face_array).size
    edge_count = np.unique(edges, axis=0).shape[0]
    return int(vertex_count - edge_count + face_array.shape[0])


def _general_meshes_have_stable_topology(coarse: _MeshResult, fine: _MeshResult) -> bool:
    """Empirical two-grid gate for a non-radial superposition mesh."""

    coarse_signature = _mesh_component_euler_characteristics(coarse.faces)
    fine_signature = _mesh_component_euler_characteristics(fine.faces)
    level_scale = max(abs(coarse.level), abs(fine.level), np.finfo(np.float64).tiny)
    return (
        coarse_signature == fine_signature
        and abs(coarse.level - fine.level) / level_scale
        <= _GENERAL_TOPOLOGY_LEVEL_RELATIVE_TOLERANCE
        and abs(coarse.integrated_mass - fine.integrated_mass) <= _GENERAL_TOPOLOGY_MASS_TOLERANCE
        and abs(coarse.captured - fine.captured) <= _GENERAL_TOPOLOGY_CAPTURED_MASS_TOLERANCE
    )


def _build_density_mesh(
    evaluate: Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray],
    *,
    extent: float,
    resolution: int,
    probability_mass: float,
) -> _MeshResult:
    """Marching-cubes core shared by every density isosurface.

    Takes a wavefunction evaluator rather than quantum numbers so a single
    eigenstate and a time-dependent superposition produce geometry through the
    same code path, including the winding fix and the mass accounting.
    """

    axis = np.linspace(-extent, extent, resolution, dtype=np.float64)
    spacing = float(axis[1] - axis[0])
    x, y, z_coord = np.meshgrid(axis, axis, axis, indexing="ij")
    radius, theta, phi = cartesian_to_spherical(x, y, z_coord)
    density = probability_density(evaluate(radius, theta, phi))
    integration_weights = _simpson_weights_3d(resolution, spacing)
    level, captured, integrated_mass = _density_threshold_for_mass(
        density, integration_weights, probability_mass
    )
    if not float(np.min(density)) < level < float(np.max(density)):
        raise ScientificComputationError("computed isosurface level is outside the density range")

    try:
        vertices, faces, normals, _ = marching_cubes(  # type: ignore[no-untyped-call]
            density.astype(np.float32),
            level=level,
            spacing=(spacing, spacing, spacing),
            allow_degenerate=False,
        )
    except RuntimeError as exc:
        if type(exc) is not RuntimeError:
            raise
        # scikit-image raises RuntimeError when float32 conversion leaves no
        # representable crossing at an otherwise valid float64 density level.
        # Translate only this third-party computation boundary; unrelated
        # RuntimeError subclasses must still surface as programming failures.
        raise ScientificComputationError(
            f"isosurface extraction failed at the computed density level: {exc}"
        ) from exc
    vertices += np.asarray([axis[0], axis[0], axis[0]], dtype=np.float32)
    face_normals = np.cross(
        vertices[faces[:, 1]] - vertices[faces[:, 0]],
        vertices[faces[:, 2]] - vertices[faces[:, 0]],
    )
    mean_vertex_normals = np.mean(normals[faces], axis=1)
    if float(np.mean(np.einsum("ij,ij->i", face_normals, mean_vertex_normals))) < 0.0:
        faces = faces[:, [0, 2, 1]]
    vertex_r, vertex_theta, vertex_phi = cartesian_to_spherical(
        vertices[:, 0], vertices[:, 1], vertices[:, 2]
    )
    return _MeshResult(
        vertices=vertices,
        faces=faces,
        normals=normals,
        vertex_psi=evaluate(vertex_r, vertex_theta, vertex_phi),
        level=level,
        captured=captured,
        integrated_mass=integrated_mass,
        spacing=spacing,
    )


def _build_eigenstate_density_mesh(
    evaluate: Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray],
    *,
    n: int,
    l: int,
    z: float,
    a_mu: float,
    extent: float,
    requested_resolution: int,
    probability_mass: float,
) -> tuple[_MeshResult, int]:
    """Build an eigenstate mesh, adapting or failing closed for compact s-state nodes."""

    effective_resolution = requested_resolution
    expected_components: int | None = None
    if l == 0 and n > 1:
        required, expected_components = _s_isosurface_resolution_requirement(
            n,
            z=z,
            a_mu=a_mu,
            extent=extent,
            probability_mass=probability_mass,
        )
        if required > _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION:
            raise ValueError(
                f"the {n}s radial-node topology at probability_mass={probability_mass:.6g} "
                f"requires an estimated odd grid resolution of at least {required}, exceeding "
                f"the validated adaptive cap {_MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION}"
            )
        effective_resolution = max(effective_resolution, required)

    mesh = _build_density_mesh(
        evaluate,
        extent=extent,
        resolution=effective_resolution,
        probability_mass=probability_mass,
    )
    if expected_components is None:
        return mesh, effective_resolution

    # Re-evaluate the oracle at the level actually selected by the 3-D Simpson
    # grid.  This closes the small gap between the radial preflight threshold
    # and the final cubic-grid threshold instead of trusting the estimate.
    actual_expected, actual_gap = _s_radial_superlevel_topology(
        n,
        z=z,
        a_mu=a_mu,
        extent=extent,
        level=mesh.level,
    )
    if actual_gap is not None:
        actual_required = _odd_resolution_for_spacing(
            extent, _RADIAL_GAP_SPACING_FRACTION * actual_gap
        )
        if actual_required > _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION:
            raise ValueError(
                f"the {n}s radial-node topology at the selected density level requires an "
                f"estimated odd grid resolution of at least {actual_required}, exceeding the "
                f"validated adaptive cap {_MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION}"
            )
        if actual_required > effective_resolution:
            effective_resolution = actual_required
            mesh = _build_density_mesh(
                evaluate,
                extent=extent,
                resolution=effective_resolution,
                probability_mass=probability_mass,
            )
            actual_expected, _ = _s_radial_superlevel_topology(
                n,
                z=z,
                a_mu=a_mu,
                extent=extent,
                level=mesh.level,
            )

    observed_components = _mesh_component_count(mesh.faces)
    if observed_components != actual_expected:
        raise ValueError(
            f"the {n}s isosurface did not converge to its radial topology at resolution "
            f"{effective_resolution}: expected {actual_expected} concentric boundary components, "
            f"observed {observed_components}"
        )
    return mesh, effective_resolution


def build_isosurface(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    basis: BasisKind | str = BasisKind.REAL,
    resolution: int = 65,
    probability_mass: float = 0.90,
) -> IsosurfacePayload:
    """Build a density isosurface whose superlevel set encloses a target mass.

    The returned surface is a representation of ``|psi|² = constant``. Vertex
    phase is evaluated separately so that complex phase or real sign can be
    shown without pretending that density itself is signed.
    """

    validate_quantum_numbers(n, l, m)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if n > 4:
        raise ValueError("isosurface generation is validated only for n <= 4")
    minimum_resolution = max(49, 16 * n + 17)
    if resolution < minimum_resolution or resolution > 81:
        raise ValueError(f"resolution must be between {minimum_resolution} and 81 for n={n}")
    if resolution % 2 == 0:
        raise ValueError("resolution must be odd so Cartesian nodal planes lie on the grid")
    if not 0.50 <= probability_mass <= 0.99:
        raise ValueError("probability_mass must be between 0.50 and 0.99")
    basis_kind = BasisKind(basis)

    extent = radial_extent_for_mass(n, l, z)
    mesh, effective_resolution = _build_eigenstate_density_mesh(
        lambda r, th, ph: hydrogenic_wavefunction(n, l, m, r, th, ph, z=z, basis=basis_kind),
        n=n,
        l=l,
        z=z,
        a_mu=1.0,
        extent=extent,
        requested_resolution=resolution,
        probability_mass=probability_mass,
    )
    vertices, faces, normals = mesh.vertices, mesh.faces, mesh.normals
    vertex_psi = mesh.vertex_psi
    level, captured, integrated_mass = mesh.level, mesh.captured, mesh.integrated_mass
    spacing = mesh.spacing

    warnings: list[str] = []
    if abs(integrated_mass - 1.0) > 0.002:
        warnings.append(
            f"finite-grid density integral is {integrated_mass:.6f}; increase resolution"
        )
    if effective_resolution != resolution:
        warnings.append(
            f"grid resolution was increased from {resolution} to {effective_resolution} to "
            "resolve the radial-node topology"
        )
    if basis_kind is BasisKind.COMPLEX and m != 0:
        warnings.append("surface geometry represents density; color carries wavefunction phase")

    metadata = orbital_metadata(
        n,
        l,
        m,
        z=z,
        basis=basis_kind,
        observable=ObservableKind.PROBABILITY_DENSITY,
        representation=RepresentationKind.ISOSURFACE,
        warnings=warnings,
    )
    return IsosurfacePayload(
        metadata=metadata,
        vertices=np.round(vertices, 6).tolist(),
        normals=np.round(normals, 6).tolist(),
        faces=faces.astype(np.int32).tolist(),
        phase=np.round(np.mod(phase(vertex_psi) + pi, 2.0 * pi) - pi, 6).tolist(),
        density_level=level,
        requested_probability_mass=probability_mass,
        captured_probability_mass=captured,
        finite_grid_density_integral=integrated_mass,
        grid_resolution=effective_resolution,
        grid_spacing_bohr=spacing,
        extent_bohr=extent,
    )


def _stationary_continuity_diagnostic(
    velocity_state: tuple[int, int, int, float, BasisKind],
) -> tuple[
    float,
    float,
    float,
    Literal["stationary_current", "analytic_zero_current"],
    int,
]:
    r"""Audit :math:`\nabla\cdot\mathbf j=0` on scale-aware probes."""

    n, l, m, z, basis_kind = velocity_state
    state = SuperpositionState(
        terms=(SuperpositionTerm(n, l, m, 1.0),),
        z=z,
        basis=basis_kind,
    )
    differential_length, _, _ = state_support_lengths(state)
    candidates = continuity_probe_candidates(state)

    if basis_kind is BasisKind.REAL or m == 0:
        return 0.0, 0.0, 0.0, "analytic_zero_current", 0

    def current_at(points: np.ndarray) -> np.ndarray:
        radius, polar, azimuth = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
        return probability_current_hydrogenic(
            n,
            l,
            m,
            radius,
            polar,
            azimuth,
            z=z,
            basis=basis_kind,
            density_floor=0.0,
        )

    candidate_magnitude = stable_vector_magnitudes(current_at(candidates))
    keep = np.argsort(candidate_magnitude)[::-1][:_CONTINUITY_PROBE_COUNT]
    probes = np.asarray(candidates[keep], dtype=np.float64)
    step = 1e-4 * differential_length
    divergence = np.zeros(probes.shape[0], dtype=np.float64)
    for axis in range(3):
        offset = np.zeros(3)
        offset[axis] = step
        forward = current_at(probes + offset)[:, axis]
        backward = current_at(probes - offset)[:, axis]
        divergence += (forward - backward) / (2.0 * step)

    absolute = float(np.max(np.abs(divergence)))
    scale = float(np.max(stable_vector_magnitudes(current_at(probes))) / differential_length)
    if scale <= 0.0:
        raise ScientificComputationError(
            "non-zero stationary current had no resolvable diagnostic scale"
        )
    return absolute / scale, absolute, scale, "stationary_current", probes.shape[0]


def _resolve_arc_step(arc_step: float | None, support_length: float) -> float:
    """Resolve and validate the dimensionless streamline sampling contract."""

    resolved = _STREAMLINE_ARC_FRACTION * support_length if arc_step is None else arc_step
    minimum = _STREAMLINE_MIN_ARC_FRACTION * support_length
    maximum = _STREAMLINE_MAX_ARC_FRACTION * support_length
    if not np.isfinite(resolved) or not minimum <= resolved <= maximum:
        raise ValueError("arc_step / support_length must be between 1/4096 and 1/8 inclusive")
    return resolved


def _streamline_point_budget(path_length: float, arc_step: float) -> int:
    """Cap before division so extreme finite lengths cannot overflow."""

    if path_length < 0.0 or not np.isfinite(path_length):
        raise ValueError("streamline path length must be non-negative and finite")
    uncapped_points = _STREAMLINE_MAX_POINTS - 8
    if arc_step <= path_length / uncapped_points:
        return _STREAMLINE_MAX_POINTS
    return int(path_length / arc_step) + 8


@dataclass(frozen=True, slots=True)
class CurrentFieldWorkEstimate:
    """Conservative integration and serialization cost for a current field.

    ``max_points_per_line`` bounds the number of vertices retained for each
    requested seed.  A batched RK4 advance evaluates the velocity four times
    for the stages and once more at the candidate point, in addition to the
    initial seed evaluation.  Multiplying that count by the number of active
    hydrogenic terms therefore tracks the expensive wavefunction work rather
    than merely counting seeds. A general superposition also evaluates the
    initial velocity of every density-live candidate before choosing usable
    seeds; ``seed_filter_evaluations_per_term`` is the conservative lattice-wide
    bound for that pass.
    """

    active_terms: int
    requested_seeds: int
    max_points_per_line: int
    seed_filter_evaluations_per_term: int = 0

    @property
    def serialized_path_samples(self) -> int:
        return self.requested_seeds * self.max_points_per_line

    @property
    def velocity_evaluations_per_term(self) -> int:
        if self.max_points_per_line == 0:
            return self.seed_filter_evaluations_per_term
        stages_per_seed = 1 + _RK4_VELOCITY_EVALUATIONS_PER_STEP * (self.max_points_per_line - 1)
        return self.seed_filter_evaluations_per_term + self.requested_seeds * stages_per_seed

    @property
    def term_velocity_evaluations(self) -> int:
        return self.active_terms * self.velocity_evaluations_per_term


def estimate_current_field_workload(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    seed_count: int = 48,
    arc_step: float | None = None,
) -> CurrentFieldWorkEstimate:
    """Bound RK4 work and output size before building an eigenstate field."""

    validate_quantum_numbers(n, l, m)
    _validate_current_numeric_scale(z=z, a_mu=1.0)
    if seed_count < 1:
        raise ValueError("seed_count must be positive")
    support_length = n * n / z
    resolved_arc_step = _resolve_arc_step(arc_step, support_length)
    basis_kind = BasisKind(basis)
    if basis_kind is BasisKind.REAL or m == 0:
        return CurrentFieldWorkEstimate(1, seed_count, 0)

    # The builder uses the widest retained cylindrical seed.  No retained seed
    # can be wider than the finite-box extent, so this is conservative without
    # repeating its density lattice just for preflight.
    extent = radial_extent_for_mass(n, l, z)
    max_points = _streamline_point_budget(2.0 * pi * extent, resolved_arc_step)
    return CurrentFieldWorkEstimate(1, seed_count, max_points)


def estimate_superposition_current_workload(
    state: SuperpositionState,
    *,
    seed_count: int = 48,
    arc_step: float | None = None,
    lattice: int = _SUPERPOSITION_CURRENT_SEED_LATTICE,
) -> CurrentFieldWorkEstimate:
    """Bound RK4 work and output size before building a superposition field."""

    if seed_count < 1:
        raise ValueError("seed_count must be positive")
    if lattice < 1:
        raise ValueError("lattice must be positive")
    if len(state.terms) > 8:
        raise ValueError("current-field diagnostics support at most 8 active terms")
    _validate_current_numeric_scale(z=state.z, a_mu=state.a_mu)
    _, compact_support, _ = state_support_lengths(state)
    resolved_arc_step = _resolve_arc_step(arc_step, compact_support)
    if _has_analytic_zero_stationary_current(state):
        return CurrentFieldWorkEstimate(len(state.terms), seed_count, 0)

    max_points = _streamline_point_budget(4.0 * superposition_extent(state), resolved_arc_step)
    return CurrentFieldWorkEstimate(
        len(state.terms),
        seed_count,
        max_points,
        seed_filter_evaluations_per_term=lattice**3,
    )


def build_current_field(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    seed_count: int = 48,
    arc_step: float | None = None,
) -> CurrentFieldPayload:
    r"""Build probability-flow streamlines for one hydrogenic state.

    Seeds are placed on a deterministic lattice in the :math:`(s,z)` half-plane
    at :math:`\phi=0`.  The default arc step is ``0.03 n²/Z`` and the density
    cutoff obeys ``rho_min (n²/Z)³ = 1e-4``; both are dimensionless contracts
    rather than fixed ordinary-Bohr numbers. Explicit steps must satisfy
    ``1/4096 <= arc_step / (n²/Z) <= 1/8``: the lower limit is tied to the
    integration point budget and the upper limit retains about 50 samples on
    a circular path whose radius is one characteristic support length.

    That seeding exploits the azimuthal symmetry of a *stationary* state, where
    every flow line is a circle of constant :math:`s` and :math:`z` and so one
    azimuth already enumerates all distinct lines. Time-dependent M1 states
    break that symmetry, so their separate builder uses density-ranked seeds in
    three dimensions; the integrator itself makes no seeding assumption.
    """

    validate_quantum_numbers(n, l, m)
    _validate_current_numeric_scale(z=z, a_mu=1.0)
    if seed_count < 1:
        raise ValueError("seed_count must be positive")
    support_length = n * n / z
    resolved_arc_step = _resolve_arc_step(arc_step, support_length)
    basis_kind = BasisKind(basis)

    extent = radial_extent_for_mass(n, l, z)
    warnings: list[str] = []
    if basis_kind is BasisKind.REAL:
        warnings.append(
            "real stationary orbitals carry zero probability current; "
            "switch to the complex basis to see flow"
        )
    elif m == 0:
        warnings.append("m = 0 states carry zero probability current")

    lines: list[list[list[float]]] = []
    speeds: list[list[float]] = []
    max_speed = 0.0
    density_floor = _SEED_DENSITY_SCALED_FLOOR / support_length**3
    length_serialization_scale = 1.0 / z
    speed_serialization_scale = z

    if basis_kind is BasisKind.COMPLEX and m != 0:
        lattice = max(8, int(np.sqrt(seed_count * 4)))
        cylindrical = np.linspace(extent / (2 * lattice), extent, lattice)
        heights = np.linspace(-extent, extent, lattice)
        grid_s, grid_z = np.meshgrid(cylindrical, heights, indexing="ij")
        candidates = np.column_stack((grid_s.ravel(), np.zeros(grid_s.size), grid_z.ravel()))
        radius, polar, azimuth = cartesian_to_spherical(
            candidates[:, 0], candidates[:, 1], candidates[:, 2]
        )
        density = probability_density(
            hydrogenic_wavefunction(n, l, m, radius, polar, azimuth, z=z, basis=basis_kind)
        )
        keep = np.flatnonzero(density > density_floor)
        # Highest density first, so a small seed_count still shows the core flow.
        keep = keep[np.argsort(density[keep])[::-1]][:seed_count]
        keep = keep[np.argsort(radius[keep])]

        if keep.size:
            seeds = candidates[keep]
            velocity = hydrogenic_flow_velocity(
                n,
                l,
                m,
                z=z,
                basis=basis_kind,
                density_floor=density_floor,
            )
            # One budget for the bundle: the widest orbit sets it, and closure
            # retires the tighter ones early.
            widest = float(np.max(np.hypot(seeds[:, 0], seeds[:, 1])))
            budget = _streamline_point_budget(2.0 * pi * widest, resolved_arc_step)
            for line in integrate_streamlines(
                velocity,
                seeds,
                arc_step=resolved_arc_step,
                max_points=budget,
                close_tolerance=0.5 * resolved_arc_step,
            ):
                if line.vertices.shape[0] < 4:
                    continue
                quantized_speed = _serialize_scaled_speeds(
                    line.speed, physical_scale=speed_serialization_scale
                )
                lines.append(
                    _quantize_scaled_values(
                        line.vertices, physical_scale=length_serialization_scale
                    ).tolist()
                )
                speeds.append(quantized_speed.tolist())
                max_speed = max(max_speed, float(np.max(quantized_speed)))

    metadata = orbital_metadata(
        n,
        l,
        m,
        z=z,
        basis=basis_kind,
        observable=ObservableKind.PROBABILITY_CURRENT,
        representation=RepresentationKind.STREAMLINES,
        warnings=warnings,
    )
    normalized, absolute, scale, scale_kind, probe_count = _stationary_continuity_diagnostic(
        (n, l, m, z, basis_kind)
    )
    return CurrentFieldPayload(
        metadata=metadata,
        lines=lines,
        speed=speeds,
        seed_count=len(lines),
        max_speed=max_speed,
        arc_step_bohr=resolved_arc_step,
        seed_density_floor=density_floor,
        extent_bohr=extent,
        continuity_residual=normalized,
        continuity_absolute_residual=absolute,
        continuity_scale=scale,
        continuity_scale_kind=scale_kind,
        continuity_probe_count=probe_count,
    )


def superposition_metadata(
    state: SuperpositionState,
    *,
    time: float,
    observable: ObservableKind,
    representation: RepresentationKind,
    slice_detail: SliceDetail | None = None,
    warnings: list[str] | None = None,
) -> SuperpositionMetadata:
    """Metadata for a superposition asset, including the instant it depicts."""

    _validate_slice_detail(representation, slice_detail)
    notes = list(warnings or [])
    if state.is_stationary and len(state.terms) > 1:
        notes.append(
            "all terms share one energy, so this superposition is stationary: "
            "the density does not evolve and any apparent motion is an artefact"
        )
    if slice_detail is not None:
        geometry, color = _slice_semantics(slice_detail)
        geometry = f"{geometry}, at the stated time"
    elif representation is RepresentationKind.STREAMLINES:
        geometry = (
            "streamlines of probability flow v = j / rho, sampled at equal arc length; "
            "these are flow lines, not electron trajectories"
        )
        color = "flow speed |j|/rho normalized to the reported maximum"
    else:
        geometry = "level set of probability density |Psi|^2 at the stated time"
        color = "principal wavefunction phase in [-pi, pi]"
    return SuperpositionMetadata(
        terms=[
            SuperpositionTermSpec(
                n=term.n,
                l=term.l,
                m=term.m,
                coefficient_real=float(np.real(term.coefficient)),
                coefficient_imag=float(np.imag(term.coefficient)),
            )
            for term in state.terms
        ],
        label=state.label(),
        basis=state.basis,
        z=state.z,
        a_mu=state.a_mu,
        reduced_mass_ratio=state.reduced_mass_ratio,
        time_au=time,
        energy_expectation_hartree=state.energy_expectation,
        is_stationary=state.is_stationary,
        observable=observable,
        representation=representation,
        coordinate_convention=ANGLE_CONVENTION,
        spherical_harmonic_convention=SPHERICAL_HARMONIC_CONVENTION,
        geometry_semantics=geometry,
        color_semantics=color,
        references=["dlmf-spherical-harmonics", "dlmf-laguerre", "griffiths2018qm"],
        warnings=notes,
    )


def superposition_extent(state: SuperpositionState) -> float:
    """The widest term sets the cube: a smaller box would clip a real component."""

    return max(
        radial_extent_for_mass(term.n, term.l, state.z, a_mu=state.a_mu) for term in state.terms
    )


@dataclass(frozen=True, slots=True)
class SuperpositionIsosurfaceWorkEstimate:
    """Conservative full-grid work bound for one superposition isosurface.

    ``resolutions`` contains one entry for every full cubic-grid pass covered
    by the request budget; each pass evaluates all ``active_terms`` once.
    Repeated entries are intentional: every completed payload runs the finite-
    grid mass diagnostic once more at its final mesh resolution.  A single
    excited-s state can also rebuild its mesh after the selected density level
    tightens the radial oracle, so that possible pass is bounded separately.

    ``general_topology_resolutions`` is the actual finest-two mesh schedule for
    a multi-term state containing an excited-s component.  Keeping it separate
    prevents repeated diagnostic work from being mistaken for evidence that a
    general topology-convergence gate is required, and prevents unused coarse
    probes from being built or charged to the request.

    This is not an exact total-compute estimate.  In particular, the number of
    marching-cubes vertices whose wavefunction phase is evaluated depends on
    the generated surface rather than only on the request parameters.
    """

    active_terms: int
    resolutions: tuple[int, ...]
    general_topology_resolutions: tuple[int, ...]
    uses_adaptive_isosurface_budget: bool

    @property
    def term_voxel_evaluations(self) -> int:
        return self.active_terms * sum(resolution**3 for resolution in self.resolutions)

    @property
    def requires_general_topology_convergence(self) -> bool:
        return bool(self.general_topology_resolutions)


def estimate_superposition_isosurface_workload(
    state: SuperpositionState,
    *,
    resolution: int,
    probability_mass: float,
) -> SuperpositionIsosurfaceWorkEstimate:
    """Bound every predictable full-grid term evaluation before mesh building.

    An active excited-s component can contain narrow radial-node gaps, but a
    multi-term state is not radial and must never be classified as a pure s
    state by a coefficient tolerance.  Its pure-component oracle is used only
    to choose the coarser member of the finest-two check when that requirement
    lies above 129; acceptance is based on independent topology and mass
    convergence against the validated 137 cap.  The returned budget also
    includes the final finite-grid mass diagnostic and the possible selected-
    level rebuild of a single excited-s state.
    """

    excited_s_terms = [term for term in state.terms if term.n > 1 and term.l == 0]
    if not excited_s_terms:
        return SuperpositionIsosurfaceWorkEstimate(
            active_terms=len(state.terms),
            resolutions=(resolution, resolution),
            general_topology_resolutions=(),
            uses_adaptive_isosurface_budget=False,
        )

    extent = superposition_extent(state)
    suggested_resolution = max(
        _s_isosurface_resolution_requirement(
            term.n,
            z=state.z,
            a_mu=state.a_mu,
            extent=extent,
            probability_mass=probability_mass,
        )[0]
        for term in excited_s_terms
    )
    if len(state.terms) == 1:
        if suggested_resolution > _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION:
            term = excited_s_terms[0]
            raise ValueError(
                f"the {term.n}s radial-node topology at probability_mass={probability_mass:.6g} "
                f"requires an estimated odd grid resolution of at least {suggested_resolution}, "
                f"exceeding the validated adaptive cap "
                f"{_MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION}"
            )
        first_resolution = max(resolution, suggested_resolution)
        full_grid_resolutions = (
            (first_resolution, first_resolution)
            if first_resolution == _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION
            else (
                first_resolution,
                _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION,
                _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION,
            )
        )
        return SuperpositionIsosurfaceWorkEstimate(
            active_terms=1,
            resolutions=full_grid_resolutions,
            general_topology_resolutions=(),
            uses_adaptive_isosurface_budget=True,
        )

    if suggested_resolution > _MAXIMUM_GENERAL_ISOSURFACE_RESOLUTION:
        raise ValueError(
            "the active excited-s component requires general superposition topology "
            f"convergence beyond the validated grid cap {_MAXIMUM_GENERAL_ISOSURFACE_RESOLUTION} "
            f"at probability_mass={probability_mass:.6g}"
        )

    # The acceptance gate below compares only the finest two meshes.  Earlier
    # versions constructed a 16-point ladder from the requested/analytic floor
    # even though no result except ``[-2]`` and ``[-1]`` was ever inspected.
    # Build and budget exactly the evidence that can affect the verdict.
    coarse_resolution = (
        suggested_resolution
        if _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION
        < suggested_resolution
        < _MAXIMUM_GENERAL_ISOSURFACE_RESOLUTION
        else _MAXIMUM_ADAPTIVE_ISOSURFACE_RESOLUTION
    )
    topology_schedule = (coarse_resolution, _MAXIMUM_GENERAL_ISOSURFACE_RESOLUTION)
    return SuperpositionIsosurfaceWorkEstimate(
        active_terms=len(state.terms),
        resolutions=(*topology_schedule, topology_schedule[-1]),
        general_topology_resolutions=topology_schedule,
        uses_adaptive_isosurface_budget=True,
    )


def _has_analytic_zero_stationary_current(state: SuperpositionState) -> bool:
    """Return true for a stationary real spatial combination up to one phase."""

    if not state.is_stationary:
        return False

    if state.basis is BasisKind.REAL:
        reference = state.terms[0].coefficient
        return all(
            abs(float(np.imag(np.conj(reference) * term.coefficient)))
            <= _REALITY_RELATION_TOLERANCE * abs(reference * term.coefficient)
            for term in state.terms[1:]
        )

    # In the complex basis, Y_l^{-m}=(-1)^m conj(Y_l^m).  A stationary
    # combination is a global phase times a real function exactly when one
    # unit phase kappa satisfies c_m=kappa*(-1)^m*conj(c_-m) for every term.
    # A missing partner is a real physical current, not an analytic zero.
    coefficients = {term.quantum_numbers: term.coefficient for term in state.terms}
    phase_ratio: complex | None = None
    for term in state.terms:
        partner = coefficients.get((term.n, term.l, -term.m))
        if partner is None:
            return False
        parity = -1.0 if abs(term.m) % 2 else 1.0
        candidate = term.coefficient / (parity * np.conj(partner))
        if abs(abs(candidate) - 1.0) > _REALITY_RELATION_TOLERANCE:
            return False
        if phase_ratio is None:
            phase_ratio = candidate
        elif abs(candidate - phase_ratio) > _REALITY_RELATION_TOLERANCE:
            return False
    return True


def build_superposition_isosurface(
    state: SuperpositionState,
    *,
    time: float = 0.0,
    resolution: int = 65,
    probability_mass: float = 0.90,
) -> SuperpositionIsosurfacePayload:
    r"""Build the :math:`|\Psi(t)|^2` isosurface of a superposition at one instant."""

    highest = max(term.n for term in state.terms)
    if highest > 4:
        raise ValueError("isosurface generation is validated only for n <= 4")
    minimum_resolution = max(49, 16 * highest + 17)
    if resolution < minimum_resolution or resolution > 81:
        raise ValueError(f"resolution must be between {minimum_resolution} and 81 for n={highest}")
    if resolution % 2 == 0:
        raise ValueError("resolution must be odd so Cartesian nodal planes lie on the grid")
    if not 0.50 <= probability_mass <= 0.99:
        raise ValueError("probability_mass must be between 0.50 and 0.99")

    extent = superposition_extent(state)

    def evaluate(r: np.ndarray, th: np.ndarray, ph: np.ndarray) -> np.ndarray:
        return state.evaluate(r, th, ph, time=time)

    topology_convergence_note: str | None = None
    mesh: _MeshResult | None = None
    effective_resolution = resolution
    if len(state.terms) == 1:
        term = state.terms[0]
        eigenstate_mesh, effective_resolution = _build_eigenstate_density_mesh(
            evaluate,
            n=term.n,
            l=term.l,
            z=state.z,
            a_mu=state.a_mu,
            extent=extent,
            requested_resolution=resolution,
            probability_mass=probability_mass,
        )
        mesh = eigenstate_mesh
    else:
        work_estimate = estimate_superposition_isosurface_workload(
            state,
            resolution=resolution,
            probability_mass=probability_mass,
        )
        mesh_resolutions = work_estimate.general_topology_resolutions or (resolution,)
        scheduled_meshes: list[tuple[int, _MeshResult]] = []
        for candidate_resolution in mesh_resolutions:
            candidate_mesh = _build_density_mesh(
                evaluate,
                extent=extent,
                resolution=candidate_resolution,
                probability_mass=probability_mass,
            )
            scheduled_meshes.append((candidate_resolution, candidate_mesh))

        if len(scheduled_meshes) == 1:
            effective_resolution, mesh = scheduled_meshes[0]
        else:
            coarse_resolution, coarse_mesh = scheduled_meshes[-2]
            fine_resolution, fine_mesh = scheduled_meshes[-1]
            if not _general_meshes_have_stable_topology(coarse_mesh, fine_mesh):
                raise ValueError(
                    "the general superposition isosurface topology did not converge in per-component "
                    "Euler characteristic, density level, and mass on the finest two grids before "
                    f"the validated grid cap {_MAXIMUM_GENERAL_ISOSURFACE_RESOLUTION}"
                )
            mesh = fine_mesh
            effective_resolution = fine_resolution
            topology_convergence_note = (
                "general superposition topology passed an empirical finest-two-grid convergence "
                f"gate at resolutions {coarse_resolution} and {fine_resolution}; this is numerical "
                "convergence evidence, not a radial analytic proof"
            )

    if mesh is None:  # pragma: no cover - all branches either assign or raise
        raise ScientificComputationError("isosurface mesh construction produced no result")

    mass_diagnostic = finite_grid_mass_diagnostic(
        state,
        extent=extent,
        resolution=effective_resolution,
        integrated_mass=mesh.integrated_mass,
    )
    warnings: list[str] = []
    if topology_convergence_note is not None:
        warnings.append(topology_convergence_note)
    if effective_resolution != resolution:
        warnings.append(
            f"grid resolution was increased from {resolution} to {effective_resolution} to "
            "resolve the radial-node topology"
        )
    shells = {term.n for term in state.terms}
    if mass_diagnostic.status == "phase_dependent_quadrature_error":
        warnings.append(
            f"finite-grid density integral is {mesh.integrated_mass:.6f}: phase-dependent "
            "quadrature aliasing has a conservatively bounded non-zero Fourier component beyond "
            "the conservative finite-box variation bound; terms span "
            f"n={sorted(shells)}, so the uniform cube under-resolves compact scales. "
            "This is a render-grid artefact, not probability non-conservation."
        )
    elif mass_diagnostic.status == "time_invariant_quadrature_error":
        detail = (
            f"terms span n={sorted(shells)}, so the uniform cube under-resolves the compact scales"
            if len(shells) > 1
            else "the uniform cube is under-resolved"
        )
        warnings.append(
            f"finite-grid density integral is {mesh.integrated_mass:.6f}: time-invariant "
            "quadrature error exceeds the reporting tolerance even after accounting for the "
            f"conservative finite-box tail bound; {detail}."
        )
    elif mass_diagnostic.status == "quadrature_error_at_reported_time":
        warnings.append(
            f"finite-grid density integral is {mesh.integrated_mass:.6f}: quadrature error "
            "at the reported time exceeds the reporting tolerance even after accounting for "
            "the conservative finite-box tail bound; its "
            "time dependence has no above-threshold certified alias component."
        )
    return SuperpositionIsosurfacePayload(
        metadata=superposition_metadata(
            state,
            time=time,
            observable=ObservableKind.PROBABILITY_DENSITY,
            representation=RepresentationKind.ISOSURFACE,
            warnings=warnings,
        ),
        vertices=np.round(mesh.vertices, 6).tolist(),
        normals=np.round(mesh.normals, 6).tolist(),
        faces=mesh.faces.astype(np.int32).tolist(),
        phase=np.round(np.mod(phase(mesh.vertex_psi) + pi, 2.0 * pi) - pi, 6).tolist(),
        density_level=mesh.level,
        requested_probability_mass=probability_mass,
        captured_probability_mass=mesh.captured,
        finite_grid_density_integral=mesh.integrated_mass,
        grid_resolution=effective_resolution,
        grid_spacing_bohr=mesh.spacing,
        extent_bohr=extent,
        finite_box_tail_mass_upper_bound=mass_diagnostic.tail_mass_upper_bound,
        finite_box_mass_variation_upper_bound=(mass_diagnostic.box_mass_variation_upper_bound),
        finite_grid_phase_variation_bound=mass_diagnostic.phase_variation_bound,
        finite_grid_aliasing_variation_lower_bound=(mass_diagnostic.aliasing_variation_lower_bound),
        finite_grid_mass_error_lower_bound=mass_diagnostic.mass_error_lower_bound,
        finite_grid_reporting_tolerance=mass_diagnostic.reporting_tolerance,
        finite_grid_mass_status=mass_diagnostic.status,
    )


def build_superposition_current_field(
    state: SuperpositionState,
    *,
    time: float = 0.0,
    seed_count: int = 48,
    arc_step: float | None = None,
    lattice: int = _SUPERPOSITION_CURRENT_SEED_LATTICE,
) -> SuperpositionCurrentPayload:
    r"""Build probability-flow streamlines of :math:`\Psi(t)`.

    Seeding is fully three-dimensional here, unlike the stationary single-state
    builder. A superposition has no azimuthal symmetry to exploit: its flow
    lines generally do not close, so one azimuth no longer enumerates them.
    An explicit arc step is accepted only between ``1/4096`` and ``1/8`` of
    the most compact active support length.
    """

    if seed_count < 1:
        raise ValueError("seed_count must be positive")
    if len(state.terms) > 8:
        raise ValueError("current-field diagnostics support at most 8 active terms")
    _validate_current_numeric_scale(z=state.z, a_mu=state.a_mu)
    analytic_zero_current = _has_analytic_zero_stationary_current(state)
    differential_length, compact_support, wide_support = state_support_lengths(state)
    resolved_arc_step = _resolve_arc_step(arc_step, compact_support)

    extent = superposition_extent(state)
    axis = np.linspace(-extent, extent, lattice, dtype=np.float64)
    x, y, z_axis = np.meshgrid(axis, axis, axis, indexing="ij")
    candidates = np.column_stack((x.ravel(), y.ravel(), z_axis.ravel()))
    radius, polar, azimuth = cartesian_to_spherical(
        candidates[:, 0], candidates[:, 1], candidates[:, 2]
    )
    density = probability_density(state.evaluate(radius, polar, azimuth, time=time))
    density_floor = _SEED_DENSITY_SCALED_FLOOR / wide_support**3
    keep = np.flatnonzero(density > density_floor)

    lines: list[list[list[float]]] = []
    speeds: list[list[float]] = []
    max_speed = 0.0
    length_serialization_scale = state.a_mu / state.z
    speed_serialization_scale = state.z

    def velocity(points: np.ndarray) -> np.ndarray:
        spherical = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
        rho = probability_density(state.evaluate(*spherical, time=time))
        current = superposition_current(state, points, time=time)
        result = np.zeros_like(current)
        live = rho > density_floor
        np.divide(current, rho[:, None], out=result, where=live[:, None])
        return result

    if keep.size and not analytic_zero_current:
        # A requested seed means a usable path seed, not merely one of the
        # densest lattice points.  The origin is the density maximum for states
        # such as 1s + 3d_z2, but its instantaneous velocity is exactly zero;
        # truncating first therefore made every request deterministically lose
        # one line.  Filter only strict, representable zero here -- no epsilon
        # may erase a physically weak but finite current -- and rank the
        # remaining candidates by density afterwards.
        initial_speed = stable_vector_magnitudes(velocity(candidates[keep]))
        moving = np.isfinite(initial_speed) & (initial_speed > 0.0)
        keep = keep[moving]

    keep = keep[np.argsort(density[keep])[::-1]][:seed_count]

    if keep.size and not analytic_zero_current:
        for line in integrate_streamlines(
            velocity,
            candidates[keep],
            arc_step=resolved_arc_step,
            max_points=_streamline_point_budget(4.0 * extent, resolved_arc_step),
            close_tolerance=0.5 * resolved_arc_step,
        ):
            if line.vertices.shape[0] < 4:
                continue
            quantized_speed = _serialize_scaled_speeds(
                line.speed, physical_scale=speed_serialization_scale
            )
            lines.append(
                _quantize_scaled_values(
                    line.vertices, physical_scale=length_serialization_scale
                ).tolist()
            )
            speeds.append(quantized_speed.tolist())
            max_speed = max(max_speed, float(np.max(quantized_speed)))

    if analytic_zero_current:
        probes = np.empty((0, 3), dtype=np.float64)
    elif state.is_stationary:
        probe_candidates = continuity_probe_candidates(state)
        probe_current = superposition_current(state, probe_candidates, time=time)
        current_magnitude = stable_vector_magnitudes(probe_current)
        probe_keep = np.argsort(current_magnitude)[::-1][:_CONTINUITY_PROBE_COUNT]
        probes = np.asarray(probe_candidates[probe_keep], dtype=np.float64)
    else:
        probes = select_continuity_probes(state, count=_CONTINUITY_PROBE_COUNT)

    absolute = 0.0
    transition_scale = 0.0
    if analytic_zero_current:
        audit_times: tuple[float, ...] = ()
        density_rate_scale = 0.0
    else:
        audit_times = continuity_audit_times(state, reference_time=time)
        for audit_time in audit_times:
            residual, sampled_scale = continuity_residual(state, probes, time=audit_time)
            absolute = max(absolute, float(np.max(np.abs(residual))))
            transition_scale = max(transition_scale, sampled_scale)
        instantaneous_rate = density_time_derivative(state, probes, time=time)
        density_rate_scale = float(np.max(np.abs(instantaneous_rate)))

    if state.is_stationary and not analytic_zero_current:
        current = superposition_current(state, probes, time=time)
        continuity_scale = float(np.max(stable_vector_magnitudes(current)) / differential_length)
        if continuity_scale <= 0.0:
            raise ScientificComputationError(
                "stationary current had no resolvable diagnostic scale"
            )
        scale_kind: Literal[
            "transition_coherence", "stationary_current", "analytic_zero_current"
        ] = "stationary_current"
    elif analytic_zero_current:
        continuity_scale = 0.0
        scale_kind = "analytic_zero_current"
    else:
        continuity_scale = transition_scale
        scale_kind = "transition_coherence"
        if continuity_scale <= 0.0:
            raise ScientificComputationError(
                "non-stationary state had no resolvable transition scale"
            )
    normalized = absolute / continuity_scale if continuity_scale > 0.0 else 0.0

    warnings: list[str] = []
    if not analytic_zero_current and not lines:
        warnings.append(
            "no drawable streamlines were resolved at this instant; "
            "the sampled instantaneous probability current is zero or stalls "
            "before a drawable path forms"
        )

    return SuperpositionCurrentPayload(
        metadata=superposition_metadata(
            state,
            time=time,
            observable=ObservableKind.PROBABILITY_CURRENT,
            representation=RepresentationKind.STREAMLINES,
            warnings=warnings,
        ),
        lines=lines,
        speed=speeds,
        seed_count=len(lines),
        max_speed=max_speed,
        arc_step_bohr=resolved_arc_step,
        seed_density_floor=density_floor,
        extent_bohr=extent,
        continuity_residual=normalized,
        continuity_absolute_residual=absolute,
        continuity_scale=continuity_scale,
        continuity_scale_kind=scale_kind,
        continuity_probe_count=probes.shape[0],
        continuity_phase_count=len(audit_times),
        density_rate_scale=density_rate_scale,
    )
