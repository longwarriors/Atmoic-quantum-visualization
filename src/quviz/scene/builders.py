"""Build geometry from physically named observables."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from math import pi

import numpy as np
from skimage.measure import marching_cubes

from quviz.conventions import (
    ANGLE_CONVENTION,
    SPHERICAL_HARMONIC_CONVENTION,
    BasisKind,
    ObservableKind,
    RepresentationKind,
)
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
    phase,
    probability_current_hydrogenic,
    probability_density,
    superposition_current,
)
from quviz.physics.superposition import SuperpositionState
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
    target_mass: float = 0.9999,
    grid_size: int = 32_769,
) -> float:
    """Return a padded radial quantile for an efficient finite cube."""

    r_max = max(8.0 * n * n / z, 12.0 / z)
    captured = 0.0
    for _ in range(8):
        radius = np.linspace(0.0, r_max, grid_size, dtype=np.float64)
        radial = radial_wavefunction(n, l, radius, z=z)
        radial_density = radius * radius * radial * radial
        cdf, captured = normalized_cdf(radius, radial_density)
        if captured >= target_mass:
            absolute_cdf = cdf * captured
            quantile = float(np.interp(target_mass, absolute_cdf, radius))
            return max(1.05 * quantile, 4.0 / z)
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


def _continuity_residual(velocity_state: tuple[int, int, int, float, BasisKind]) -> float:
    r"""Return :math:`\max|\nabla\cdot\mathbf j| / \max|\mathbf j|` on a probe set.

    A stationary state has :math:`\partial\rho/\partial t=0`, so continuity
    demands a divergence-free current. The payload reports the measured value
    instead of claiming the property.
    """

    n, l, m, z, basis_kind = velocity_state
    if basis_kind is BasisKind.REAL or m == 0:
        return 0.0

    probes = np.asarray([[1.7, 0.9, 2.2], [-2.4, 1.3, -0.8], [0.6, -3.1, 1.9], [2.8, 2.1, -1.2]])
    step = 1e-4

    def current_at(points: np.ndarray) -> np.ndarray:
        radius, polar, azimuth = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
        return probability_current_hydrogenic(
            n, l, m, radius, polar, azimuth, z=z, basis=basis_kind
        )

    divergence = np.zeros(probes.shape[0], dtype=np.float64)
    for axis in range(3):
        offset = np.zeros(3)
        offset[axis] = step
        forward = current_at(probes + offset)[:, axis]
        backward = current_at(probes - offset)[:, axis]
        divergence += (forward - backward) / (2.0 * step)

    magnitude = np.linalg.norm(current_at(probes), axis=1)
    scale = float(np.max(magnitude))
    if scale <= 0.0:
        return 0.0
    return float(np.max(np.abs(divergence)) / scale)


def build_current_field(
    n: int,
    l: int,
    m: int,
    *,
    z: float = 1.0,
    basis: BasisKind | str = BasisKind.COMPLEX,
    seed_count: int = 48,
    arc_step: float = 0.12,
    seed_density_fraction: float = 1e-3,
) -> CurrentFieldPayload:
    r"""Build probability-flow streamlines for one hydrogenic state.

    Seeds are placed on a deterministic lattice in the :math:`(s,z)` half-plane
    at :math:`\phi=0`, keeping only points whose density exceeds
    ``seed_density_fraction`` of the lattice maximum.

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
    if arc_step <= 0.0:
        raise ValueError("arc_step must be positive")
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
    density_floor = 0.0

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
        density_floor = float(np.max(density)) * seed_density_fraction
        keep = np.flatnonzero(density > density_floor)
        # Highest density first, so a small seed_count still shows the core flow.
        keep = keep[np.argsort(density[keep])[::-1]][:seed_count]
        keep = keep[np.argsort(radius[keep])]

        seeds = candidates[keep]
        velocity = hydrogenic_flow_velocity(n, l, m, z=z, basis=basis_kind)
        # One budget for the bundle: the widest orbit sets it, and closure
        # retires the tighter ones early.
        widest = float(np.max(np.hypot(seeds[:, 0], seeds[:, 1])))
        budget = min(int(2.0 * pi * widest / arc_step) + 8, 4_096)
        for line in integrate_streamlines(
            velocity,
            seeds,
            arc_step=arc_step,
            max_points=budget,
            close_tolerance=0.5 * arc_step,
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
    return CurrentFieldPayload(
        metadata=metadata,
        lines=lines,
        speed=speeds,
        seed_count=len(lines),
        max_speed=max_speed,
        arc_step_bohr=arc_step,
        seed_density_floor=density_floor,
        extent_bohr=extent,
        continuity_residual=_continuity_residual((n, l, m, z, basis_kind)),
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

    return max(_radial_extent_for_mass(term.n, term.l, state.z) for term in state.terms)


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

    warnings: list[str] = []
    if abs(mesh.integrated_mass - 1.0) > 0.002:
        shells = {term.n for term in state.terms}
        if len(shells) > 1:
            # Name the real cause. The cube is sized for the widest term, so a
            # compact term sits on too few points. Measured for 1s + 2p the
            # error is about six times a single-shell state's at the same
            # resolution (0.979 vs 0.996 at 49); it does converge, just from
            # much further away, so "increase resolution" alone would mislead.
            warnings.append(
                f"finite-grid density integral is {mesh.integrated_mass:.6f}: terms span "
                f"n={sorted(shells)}, so the uniform cube sized for the widest term "
                f"under-resolves the most compact one. The error is several times larger "
                f"than for a single-shell state at the same resolution; treat the "
                f"enclosed mass as approximate."
            )
        else:
            warnings.append(
                f"finite-grid density integral is {mesh.integrated_mass:.6f}; increase resolution"
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
    )


def build_superposition_current_field(
    state: SuperpositionState,
    *,
    time: float = 0.0,
    seed_count: int = 48,
    arc_step: float = 0.12,
    seed_density_fraction: float = 1e-3,
    lattice: int = 21,
) -> SuperpositionCurrentPayload:
    r"""Build probability-flow streamlines of :math:`\Psi(t)`.

    Seeding is fully three-dimensional here, unlike the stationary single-state
    builder. A superposition has no azimuthal symmetry to exploit: its flow
    lines generally do not close, so one azimuth no longer enumerates them.
    """

    if seed_count < 1:
        raise ValueError("seed_count must be positive")
    if arc_step <= 0.0:
        raise ValueError("arc_step must be positive")

    extent = _superposition_extent(state)
    axis = np.linspace(-extent, extent, lattice, dtype=np.float64)
    x, y, z_axis = np.meshgrid(axis, axis, axis, indexing="ij")
    candidates = np.column_stack((x.ravel(), y.ravel(), z_axis.ravel()))
    radius, polar, azimuth = cartesian_to_spherical(
        candidates[:, 0], candidates[:, 1], candidates[:, 2]
    )
    density = probability_density(state.evaluate(radius, polar, azimuth, time=time))
    density_floor = float(np.max(density)) * seed_density_fraction
    keep = np.flatnonzero(density > density_floor)
    keep = keep[np.argsort(density[keep])[::-1]][:seed_count]

    lines: list[list[list[float]]] = []
    speeds: list[list[float]] = []
    max_speed = 0.0
    if keep.size:

        def velocity(points: np.ndarray) -> np.ndarray:
            spherical = cartesian_to_spherical(points[:, 0], points[:, 1], points[:, 2])
            rho = probability_density(state.evaluate(*spherical, time=time))
            current = superposition_current(state, points, time=time)
            result = np.zeros_like(current)
            live = rho > 1e-14
            np.divide(current, rho[:, None], out=result, where=live[:, None])
            return result

        for line in integrate_streamlines(
            velocity,
            candidates[keep],
            arc_step=arc_step,
            max_points=int(4.0 * extent / arc_step) + 8,
            close_tolerance=0.5 * arc_step,
        ):
            if line.vertices.shape[0] < 4:
                continue
            lines.append(np.round(line.vertices, 6).tolist())
            speeds.append(np.round(line.speed, 6).tolist())
            max_speed = max(max_speed, float(np.max(line.speed)))

    probes = candidates[keep[: min(8, keep.size)]] if keep.size else candidates[:1]
    residual, rate_scale = continuity_residual(state, probes, time=time)
    normalized = float(np.max(np.abs(residual)) / rate_scale) if rate_scale > 0.0 else 0.0

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
        arc_step_bohr=arc_step,
        seed_density_floor=density_floor,
        extent_bohr=extent,
        continuity_residual=normalized,
        density_rate_scale=rate_scale,
    )
