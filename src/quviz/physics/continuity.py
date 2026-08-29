"""Reference scales and probes for continuity diagnostics."""

from __future__ import annotations

from fractions import Fraction
from math import pi

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quviz.physics.hydrogenic import cartesian_to_spherical, hydrogenic_wavefunction
from quviz.physics.superposition import SuperpositionState

type FloatArray = NDArray[np.float64]

_PROBE_NUMERATORS = (-30, -15, -7, 7, 15, 30)
_PROBE_DENOMINATOR = 20.0
_PROBE_SCORE_TIE_RELATIVE_TOLERANCE = 1_024.0 * np.finfo(np.float64).eps


def state_support_lengths(state: SuperpositionState) -> tuple[float, float, float]:
    """Return differential, compact-support and wide-support length scales."""

    base = state.a_mu / state.z
    differential = min(term.n * base for term in state.terms)
    support_lengths = [term.n * term.n * base for term in state.terms]
    return differential, min(support_lengths), max(support_lengths)


def continuity_probe_candidates(state: SuperpositionState) -> FloatArray:
    """Generate a deterministic multiscale probe pool in physical bohr."""

    base = state.a_mu / state.z
    # Deduplicate exact dimensionless integer keys before applying the physical
    # scale.  A fixed decimal rounding in bohr would break scale covariance for
    # very contracted or diffuse states.
    keys = {
        (term.n * term.n * x, term.n * term.n * y, term.n * term.n * z)
        for term in state.terms
        for x in _PROBE_NUMERATORS
        for y in _PROBE_NUMERATORS
        for z in _PROBE_NUMERATORS
    }
    return np.asarray(sorted(keys), dtype=np.float64) * (base / _PROBE_DENOMINATOR)


def _shell_probe_candidates(state: SuperpositionState, principal: int) -> FloatArray:
    keys = [
        (principal * principal * x, principal * principal * y, principal * principal * z)
        for x in _PROBE_NUMERATORS
        for y in _PROBE_NUMERATORS
        for z in _PROBE_NUMERATORS
    ]
    return np.asarray(keys, dtype=np.float64) * (state.a_mu / (state.z * _PROBE_DENOMINATOR))


def transition_coherence_scale(
    state: SuperpositionState,
    points: ArrayLike,
) -> FloatArray:
    r"""Return the time-independent local scale of density-changing coherences.

    Cross terms with the same exact Coulomb energy gap are added coherently;
    distinct frequencies are combined in quadrature.  Diagonal/global-phase
    terms never enter this scale.
    """

    position = np.atleast_2d(np.asarray(points, dtype=np.float64))
    spherical = cartesian_to_spherical(position[:, 0], position[:, 1], position[:, 2])
    components = [
        term.coefficient
        * np.asarray(
            hydrogenic_wavefunction(
                term.n,
                term.l,
                term.m,
                *spherical,
                z=state.z,
                a_mu=state.a_mu,
                basis=state.basis,
            ),
            dtype=np.complex128,
        )
        for term in state.terms
    ]

    grouped: dict[Fraction, tuple[float, NDArray[np.complex128]]] = {}
    energies = state.energies
    for first in range(len(state.terms)):
        for second in range(first + 1, len(state.terms)):
            first_n = state.terms[first].n
            second_n = state.terms[second].n
            gap_key = abs(Fraction(1, first_n * first_n) - Fraction(1, second_n * second_n))
            if gap_key == 0:
                continue

            # Orient every contribution from lower to higher energy so equal
            # frequencies have the same Fourier convention before summation.
            if energies[first] < energies[second]:
                lower, higher = first, second
            else:
                lower, higher = second, first
            amplitude = np.conj(components[lower]) * components[higher]
            gap = abs(energies[higher] - energies[lower])
            if gap_key in grouped:
                previous_gap, previous = grouped[gap_key]
                grouped[gap_key] = (previous_gap, previous + amplitude)
            else:
                grouped[gap_key] = (gap, amplitude)

    reference = np.zeros(position.shape[0], dtype=np.float64)
    for gap, amplitude in grouped.values():
        # hypot performs the root-sum-square with internal scaling, so an
        # active but representable 1e-200 coherence is not erased merely
        # because its square underflows float64.
        reference = np.hypot(reference, 2.0 * gap * np.abs(amplitude))
    return reference


def transition_frequencies(state: SuperpositionState) -> tuple[float, ...]:
    """Return the distinct positive Bohr frequencies in a state.

    The energy gaps are grouped by exact rational ``1/n**2`` differences so
    numerically equal Coulomb transitions cannot be split by float roundoff.
    """

    grouped: dict[Fraction, float] = {}
    energies = state.energies
    for first in range(len(state.terms)):
        for second in range(first + 1, len(state.terms)):
            first_n = state.terms[first].n
            second_n = state.terms[second].n
            key = abs(Fraction(1, first_n * first_n) - Fraction(1, second_n * second_n))
            if key:
                grouped.setdefault(key, abs(energies[first] - energies[second]))
    return tuple(grouped[key] for key in sorted(grouped))


def _rank_probe_scores(scores: ArrayLike) -> NDArray[np.intp]:
    """Rank non-negative scores with a deterministic candidate-index tie-break.

    Symmetry-related probes have analytically equal coherence. Their last-bit
    evaluation noise can change under an otherwise exact spatial rescaling, so
    raw ``argmax``/``argsort`` may permute equal points. Quantizing only at a
    small multiple of machine epsilon restores the analytic tie without
    merging physically distinct scores.
    """

    values = np.asarray(scores, dtype=np.float64)
    if values.ndim != 1 or not np.all(np.isfinite(values)) or np.any(values < 0.0):
        raise ValueError("probe scores must be a finite non-negative one-dimensional array")
    if values.size == 0:
        return np.empty(0, dtype=np.intp)
    maximum = float(np.max(values))
    if maximum == 0.0:
        return np.arange(values.size, dtype=np.intp)
    width = maximum * _PROBE_SCORE_TIE_RELATIVE_TOLERANCE
    buckets = np.rint(values / width)
    indices = np.arange(values.size, dtype=np.intp)
    return np.asarray(np.lexsort((indices, -buckets)), dtype=np.intp)


def continuity_audit_times(
    state: SuperpositionState,
    *,
    reference_time: float,
) -> tuple[float, ...]:
    """Return deterministic phase samples for a time-dependent audit.

    Four quadratures are taken for every distinct transition frequency.  The
    payload at ``reference_time`` remains the rendered instant, while this
    auxiliary set prevents a density turning point from becoming a vacuous
    continuity check.  Duplicate times are collapsed at float precision.
    """

    frequencies = transition_frequencies(state)
    if not frequencies:
        return (float(reference_time),)
    samples = {
        float(reference_time + phase / frequency)
        for frequency in frequencies
        for phase in (0.0, 0.5 * pi, pi, 1.5 * pi)
    }
    return tuple(sorted(samples))


def select_continuity_probes(state: SuperpositionState, *, count: int = 8) -> FloatArray:
    """Choose observable probes while retaining every active shell scale."""

    if count < 1:
        raise ValueError("count must be positive")
    candidates = continuity_probe_candidates(state)
    scale = transition_coherence_scale(state, candidates)
    if float(np.max(scale)) <= 0.0:
        return candidates[:count]

    selected: list[FloatArray] = []
    selected_keys: set[tuple[float, float, float]] = set()
    for principal in sorted({term.n for term in state.terms}):
        shell = _shell_probe_candidates(state, principal)
        shell_scale = transition_coherence_scale(state, shell)
        point = np.asarray(shell[int(_rank_probe_scores(shell_scale)[0])], dtype=np.float64)
        key = (float(point[0]), float(point[1]), float(point[2]))
        if key not in selected_keys and len(selected) < count:
            selected.append(point)
            selected_keys.add(key)

    for index in _rank_probe_scores(scale):
        point = np.asarray(candidates[int(index)], dtype=np.float64)
        key = (float(point[0]), float(point[1]), float(point[2]))
        if key not in selected_keys:
            selected.append(point)
            selected_keys.add(key)
        if len(selected) == count:
            break
    return np.asarray(selected, dtype=np.float64)
