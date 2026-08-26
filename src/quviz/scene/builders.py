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
)
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
    SuperpositionCurrentPayload,
    SuperpositionIsosurfacePayload,
    SuperpositionMetadata,
    SuperpositionTermSpec,
)
from quviz.scene.streamlines import hydrogenic_flow_velocity, integrate_streamlines

_STREAMLINE_ARC_FRACTION = 0.03
_STREAMLINE_MAX_POINTS = 4_096
_STREAMLINE_MIN_ARC_FRACTION = 1.0 / _STREAMLINE_MAX_POINTS
_STREAMLINE_MAX_ARC_FRACTION = 1.0 / 8.0
_SEED_DENSITY_SCALED_FLOOR = 1e-4
_CONTINUITY_PROBE_COUNT = 8
_REALITY_RELATION_TOLERANCE = 64.0 * np.finfo(np.float64).eps


def orbital_metadata(
    n: int,
    l: int,
    m: int,
    *,
    z: float,
    basis: BasisKind | str,
    observable: ObservableKind,
    representation: RepresentationKind,
    warnings: list[str] | None = None,
) -> OrbitalMetadata:
    """Create metadata from the same inputs used by the numerical calculation."""

    basis_kind = BasisKind(basis)
    validate_quantum_numbers(n, l, m)
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
        RepresentationKind.SLICE: "plane section of the scalar field",
    }
    geometry_semantics = geometry_by_representation[representation]
    if representation is RepresentationKind.STREAMLINES:
        color_semantics = "flow speed |j|/rho normalized to the reported maximum"
    elif basis_kind is BasisKind.REAL:
        color_semantics = "wavefunction sign encoded as phase 0 or pi"
    else:
        color_semantics = "principal wavefunction phase in [-pi, pi]"
    return OrbitalMetadata(
        state=QuantumStateSpec(n=n, l=l, m=m, z=z, basis=basis_kind),
        label=orbital_label(n, l, m, basis=basis_kind),
        energy_hartree=hydrogenic_energy_hartree(n, z=z),
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


def _radial_extent_for_mass(
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
    raise RuntimeError(
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
        raise RuntimeError("computed isosurface level is outside the density range")

    vertices, faces, normals, _ = marching_cubes(  # type: ignore[no-untyped-call]
        density.astype(np.float32),
        level=level,
        spacing=(spacing, spacing, spacing),
        allow_degenerate=False,
    )
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

    extent = _radial_extent_for_mass(n, l, z)
    mesh = _build_density_mesh(
        lambda r, th, ph: hydrogenic_wavefunction(n, l, m, r, th, ph, z=z, basis=basis_kind),
        extent=extent,
        resolution=resolution,
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
        grid_resolution=resolution,
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

    candidate_magnitude = np.linalg.norm(current_at(candidates), axis=1)
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
    scale = float(np.max(np.linalg.norm(current_at(probes), axis=1)) / differential_length)
    if scale <= 0.0:
        raise RuntimeError("non-zero stationary current had no resolvable diagnostic scale")
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
    azimuth already enumerates all distinct lines. Time-dependent states in M1
    break that symmetry and will need density-weighted seeding in three
    dimensions; the integrator itself makes no such assumption.
    """

    validate_quantum_numbers(n, l, m)
    if z <= 0.0:
        raise ValueError("z must be positive")
    if seed_count < 1:
        raise ValueError("seed_count must be positive")
    support_length = n * n / z
    resolved_arc_step = _resolve_arc_step(arc_step, support_length)
    basis_kind = BasisKind(basis)

    extent = _radial_extent_for_mass(n, l, z)
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
                lines.append(np.round(line.vertices, 6).tolist())
                speeds.append(np.round(line.speed, 6).tolist())
                max_speed = max(max_speed, float(np.max(line.speed)))

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
    warnings: list[str] | None = None,
) -> SuperpositionMetadata:
    """Metadata for a superposition asset, including the instant it depicts."""

    notes = list(warnings or [])
    if state.is_stationary and len(state.terms) > 1:
        notes.append(
            "all terms share one energy, so this superposition is stationary: "
            "the density does not evolve and any apparent motion is an artefact"
        )
    geometry = (
        "streamlines of probability flow v = j / rho, sampled at equal arc length; "
        "these are flow lines, not electron trajectories"
        if representation is RepresentationKind.STREAMLINES
        else "level set of probability density |Psi|^2 at the stated time"
    )
    color = (
        "flow speed |j|/rho normalized to the reported maximum"
        if representation is RepresentationKind.STREAMLINES
        else "principal wavefunction phase in [-pi, pi]"
    )
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


def _superposition_extent(state: SuperpositionState) -> float:
    """The widest term sets the cube: a smaller box would clip a real component."""

    return max(
        _radial_extent_for_mass(term.n, term.l, state.z, a_mu=state.a_mu) for term in state.terms
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

    extent = _superposition_extent(state)
    mesh = _build_density_mesh(
        lambda r, th, ph: state.evaluate(r, th, ph, time=time),
        extent=extent,
        resolution=resolution,
        probability_mass=probability_mass,
    )

    mass_diagnostic = finite_grid_mass_diagnostic(
        state,
        extent=extent,
        resolution=resolution,
        integrated_mass=mesh.integrated_mass,
    )
    warnings: list[str] = []
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
        grid_resolution=resolution,
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
    lattice: int = 21,
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
    analytic_zero_current = _has_analytic_zero_stationary_current(state)
    differential_length, compact_support, wide_support = state_support_lengths(state)
    resolved_arc_step = _resolve_arc_step(arc_step, compact_support)

    extent = _superposition_extent(state)
    axis = np.linspace(-extent, extent, lattice, dtype=np.float64)
    x, y, z_axis = np.meshgrid(axis, axis, axis, indexing="ij")
    candidates = np.column_stack((x.ravel(), y.ravel(), z_axis.ravel()))
    radius, polar, azimuth = cartesian_to_spherical(
        candidates[:, 0], candidates[:, 1], candidates[:, 2]
    )
    density = probability_density(state.evaluate(radius, polar, azimuth, time=time))
    density_floor = _SEED_DENSITY_SCALED_FLOOR / wide_support**3
    keep = np.flatnonzero(density > density_floor)
    keep = keep[np.argsort(density[keep])[::-1]][:seed_count]

    lines: list[list[list[float]]] = []
    speeds: list[list[float]] = []
    max_speed = 0.0
    if keep.size and not analytic_zero_current:

        def velocity(points: np.ndarray) -> np.ndarray:
            spherical = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
            rho = probability_density(state.evaluate(*spherical, time=time))
            current = superposition_current(state, points, time=time)
            result = np.zeros_like(current)
            live = rho > density_floor
            np.divide(current, rho[:, None], out=result, where=live[:, None])
            return result

        for line in integrate_streamlines(
            velocity,
            candidates[keep],
            arc_step=resolved_arc_step,
            max_points=_streamline_point_budget(4.0 * extent, resolved_arc_step),
            close_tolerance=0.5 * resolved_arc_step,
        ):
            if line.vertices.shape[0] < 4:
                continue
            lines.append(np.round(line.vertices, 6).tolist())
            speeds.append(np.round(line.speed, 6).tolist())
            max_speed = max(max_speed, float(np.max(line.speed)))

    if analytic_zero_current:
        probes = np.empty((0, 3), dtype=np.float64)
    elif state.is_stationary:
        probe_candidates = continuity_probe_candidates(state)
        probe_current = superposition_current(state, probe_candidates, time=time)
        current_magnitude = np.linalg.norm(probe_current, axis=1)
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
        continuity_scale = float(np.max(np.linalg.norm(current, axis=1)) / differential_length)
        if continuity_scale <= 0.0:
            raise RuntimeError("stationary current had no resolvable diagnostic scale")
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
            raise RuntimeError("non-stationary state had no resolvable transition scale")
    normalized = absolute / continuity_scale if continuity_scale > 0.0 else 0.0

    return SuperpositionCurrentPayload(
        metadata=superposition_metadata(
            state,
            time=time,
            observable=ObservableKind.PROBABILITY_CURRENT,
            representation=RepresentationKind.STREAMLINES,
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
