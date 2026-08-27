"""Regenerate ``tests/fixtures/visual/``, the canned responses the screenshots render.

Run it whenever one of these payloads deliberately changes::

    uv run python scripts/write_visual_fixtures.py

Each file is one serialised server response, built through exactly the
functions the API calls, and committed for the reason
``tests/fixtures/slice_golden.json`` is committed: a change to the numbers a
client receives has to arrive as a diff someone reads rather than as a quiet
re-derivation the whole suite recomputes and therefore agrees with.

They carry a second job the golden does not. The front-end screenshot suite
renders these files, so they are the *input* half of every visual diff. A
screenshot diff is evidence about rendering only if the bytes going in are
fixed; unpinned, every visual regression becomes an argument about whether the
data moved instead. ``tests/test_visual_fixtures.py`` rebuilds all of them and
refuses any difference.

**Why these eight.** Six slices and two catalogs, chosen so that between them
they exercise every branch a slice renderer has:

* ``2pz-real-xz`` -- ``wavefunction_real``, the only signed field. Its two
  lobes are ``+-7.28e-2 bohr^-3/2`` about an exact nodal plane, so it is the
  fixture that says whether a diverging colour map is centred on zero, and the
  one where a map that takes ``|value|`` looks obviously wrong.
* ``2p+1-phase-xy`` -- the only masked fixture. ``2p(+1)`` on ``xy`` is
  ``r e^{-r/2} e^{i phi}`` at ``theta = pi/2``: non-zero everywhere except the
  origin. Exactly one sample of the 4225 is masked, the centre, and it is the
  hole a client honouring ``valid_mask`` must draw and a client ignoring it
  renders as a spurious zero-phase pixel. The phase runs the full ``+-pi``, so
  it is also the fixture a cyclic colour map is judged on.
* ``degenerate-stationary-xz`` at ``t=0`` and ``t=8.4`` -- 2s + 2p_z, which
  share ``E = -1/8`` hartree. One global phase, which ``|Psi|^2`` discards, so
  the density cannot move: the animation's negative control, two identical
  pictures at two different ``time_au``.
* ``1s2pz`` at ``t=0`` and ``t=8.4`` -- 1s + 2p_z, beating at
  ``omega = 3/8`` hartree. The positive control, and the pair the whole
  time-evolution feature is read through.
* the two catalogs, so the preset strip renders the same buttons in the same
  order in every screenshot rather than tracking whatever the route returns
  that day.

**Why ``t = 8.4``.** The Bohr period of 1s + 2p_z is
``2*pi / 0.375 = 16.7551...`` au, so half of it is ``8.3776``. The fixture uses
``8.4`` instead: it is a whole multiple of the ``0.6`` au playback step, so the
frame a screenshot shows is a frame playback actually lands on, and at
``cos(omega t) = -0.99996`` the interference term has still all but exactly
reversed. Both time-dependent pairs use the same two times so the stationary
control is a control for the same frames, not for a different pair of instants.

**Why ``resolution = 65``.** It is the floor for every state here
(:func:`~quviz.scene.slices.slice_resolution_floor` of ``n=2``), which keeps
each fixture around 80 KB -- small enough to read in a diff, and the same grid
the slice golden already pins.

The dump is canonical so the byte comparison is about the payload and not about
incidental formatting:

* ``sort_keys=True`` -- key order follows field declaration order, so sorting
  keeps a harmless field reordering from reading as a payload change.
* ``indent=2`` -- a readable diff is the whole point of committing it.
* ``allow_nan=False`` -- Python's ``json`` writes the bare ``NaN`` /
  ``Infinity`` tokens that no JSON parser outside Python accepts, and the
  consumer of these files is a browser. A non-finite sample must raise here
  rather than land in a fixture.
* ``ensure_ascii=False`` -- unlike the slice golden, these files stand in for
  bytes a browser receives, and the catalog labels carry real characters
  (``2pₓ``, ``3d_z²``). FastAPI serves them as UTF-8; escaping them here would
  commit a fixture that is not what the endpoint sends.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from pydantic import BaseModel

from quviz.api.routes import orbital_catalog, superposition_catalog
from quviz.conventions import BasisKind, PrincipalPlane, SliceObservable
from quviz.physics.superposition import SuperpositionState, SuperpositionTerm
from quviz.scene.slices import build_slice, build_superposition_slice

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "tests" / "fixtures" / "visual"

#: The floor for every state used here, and the grid the slice golden pins.
RESOLUTION: Final[int] = 65

#: ``1/sqrt(2)``, spelled out rather than computed so the committed coefficient
#: is the same literal the API's own catalog and query defaults carry.
EQUAL_WEIGHT: Final[float] = 0.7071067811865476

#: The playback step of the front-end time control, in hartree atomic units.
#: ``LATE_TIME`` is a whole multiple of it, so the screenshot shows a frame
#: playback lands on rather than one only a fixture can reach.
PLAYBACK_STEP_AU: Final[float] = 0.6

#: ``t=0`` and ``t=8.4``: half the 1s + 2p_z Bohr period to within ``0.023`` au,
#: and ``14 * PLAYBACK_STEP_AU``.
EARLY_TIME: Final[float] = 0.0
LATE_TIME: Final[float] = 14 * PLAYBACK_STEP_AU


def _superposition(terms: tuple[tuple[int, int, int], ...]) -> SuperpositionState:
    """An equal-weight, real-coefficient mixture in the complex basis.

    ``BasisKind.COMPLEX`` because that is what ``/api/superposition/slice``
    defaults to and therefore what the front-end receives. Every term here has
    ``m=0``, where the real and complex bases coincide, so the choice changes
    no number -- it keeps the fixture's ``metadata.basis`` honest about the
    request it stands in for.
    """

    return SuperpositionState(
        terms=tuple(SuperpositionTerm(n, l, m, complex(EQUAL_WEIGHT, 0.0)) for n, l, m in terms),
        basis=BasisKind.COMPLEX,
    )


#: 2s + 2p_z. Degenerate at ``E = -1/8`` hartree, so ``|Psi|^2`` is frozen.
DEGENERATE_STATE: Final[SuperpositionState] = _superposition(((2, 0, 0), (2, 1, 0)))

#: 1s + 2p_z. ``omega = E_2 - E_1 = 3/8`` hartree; the textbook radiating state.
OSCILLATING_STATE: Final[SuperpositionState] = _superposition(((1, 0, 0), (2, 1, 0)))


def _2pz_real_xz() -> BaseModel:
    """The signed amplitude of 2p_z on ``xz``: two lobes about an exact node."""

    return build_slice(
        2,
        1,
        0,
        basis=BasisKind.REAL,
        plane=PrincipalPlane.XZ,
        observable=SliceObservable.WAVEFUNCTION_REAL,
        resolution=RESOLUTION,
    )


def _2p_plus1_phase_xy() -> BaseModel:
    """The phase of 2p(+1) on ``xy``: a full ``+-pi`` winding, masked at ``r=0``."""

    return build_slice(
        2,
        1,
        1,
        basis=BasisKind.COMPLEX,
        plane=PrincipalPlane.XY,
        observable=SliceObservable.PHASE,
        resolution=RESOLUTION,
    )


def _degenerate(time: float) -> Callable[[], BaseModel]:
    """The stationary density at ``time``; the two it is called with must agree."""

    def build() -> BaseModel:
        return build_superposition_slice(
            DEGENERATE_STATE,
            time=time,
            plane=PrincipalPlane.XZ,
            observable=SliceObservable.PROBABILITY_DENSITY,
            resolution=RESOLUTION,
        )

    return build


def _oscillating(time: float) -> Callable[[], BaseModel]:
    """The beating density at ``time``; the two it is called with must differ."""

    def build() -> BaseModel:
        return build_superposition_slice(
            OSCILLATING_STATE,
            time=time,
            plane=PrincipalPlane.XZ,
            observable=SliceObservable.PROBABILITY_DENSITY,
            resolution=RESOLUTION,
        )

    return build


@dataclass(frozen=True, slots=True)
class VisualFixture:
    """One committed response: the file it lives in, why it exists, how to rebuild it."""

    name: str
    purpose: str
    build: Callable[[], Any]

    @property
    def path(self) -> Path:
        return DIRECTORY / f"{self.name}.json"


FIXTURES: Final[tuple[VisualFixture, ...]] = (
    VisualFixture(
        name="2pz-real-xz",
        purpose="signed field: a diverging colour map must be centred on the nodal plane",
        build=_2pz_real_xz,
    ),
    VisualFixture(
        name="2p+1-phase-xy",
        purpose="masked field: one masked sample at the origin, phase winding the full +-pi",
        build=_2p_plus1_phase_xy,
    ),
    VisualFixture(
        name="degenerate-stationary-xz-t0",
        purpose="animation negative control at t=0: paired with t=8.4, must render identically",
        build=_degenerate(EARLY_TIME),
    ),
    VisualFixture(
        name="degenerate-stationary-xz-t8.4",
        purpose="animation negative control at t=8.4: visible motion against t=0 is a bug",
        build=_degenerate(LATE_TIME),
    ),
    VisualFixture(
        name="1s2pz-t0-xz",
        purpose="animation positive control at t=0: the dipole in its first lobe",
        build=_oscillating(EARLY_TIME),
    ),
    VisualFixture(
        name="1s2pz-t8.4-xz",
        purpose="animation positive control half a Bohr period later: the dipole has swung over",
        build=_oscillating(LATE_TIME),
    ),
    VisualFixture(
        name="catalog-orbitals",
        purpose="the eigenstate preset strip, so it renders the same buttons in every screenshot",
        build=orbital_catalog,
    ),
    VisualFixture(
        name="catalog-superposition",
        purpose="the superposition preset strip, likewise pinned",
        build=superposition_catalog,
    ),
)


def fixture_named(name: str) -> VisualFixture:
    """Return the declared fixture called ``name``, or raise naming what exists."""

    for fixture in FIXTURES:
        if fixture.name == name:
            return fixture
    known = ", ".join(sorted(entry.name for entry in FIXTURES))
    raise KeyError(f"no visual fixture named {name!r}; declared fixtures are {known}")


def canonical(value: Any) -> str:
    """``value`` as the exact text its fixture holds, trailing newline included.

    A payload arrives as a pydantic model and a catalog as the plain list the
    route returns, so both are reduced to their JSON-ready form here rather
    than at each call site: one serialiser means one set of dump options, and
    the byte gate cannot be satisfied by a fixture written under different ones.
    """

    document = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    text = json.dumps(
        document,
        indent=2,
        sort_keys=True,
        allow_nan=False,
        ensure_ascii=False,
    )
    return f"{text}\n"


def main() -> None:
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    for fixture in FIXTURES:
        # ``newline="\n"`` because the default on Windows translates to CRLF,
        # and .gitattributes checks this tree out with LF: without it every
        # regeneration on Windows would rewrite every file in full.
        fixture.path.write_text(canonical(fixture.build()), encoding="utf-8", newline="\n")
        print(f"{fixture.path} ({fixture.path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
