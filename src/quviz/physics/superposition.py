r"""Analytic time-dependent superpositions of hydrogenic eigenstates.

.. math::

   \Psi(\mathbf r,t)=\sum_k c_k\,\psi_{n_k\ell_k m_k}(\mathbf r)\,
   e^{-iE_{n_k}t/\hbar}.

This is the first genuinely time-dependent state in QuViz, and it is exact:
each term evolves by a phase, so nothing is propagated numerically and there is
no time-stepping error to report.

Two facts do the work and both are gated elsewhere. The eigenstates are
orthonormal (``tests/test_analytic_gates.py``), which is why
:math:`\sum_k|c_k|^2=1` is the whole normalization condition and why the norm
is conserved. And the energy depends only on :math:`n`, so a superposition
within one shell is degenerate and its density does not move at all --- a
useful negative control, since a picture that animates a 2s + 2p mixture is
showing an artefact.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import (
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    validate_quantum_numbers,
)

ComplexArray = NDArray[np.complex128]

NORMALIZATION_TOLERANCE = 1e-10


@dataclass(frozen=True, slots=True)
class SuperpositionTerm:
    """One eigenstate and its complex amplitude."""

    n: int
    l: int
    m: int
    coefficient: complex

    def __post_init__(self) -> None:
        validate_quantum_numbers(self.n, self.l, self.m)

    @property
    def quantum_numbers(self) -> tuple[int, int, int]:
        return (self.n, self.l, self.m)


@dataclass(frozen=True, slots=True)
class SuperpositionState:
    r"""A normalized linear combination of hydrogenic eigenstates."""

    terms: tuple[SuperpositionTerm, ...]
    z: float = 1.0
    a_mu: float = 1.0
    basis: BasisKind = BasisKind.COMPLEX

    def __post_init__(self) -> None:
        if not self.terms:
            raise ValueError("a superposition needs at least one term")
        if self.z <= 0.0:
            raise ValueError("z must be positive")
        if self.a_mu <= 0.0:
            raise ValueError("a_mu must be positive")

        seen = [term.quantum_numbers for term in self.terms]
        if len(set(seen)) != len(seen):
            raise ValueError(f"duplicate terms in superposition: {sorted(seen)}")

        # sum |c|^2 = 1 is the complete condition only because the eigenstates
        # are orthonormal; cross terms would otherwise contribute to the norm.
        weight = float(sum(abs(term.coefficient) ** 2 for term in self.terms))
        if abs(weight - 1.0) > NORMALIZATION_TOLERANCE:
            raise ValueError(
                f"coefficients must be normalized: sum |c_k|^2 = {weight:.12f}, expected 1"
            )

    @property
    def energies(self) -> tuple[float, ...]:
        return tuple(hydrogenic_energy_hartree(term.n, z=self.z) for term in self.terms)

    @property
    def energy_expectation(self) -> float:
        r"""Return :math:`\langle H\rangle=\sum_k|c_k|^2E_{n_k}`, a constant of motion."""

        return float(
            sum(
                abs(term.coefficient) ** 2 * energy
                for term, energy in zip(self.terms, self.energies, strict=True)
            )
        )

    @property
    def is_stationary(self) -> bool:
        """True when every term shares one energy, so the density cannot move."""

        return len(set(self.energies)) == 1

    def evaluate(
        self,
        r: ArrayLike,
        theta: ArrayLike,
        phi: ArrayLike,
        *,
        time: float = 0.0,
    ) -> ComplexArray:
        r"""Evaluate :math:`\Psi(\mathbf r,t)`."""

        total: ComplexArray | None = None
        for term, energy in zip(self.terms, self.energies, strict=True):
            component = hydrogenic_wavefunction(
                term.n,
                term.l,
                term.m,
                r,
                theta,
                phi,
                z=self.z,
                a_mu=self.a_mu,
                basis=self.basis,
            )
            contribution = term.coefficient * np.exp(-1j * energy * time) * component
            total = contribution if total is None else total + contribution
        assert total is not None  # guaranteed by the non-empty check above
        return np.asarray(total, dtype=np.complex128)

    def time_derivative(
        self,
        r: ArrayLike,
        theta: ArrayLike,
        phi: ArrayLike,
        *,
        time: float = 0.0,
    ) -> ComplexArray:
        r"""Return :math:`\partial\Psi/\partial t` in closed form.

        Exact rather than differenced, because each term's time dependence is a
        known phase. That keeps the continuity check from measuring the error of
        a time-difference scheme instead of the physics.
        """

        total: ComplexArray | None = None
        for term, energy in zip(self.terms, self.energies, strict=True):
            component = hydrogenic_wavefunction(
                term.n,
                term.l,
                term.m,
                r,
                theta,
                phi,
                z=self.z,
                a_mu=self.a_mu,
                basis=self.basis,
            )
            contribution = -1j * energy * term.coefficient * np.exp(-1j * energy * time) * component
            total = contribution if total is None else total + contribution
        assert total is not None
        return np.asarray(total, dtype=np.complex128)

    def label(self) -> str:
        """Return a compact human-readable description of the mixture."""

        parts = []
        for term in self.terms:
            amplitude = term.coefficient
            magnitude = abs(amplitude)
            body = f"{magnitude:.3g}|{term.n},{term.l},{term.m}>"
            if abs(amplitude.imag) > 1e-12:
                body = f"({amplitude:.3g})|{term.n},{term.l},{term.m}>"
            parts.append(body)
        return " + ".join(parts)
