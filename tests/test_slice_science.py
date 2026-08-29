"""Science acceptance oracles for slice assets, plus the sabotages that bind them.

Every test here calls the builders in :mod:`quviz.scene.slices` directly. There
is no HTTP in this file on purpose: an oracle that goes through the app would
fail for transport reasons and be read as a physics failure.

The eleven oracles S1--S11 state what a slice of a hydrogenic state *must* look
like -- symmetry, node position, phase winding, covariance under ``(Z, a_mu)``,
time dependence, and the frozen grid layout. An oracle that no wrong
implementation can fail is decoration, so each of the seven ways a slice
pipeline is known to go wrong gets its own named negative control below:

The right-hand column is measured, not asserted by hand: each sabotage was also
applied globally once and the listed oracles are the ones that actually went
red.

===========================  ==========================================
sabotage                     oracles that go red
===========================  ==========================================
swapped ``u``/``v`` axes     S2, S4, S5
``abs(psi)`` instead of psi  S2, S4, S5, S6
reversed ``atan2`` arguments S4, S5
absolute mask threshold      S7 (constant), S3 (plane-referenced)
mask ignored                 S3
time dropped                 S8 (S9 is the stationary partner)
``a_mu`` dropped             S7, at ``a_mu = 0.5`` only
===========================  ==========================================

Each control monkeypatches the *real* builder chain rather than mutating an
array after the fact, so it proves the oracle binds to the code under test and
not to a local copy of the data. Both public builders wrap private LRUs, return
deep copies, and retain a ``cache_clear`` test hook; a module-wide fixture uses
that hook so sabotaged private entries never survive into the next test.

**One measured deviation from the frozen S2 contract.** The ``2p_z`` ``xz``
slice is *exactly* symmetric in ``u`` but antisymmetric in ``v`` only to one
ulp of the plane maximum (residue ``1.3878e-17`` against a maximum of
``0.0728``). The sampling grid *is* exactly mirrored --- ``symmetric_axis``
delivers what it promises --- but
:func:`quviz.physics.hydrogenic.cartesian_to_spherical` returns
``theta = arccos(z / r)``, and ``arccos(-x)`` is not bitwise ``pi - arccos(x)``,
so the ``cos(theta)`` that ``sph_harm_y`` recomputes satisfies
``cos(theta_+) + cos(theta_-) == -2.78e-16`` rather than zero. The assertion
below is therefore "within one ulp of the plane maximum", which stays true if
that round trip is ever removed and is still four orders of magnitude tighter
than anything a real defect produces.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from quviz.conventions import BasisKind, PrincipalPlane, SliceObservable
from quviz.physics.hydrogenic import hydrogenic_wavefunction
from quviz.physics.planes import (
    PLANE_FRAMES,
    MaskThresholds,
    plane_grid_points,
    symmetric_axis,
)
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene import slices as slices_module
from quviz.scene.models import SlicePayload, SuperpositionSlicePayload
from quviz.scene.slices import build_slice, build_superposition_slice

FloatArray = NDArray[np.float64]

#: Odd, and the resolution floor for every shell used here except 3p.
RESOLUTION = 65

#: 3p needs a finer plane than its floor of 65 for the interpolated node
#: crossing to be a statement about the node rather than about the spacing.
RESOLUTION_3P = 129

#: ``E_2 - E_1 = -0.125 - (-0.5)`` hartree: the 1s/2p_z beat frequency.
BOHR_BEAT_FREQUENCY = 0.375
BOHR_PERIOD = 2.0 * np.pi / BOHR_BEAT_FREQUENCY

#: Normalized two-term amplitude.
HALF_ROOT = 1.0 / np.sqrt(2.0)

#: The extent ``tests/test_planes.py`` also uses to break ``np.linspace``.
AWKWARD_EXTENT = 30.123456789


@pytest.fixture(autouse=True)
def _clear_slice_caches() -> Iterator[None]:
    """Both builders memoize; a sabotaged payload must not outlive its test."""

    build_slice.cache_clear()
    build_superposition_slice.cache_clear()
    yield
    build_slice.cache_clear()
    build_superposition_slice.cache_clear()


def _field(payload: SlicePayload | SuperpositionSlicePayload) -> FloatArray:
    """Return ``values`` as ``(resolution, resolution)`` with ``v`` on rows."""

    resolution = payload.resolution
    return np.asarray(payload.values, dtype=np.float64).reshape(resolution, resolution)


def _mask(payload: SlicePayload | SuperpositionSlicePayload) -> NDArray[np.bool_]:
    """Return ``valid_mask`` as ``(resolution, resolution)``; requires a phase slice."""

    assert payload.valid_mask is not None
    resolution = payload.resolution
    return np.asarray(payload.valid_mask, dtype=np.bool_).reshape(resolution, resolution)


def _eigen_slice(
    n: int,
    l: int,
    m: int,
    *,
    plane: PrincipalPlane,
    observable: SliceObservable,
    basis: BasisKind = BasisKind.REAL,
    z: float = 1.0,
    a_mu: float = 1.0,
    resolution: int = RESOLUTION,
) -> SlicePayload:
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


def _ring_indices(half: int, radius: int) -> list[tuple[int, int]]:
    """Return one closed counter-clockwise square ring of ``(row, col)`` indices.

    ``row`` indexes ``v`` and ``col`` indexes ``u``, so walking the bottom edge
    with ``u`` increasing, then the right edge with ``v`` increasing, traverses
    the ring in the ``+u -> +v`` sense: counter-clockwise in the ``(u, v)``
    frame, which for ``u x v = n`` is the right-handed sense about the normal.
    """

    low, high = half - radius, half + radius
    return [
        *((low, col) for col in range(low, high)),
        *((row, high) for row in range(low, high)),
        *((high, col) for col in range(high, low, -1)),
        *((row, low) for row in range(high, low, -1)),
    ]


def _winding_number(phases: FloatArray) -> float:
    """Return the number of ``2*pi`` turns accumulated around a closed loop."""

    steps = np.diff(np.concatenate([phases, phases[:1]]))
    wrapped = (steps + np.pi) % (2.0 * np.pi) - np.pi
    return float(np.sum(wrapped) / (2.0 * np.pi))


def _plane_ring_phases(payload: SlicePayload, radius: int) -> tuple[FloatArray, NDArray[np.bool_]]:
    field, mask = _field(payload), _mask(payload)
    half = (payload.resolution - 1) // 2
    indices = _ring_indices(half, radius)
    rows = np.array([row for row, _ in indices])
    cols = np.array([col for _, col in indices])
    return field[rows, cols], mask[rows, cols]


def _antisymmetry_residue_in_ulp(field: FloatArray) -> float:
    """Return ``max|f + mirror_v(f)|`` measured in ulp of the plane maximum."""

    peak = float(np.max(np.abs(field)))
    residue = float(np.max(np.abs(field + field[::-1, :])))
    return residue / float(np.spacing(peak))


def _positive_v_column(field: FloatArray) -> FloatArray:
    """Return the ``u = 0`` samples at strictly positive ``v``, origin excluded."""

    half = (field.shape[0] - 1) // 2
    return np.asarray(field[half + 1 :, half], dtype=np.float64)


def _sign_change_count(samples: FloatArray) -> int:
    assert not np.any(samples == 0.0), "a sample landed exactly on the node; retune the grid"
    return int(np.count_nonzero(np.diff(np.sign(samples)) != 0))


def _interpolated_crossing(samples: FloatArray, coordinates: FloatArray) -> float:
    index = int(np.flatnonzero(np.diff(np.sign(samples)) != 0)[0])
    left, right = coordinates[index], coordinates[index + 1]
    low, high = samples[index], samples[index + 1]
    return float(left - low * (right - left) / (high - low))


def _bohr_beat_state() -> SuperpositionState:
    """1s + 2p_z: two different energies, so the density genuinely moves."""

    return SuperpositionState(
        terms=(
            SuperpositionTerm(1, 0, 0, complex(HALF_ROOT)),
            SuperpositionTerm(2, 1, 0, complex(HALF_ROOT)),
        ),
        basis=BasisKind.REAL,
    )


def _degenerate_state() -> SuperpositionState:
    """2s + 2p_z: one shell, one energy, so the density cannot move at all."""

    return SuperpositionState(
        terms=(
            SuperpositionTerm(2, 0, 0, complex(HALF_ROOT)),
            SuperpositionTerm(2, 1, 0, complex(HALF_ROOT)),
        ),
        basis=BasisKind.REAL,
    )


def _density(state: SuperpositionState, time: float) -> FloatArray:
    payload = build_superposition_slice(
        state,
        time=time,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.PROBABILITY_DENSITY,
        resolution=RESOLUTION,
    )
    return np.asarray(payload.values, dtype=np.float64)


def _relative_spread(left: FloatArray, right: FloatArray) -> float:
    """Return ``max|left - right|`` normalized by the larger field's peak."""

    peak = max(float(np.max(np.abs(left))), float(np.max(np.abs(right))))
    return float(np.max(np.abs(left - right))) / peak


def _covariant_values_match(scaled: SlicePayload, reference: SlicePayload) -> bool:
    """Return whether ``scaled`` is ``2**1.5`` times ``reference`` at rtol 1e-13.

    ``atol`` is tied to the field peak rather than left at zero because a slice
    of ``2p_z`` contains an exact nodal row whose samples are cancellation
    residue near ``1e-18``; a bare relative comparison there would be a
    statement about the residue, not about the covariance.
    """

    expected = 2.0**1.5 * np.asarray(reference.values, dtype=np.float64)
    observed = np.asarray(scaled.values, dtype=np.float64)
    peak = float(np.max(np.abs(expected)))
    return bool(np.allclose(observed, expected, rtol=1e-13, atol=1e-13 * peak))


# --------------------------------------------------------------------------
# S1 -- an s state has no angular structure, on any plane.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("plane", list(PrincipalPlane))
def test_s1_1s_is_constant_on_every_exact_radius_orbit(plane: PrincipalPlane) -> None:
    """1s depends on ``r`` alone, so equal-radius samples must carry equal values.

    Orbits are grouped on the *squared* radius ``u**2 + v**2``: floating-point
    multiply and add are commutative, and the axis is bitwise antisymmetric, so
    every sample of one geometric orbit lands in exactly one group.
    """

    payload = _eigen_slice(1, 0, 0, plane=plane, observable=SliceObservable.WAVEFUNCTION_REAL)
    values = np.asarray(payload.values, dtype=np.float64)
    axis = symmetric_axis(payload.extent_bohr, payload.resolution)
    squared_radius = (axis[None, :] ** 2 + axis[:, None] ** 2).ravel()

    order = np.argsort(squared_radius, kind="stable")
    boundaries = np.flatnonzero(np.diff(squared_radius[order])) + 1
    for orbit in np.split(values[order], boundaries):
        if orbit.size < 2:
            continue
        assert orbit.min() == pytest.approx(orbit.max(), rel=1e-13, abs=0.0)


def test_s1_1s_gives_the_same_field_on_all_three_planes() -> None:
    """No plane frame can tilt an isotropic state."""

    fields = {
        plane: np.asarray(
            _eigen_slice(1, 0, 0, plane=plane, observable=SliceObservable.WAVEFUNCTION_REAL).values,
            dtype=np.float64,
        )
        for plane in PrincipalPlane
    }
    reference = fields[PrincipalPlane.XY]
    for plane, field in fields.items():
        assert np.allclose(field, reference, rtol=1e-13, atol=0.0), plane


# --------------------------------------------------------------------------
# S2 -- 2p_z is odd in z and even in x; on the xz plane that is odd in v, even in u.
# --------------------------------------------------------------------------


def test_s2_2pz_xz_is_odd_in_v_to_a_few_ulp_and_exactly_even_in_u() -> None:
    """``values[row, col] == -values[R-1-row, col]`` and ``== values[row, R-1-col]``.

    The ``u`` half is bitwise exact: mirroring ``x`` changes only ``phi``, which
    ``Y_1^0`` ignores. The ``v`` half is exact in the *grid* but a last-digit
    residue remains in the *values*, because ``theta = arccos(z / r)`` does not
    mirror bitwise; see the module docstring. The residue depends on the
    platform's libm rounding of that transcendental chain: measured 1.0 ulp of
    the plane maximum on Windows (UCRT) and 1.5 ulp on Linux CI (glibc). Four
    ulp is asserted as a platform-independent bound that is still many orders
    of magnitude below anything the abs(psi) sabotage could satisfy.
    """

    payload = _eigen_slice(
        2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.WAVEFUNCTION_REAL
    )
    field = _field(payload)

    assert np.array_equal(field, field[:, ::-1]), "2p_z must be exactly even in u = x"
    assert _antisymmetry_residue_in_ulp(field) <= 4.0
    # Non-vacuity: the field is not flat, so "odd in v" is a real constraint.
    assert float(np.max(np.abs(field))) > 1e-3


def test_s2_the_xz_sampling_grid_is_exactly_mirrored_in_v() -> None:
    """The one-ulp gap above is in the angular conversion, never in the grid."""

    payload = _eigen_slice(
        2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.WAVEFUNCTION_REAL
    )
    axis = symmetric_axis(payload.extent_bohr, payload.resolution)
    assert np.array_equal(axis, -axis[::-1])


# --------------------------------------------------------------------------
# S3 -- the xy plane of 2p_z is a nodal plane; the xz plane is not.
# --------------------------------------------------------------------------


def test_s3_2pz_xy_phase_is_fully_masked_while_xz_is_mostly_defined() -> None:
    """The pair is the point: a mask that fires everywhere is only meaningful
    against a sibling slice of the same state where it does not."""

    on_node = _eigen_slice(2, 1, 0, plane=PrincipalPlane.XY, observable=SliceObservable.PHASE)
    off_node = _eigen_slice(2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.PHASE)

    assert on_node.phase_masked_fraction == 1.0
    assert on_node.max_amplitude_on_plane < 1e-16
    assert on_node.max_amplitude_on_plane > 0.0, "the residue is small, not zero"
    assert any("fully masked" in note for note in on_node.metadata.warnings)

    assert off_node.phase_masked_fraction is not None
    assert off_node.phase_masked_fraction < 0.5
    assert off_node.max_amplitude_on_plane > 1e-3


def test_s3_the_full_mask_is_never_reported_as_a_node_certificate() -> None:
    """Wording is contract here: the mask marks phase-undefined, not "node"."""

    on_node = _eigen_slice(2, 1, 0, plane=PrincipalPlane.XY, observable=SliceObservable.PHASE)
    joined = " ".join(on_node.metadata.warnings)
    assert "phase-undefined" in joined
    assert "is not a certificate that a node" in joined


# --------------------------------------------------------------------------
# S4 / S5 -- the complex 2p azimuthal phase.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(("m", "expected_winding"), [(1, 1.0), (-1, -1.0)])
def test_s4_complex_2p_phase_winds_once_around_the_origin(m: int, expected_winding: float) -> None:
    """``psi ~ e^{i m phi}``, so one counter-clockwise loop of the xy plane
    accumulates exactly ``m`` turns. The Condon--Shortley sign of ``Y_1^1``
    shifts every phase by ``pi`` but cannot change a winding number."""

    payload = _eigen_slice(
        2,
        1,
        m,
        plane=PrincipalPlane.XY,
        observable=SliceObservable.PHASE,
        basis=BasisKind.COMPLEX,
    )
    phases, valid = _plane_ring_phases(payload, radius=12)
    assert valid.all(), "the ring must sit in resolved amplitude for the winding to mean anything"
    assert _winding_number(phases) == pytest.approx(expected_winding, abs=1e-9)


@pytest.mark.parametrize(
    ("m", "phase_at_plus_x", "phase_at_plus_y"),
    [
        # Y_1^1 = -sqrt(3/8pi) sin(theta) e^{i phi}: the Condon-Shortley minus
        # sign adds pi, so phi = 0 reports pi and phi = pi/2 reports
        # wrap(pi/2 + pi) = -pi/2.
        (1, np.pi, -np.pi / 2.0),
        # Y_1^-1 = +sqrt(3/8pi) sin(theta) e^{-i phi}: no extra sign, and the
        # azimuth runs the other way.
        (-1, 0.0, -np.pi / 2.0),
    ],
)
def test_s5_complex_2p_phase_is_pinned_at_the_plus_x_and_plus_y_grid_points(
    m: int, phase_at_plus_x: float, phase_at_plus_y: float
) -> None:
    """An absolute pin on two samples, independent of S4's winding.

    Both ``m`` report ``-pi/2`` on ``+y``, so ``+y`` alone does not separate
    them; ``+x`` does, and the pair fixes the ``atan2(y, x)`` argument order
    that S4 could in principle satisfy with a compensating sign elsewhere.
    """

    payload = _eigen_slice(
        2,
        1,
        m,
        plane=PrincipalPlane.XY,
        observable=SliceObservable.PHASE,
        basis=BasisKind.COMPLEX,
    )
    field, mask = _field(payload), _mask(payload)
    half = (payload.resolution - 1) // 2
    offset = 12

    assert mask[half, half + offset] and mask[half + offset, half]
    assert field[half, half + offset] == pytest.approx(phase_at_plus_x, abs=1e-12)
    assert field[half + offset, half] == pytest.approx(phase_at_plus_y, abs=1e-12)


# --------------------------------------------------------------------------
# S6 -- the 3p radial node.
# --------------------------------------------------------------------------


def test_s6_3p_has_exactly_one_radial_node_at_six_bohr_along_positive_v() -> None:
    r"""``R_31 ~ rho e^{-rho/2} (4 - rho)`` with ``rho = 2 Z r / (3 a_mu)``.

    The Laguerre factor vanishes at ``rho = 4``, i.e. ``r = 6 a_mu / Z``, and
    nowhere else, so a signed 3p_z slice must change sign exactly once along
    ``+v``. Counting sign changes only works on a *signed* field; this is where
    an ``abs(psi)`` pipeline stops having any node at all.
    """

    payload = _eigen_slice(
        3,
        1,
        0,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.WAVEFUNCTION_REAL,
        resolution=RESOLUTION_3P,
    )
    field = _field(payload)
    samples = _positive_v_column(field)
    axis = symmetric_axis(payload.extent_bohr, payload.resolution)
    coordinates = axis[(payload.resolution - 1) // 2 + 1 :]

    assert _sign_change_count(samples) == 1
    crossing = _interpolated_crossing(samples, coordinates)
    assert abs(crossing - 6.0) < payload.spacing_bohr


# --------------------------------------------------------------------------
# S7 -- covariance under Z and a_mu.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(("z", "a_mu"), [(2.0, 1.0), (1.0, 0.5)])
def test_s7_halving_the_length_scale_scales_the_slice_and_leaves_the_mask_alone(
    z: float, a_mu: float
) -> None:
    r"""``psi_{s}(r) = s^{3/2} psi_1(s r)`` with ``s = a_mu_1 Z_s / (a_mu_s Z_1)``.

    ``s = 2`` is chosen because the coordinate rescaling is then exact in
    binary, so the only error left is the evaluation's own. Three claims:
    the derived extent halves, the values grow by ``2**1.5``, and the phase
    mask is *bit identical* -- a threshold that did not carry the state's
    ``L_ref**-1.5`` scale would move the mask boundary. The reported threshold
    terms must themselves scale by ``2**1.5``, which is what an absolute
    threshold cannot do at any constant.
    """

    reference = _eigen_slice(
        2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.WAVEFUNCTION_REAL
    )
    scaled = _eigen_slice(
        2,
        1,
        0,
        z=z,
        a_mu=a_mu,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.WAVEFUNCTION_REAL,
    )
    assert scaled.extent_bohr == pytest.approx(reference.extent_bohr / 2.0, rel=1e-13)
    assert _covariant_values_match(scaled, reference)

    reference_phase = _eigen_slice(
        2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.PHASE
    )
    scaled_phase = _eigen_slice(
        2, 1, 0, z=z, a_mu=a_mu, plane=PrincipalPlane.XZ, observable=SliceObservable.PHASE
    )
    assert scaled_phase.valid_mask == reference_phase.valid_mask
    assert scaled_phase.phase_masked_fraction == reference_phase.phase_masked_fraction

    for name in ("phase_mask_amplitude_scale", "phase_mask_amplitude_threshold"):
        reference_term = getattr(reference_phase, name)
        scaled_term = getattr(scaled_phase, name)
        assert scaled_term == pytest.approx(2.0**1.5 * reference_term, rel=1e-13), name


# --------------------------------------------------------------------------
# S8 / S9 -- time dependence, and its absence.
# --------------------------------------------------------------------------


def test_s8_1s_plus_2pz_density_is_periodic_at_the_bohr_beat_period() -> None:
    r"""``rho(t)`` carries one cross term ``~ cos((E_2 - E_1) t + delta)``.

    So the density repeats at ``T = 2 pi / 0.375``, and at ``T/2`` the cross
    term is exactly negated: ``rho(t) + rho(t + T/2)`` drops it and is
    therefore the same field at every ``t``. The final assertion is the one
    that keeps the first two honest -- the density has to actually move.
    """

    state = _bohr_beat_state()
    at_zero = _density(state, 0.0)
    at_period = _density(state, BOHR_PERIOD)
    assert _relative_spread(at_zero, at_period) < 1e-12

    early = _density(state, 1.7)
    sum_at_zero = at_zero + _density(state, BOHR_PERIOD / 2.0)
    sum_at_early = early + _density(state, 1.7 + BOHR_PERIOD / 2.0)
    assert _relative_spread(sum_at_zero, sum_at_early) < 1e-12

    assert _relative_spread(at_zero, _density(state, BOHR_PERIOD / 2.0)) > 1e-3


def test_s9_a_degenerate_2s_plus_2pz_density_does_not_move() -> None:
    """One shell, one energy: the relative phase never turns, so an animation
    of this mixture would be showing an artefact."""

    state = _degenerate_state()
    assert state.is_stationary
    assert _relative_spread(_density(state, 0.0), _density(state, 7.3)) < 1e-12


# --------------------------------------------------------------------------
# S10 -- what a masked phase slice is allowed to contain.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("plane", [PrincipalPlane.XY, PrincipalPlane.XZ])
def test_s10_masked_entries_are_exactly_zero_and_unmasked_phases_are_principal(
    plane: PrincipalPlane,
) -> None:
    """Both slices, on and off the nodal plane, must satisfy this."""

    payload = _eigen_slice(2, 1, 0, plane=plane, observable=SliceObservable.PHASE)
    values, mask = _field(payload), _mask(payload)

    assert np.all(np.isfinite(values))
    masked = values[~mask]
    if masked.size:
        assert np.array_equal(masked, np.zeros_like(masked))
        assert np.all(np.signbit(masked) == np.signbit(np.zeros_like(masked)))
    defined = values[mask]
    if defined.size:
        assert np.all(defined >= -np.pi) and np.all(defined <= np.pi)
    assert payload.masked_value_sentinel == 0.0


# --------------------------------------------------------------------------
# S11 -- the frozen frames and the frozen sample axis.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("plane", "u_axis", "v_axis", "normal"),
    [
        (PrincipalPlane.XY, (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        # x_hat x z_hat = -y_hat: +y here would make the frame left-handed and
        # would mirror every handedness-sensitive claim about this plane.
        (PrincipalPlane.XZ, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0)),
        (PrincipalPlane.YZ, (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0)),
    ],
)
def test_s11_plane_frames_are_right_handed_and_reported_verbatim(
    plane: PrincipalPlane,
    u_axis: tuple[float, float, float],
    v_axis: tuple[float, float, float],
    normal: tuple[float, float, float],
) -> None:
    frame = PLANE_FRAMES[plane]
    assert (frame.u_axis, frame.v_axis, frame.normal) == (u_axis, v_axis, normal)
    assert np.array_equal(np.cross(u_axis, v_axis), np.asarray(normal))

    payload = _eigen_slice(1, 0, 0, plane=plane, observable=SliceObservable.WAVEFUNCTION_REAL)
    assert (payload.u_axis, payload.v_axis, payload.normal) == (
        list(u_axis),
        list(v_axis),
        list(normal),
    )
    assert payload.origin_bohr == [0.0, 0.0, 0.0]
    assert payload.layout == "row_major_v_rows_u_columns"


@pytest.mark.parametrize("resolution", [65, 129, 513])
def test_s11_sample_axis_holds_the_origin_and_is_bitwise_antisymmetric(resolution: int) -> None:
    axis = symmetric_axis(AWKWARD_EXTENT, resolution)
    half = (resolution - 1) // 2
    assert axis[half] == 0.0
    assert np.array_equal(axis, -axis[::-1])
    assert axis[-1] == pytest.approx(AWKWARD_EXTENT, rel=1e-15)


@pytest.mark.parametrize("resolution", [65, 129, 513])
def test_s11_negative_control_linspace_is_not_bitwise_antisymmetric(resolution: int) -> None:
    """``np.linspace`` is ``start + step*i`` with patched endpoints, so its two
    halves disagree in the last bits at a generic extent. Every symmetry claim
    in this file would then be decided by rounding."""

    linspaced = np.linspace(-AWKWARD_EXTENT, AWKWARD_EXTENT, resolution)
    assert not np.array_equal(linspaced, -linspaced[::-1])


# --------------------------------------------------------------------------
# Negative controls: seven sabotages of the real builder chain.
# --------------------------------------------------------------------------


def test_negative_control_swapped_axes_breaks_the_2pz_xz_parity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transposing the sample grid moves 2p_z's odd direction onto ``u``."""

    def swapped_grid(plane: PrincipalPlane | str, extent: float, resolution: int) -> FloatArray:
        points = plane_grid_points(plane, extent, resolution)
        swapped = points.reshape(resolution, resolution, 3).transpose(1, 0, 2)
        return np.asarray(swapped.reshape(-1, 3), dtype=np.float64)

    monkeypatch.setattr(slices_module, "plane_grid_points", swapped_grid)
    build_slice.cache_clear()
    field = _field(
        _eigen_slice(2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.WAVEFUNCTION_REAL)
    )
    assert not np.array_equal(field, field[:, ::-1])
    assert _antisymmetry_residue_in_ulp(field) > 1.0


def test_negative_control_abs_psi_destroys_both_the_parity_and_the_3p_node(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A magnitude pipeline is the classic slice bug: it looks right and has no
    sign, so 2p_z stops being odd and 3p_z stops having a node."""

    def magnitude_only(*args: Any, **kwargs: Any) -> FloatArray:
        return np.asarray(np.abs(hydrogenic_wavefunction(*args, **kwargs)), dtype=np.float64)

    monkeypatch.setattr(slices_module, "hydrogenic_wavefunction", magnitude_only)
    build_slice.cache_clear()

    parity = _field(
        _eigen_slice(2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.WAVEFUNCTION_REAL)
    )
    assert _antisymmetry_residue_in_ulp(parity) > 1.0

    node = _eigen_slice(
        3,
        1,
        0,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.WAVEFUNCTION_REAL,
        resolution=RESOLUTION_3P,
    )
    assert _sign_change_count(_positive_v_column(_field(node))) == 0


def test_negative_control_reversed_atan2_flips_the_winding_and_the_pinned_phases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``atan2(Re, Im)`` is ``pi/2 - atan2(Im, Re)``: the winding changes sign."""

    def reversed_phase(psi: Any) -> FloatArray:
        values = np.asarray(psi)
        return np.asarray(np.arctan2(np.real(values), np.imag(values)), dtype=np.float64)

    monkeypatch.setattr(slices_module, "phase", reversed_phase)
    build_slice.cache_clear()

    payload = _eigen_slice(
        2,
        1,
        1,
        plane=PrincipalPlane.XY,
        observable=SliceObservable.PHASE,
        basis=BasisKind.COMPLEX,
    )
    phases, _ = _plane_ring_phases(payload, radius=12)
    assert _winding_number(phases) != pytest.approx(1.0, abs=1e-9)

    field = _field(payload)
    half = (payload.resolution - 1) // 2
    assert field[half, half + 12] != pytest.approx(np.pi, abs=1e-12)


def _absolute_thresholds(
    *,
    reference_length: float,
    max_amplitude_on_plane: float,
    relative: float = 1e-6,
) -> MaskThresholds:
    """A threshold that ignores the state's ``L_ref**-1.5`` amplitude scale."""

    del reference_length
    return MaskThresholds(
        relative=relative,
        amplitude_scale=1.0,
        threshold=relative,
        numeric_floor=0.0,
        effective_threshold=relative,
        max_amplitude_on_plane=float(max_amplitude_on_plane),
    )


def _plane_referenced_thresholds(
    *,
    reference_length: float,
    max_amplitude_on_plane: float,
    relative: float = 1e-6,
) -> MaskThresholds:
    """A threshold taken from the plane's own maximum, which rescales to residue."""

    del reference_length
    threshold = relative * float(max_amplitude_on_plane)
    return MaskThresholds(
        relative=relative,
        amplitude_scale=float(max_amplitude_on_plane),
        threshold=threshold,
        numeric_floor=0.0,
        effective_threshold=threshold,
        max_amplitude_on_plane=float(max_amplitude_on_plane),
    )


def test_negative_control_absolute_threshold_breaks_covariance_and_the_nodal_plane(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two ways to get the threshold's reference wrong, and the oracle each hits.

    A *constant* threshold cannot scale with ``Z``, so S7's reported-threshold
    covariance catches it at any constant. A *plane-referenced* threshold
    rescales itself to the ``4e-18`` residue of the 2p_z xy plane and hands
    back a full field of meaningless phases, which S3 catches.
    """

    monkeypatch.setattr(slices_module, "phase_mask_thresholds", _absolute_thresholds)
    build_slice.cache_clear()
    reference = _eigen_slice(2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.PHASE)
    scaled = _eigen_slice(2, 1, 0, z=2.0, plane=PrincipalPlane.XZ, observable=SliceObservable.PHASE)
    assert scaled.phase_mask_amplitude_threshold != pytest.approx(
        2.0**1.5 * reference.phase_mask_amplitude_threshold, rel=1e-13
    )

    monkeypatch.setattr(slices_module, "phase_mask_thresholds", _plane_referenced_thresholds)
    build_slice.cache_clear()
    on_node = _eigen_slice(2, 1, 0, plane=PrincipalPlane.XY, observable=SliceObservable.PHASE)
    assert on_node.phase_masked_fraction != 1.0
    assert not any("fully masked" in note for note in on_node.metadata.warnings)


def test_negative_control_ignored_mask_publishes_the_residue_phases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With every sample called valid, the 2p_z xy slice certifies the phase of
    ``4e-18`` cancellation residue as resolved physics, on every one of its
    ``65**2`` samples, and drops the warning that said otherwise."""

    def always_valid(amplitude: Any, thresholds: MaskThresholds) -> NDArray[np.bool_]:
        del thresholds
        return np.ones_like(np.asarray(amplitude, dtype=np.float64), dtype=np.bool_)

    monkeypatch.setattr(slices_module, "valid_amplitude_mask", always_valid)
    build_slice.cache_clear()

    on_node = _eigen_slice(2, 1, 0, plane=PrincipalPlane.XY, observable=SliceObservable.PHASE)
    assert on_node.max_amplitude_on_plane < 1e-16
    assert on_node.phase_masked_fraction != 1.0
    assert on_node.phase_masked_fraction == 0.0
    assert on_node.valid_mask is not None and all(on_node.valid_mask)
    assert not any("fully masked" in note for note in on_node.metadata.warnings)


def test_negative_control_dropped_time_freezes_the_bohr_beat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the builder forgets to pass ``time``, S8's periodicity check passes
    vacuously; only the "it must move" assertion notices."""

    real_evaluate: Callable[..., Any] = SuperpositionState.evaluate

    def timeless_evaluate(
        self: SuperpositionState, r: Any, theta: Any, phi: Any, *, time: float = 0.0
    ) -> Any:
        del time
        return real_evaluate(self, r, theta, phi, time=0.0)

    monkeypatch.setattr(SuperpositionState, "evaluate", timeless_evaluate)
    build_superposition_slice.cache_clear()

    state = _bohr_beat_state()
    at_zero = _density(state, 0.0)
    assert _relative_spread(at_zero, _density(state, BOHR_PERIOD)) < 1e-12
    assert _relative_spread(at_zero, _density(state, BOHR_PERIOD / 2.0)) == 0.0


def test_negative_control_dropped_a_mu_breaks_the_length_scale_covariance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The extent still halves -- that path reads ``a_mu`` -- but the sampled
    amplitude no longer does, so the ``2**1.5`` covariance fails."""

    def unit_bohr_only(*args: Any, **kwargs: Any) -> Any:
        return hydrogenic_wavefunction(*args, **{**kwargs, "a_mu": 1.0})

    monkeypatch.setattr(slices_module, "hydrogenic_wavefunction", unit_bohr_only)
    build_slice.cache_clear()

    reference = _eigen_slice(
        2, 1, 0, plane=PrincipalPlane.XZ, observable=SliceObservable.WAVEFUNCTION_REAL
    )
    scaled = _eigen_slice(
        2,
        1,
        0,
        a_mu=0.5,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.WAVEFUNCTION_REAL,
    )
    assert scaled.extent_bohr == pytest.approx(reference.extent_bohr / 2.0, rel=1e-13)
    assert not _covariant_values_match(scaled, reference)
