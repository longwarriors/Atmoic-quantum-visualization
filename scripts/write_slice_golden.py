"""Regenerate ``tests/fixtures/slice_golden.json``, the committed slice payload.

Run it whenever the slice payload deliberately changes::

    uv run python scripts/write_slice_golden.py

The fixture is one serialised :class:`~quviz.scene.models.SlicePayload`: the 1s
phase section of the ``xy`` plane at ``resolution=65``, built through the same
:func:`~quviz.scene.slices.build_slice` the API calls.
``tests/test_slice_contract.py`` rebuilds it and refuses any difference, so a
change to the numbers a client receives has to arrive as a diff someone reads
rather than as a re-derivation the whole suite recomputes and therefore agrees
with. A surprise diff here is a change to the served payload.

**What the golden holds a client to.** The grid, first: ``extent_bohr`` is
*derived* from the state and reported, never taken from the caller, so pinning
it pins the derivation; ``spacing_bohr`` follows as ``2 * extent / (resolution
- 1)``; ``origin_bohr`` with ``u_axis``/``v_axis``/``normal`` states the ``xy``
frame; the sample order is row-major with ``v`` on rows. Then the mask report:
``relative``, ``amplitude_scale``, ``threshold`` and ``numeric_floor``, plus
``max_amplitude_on_plane`` and ``phase_masked_fraction``.

**What it does not hold anyone to is a masked region.** 1s is real and positive
everywhere, so its phase is zero at every sample, and no sample of this state's
extent falls below the threshold: the committed ``valid_mask`` is all ``true``
and ``phase_masked_fraction`` is ``0.0``. The mask *rule* is what this fixture
pins -- that a phase slice carries a mask and a full threshold report at all,
and that the threshold is referenced to the state's own amplitude scale
``L_ref**-1.5`` (1.0 here) rather than to the plane's maximum. Referencing the
plane would rescale the threshold to whatever cancellation residue a nodal
plane happens to carry. And a masked sample, when one occurs, marks a
low-amplitude, phase-undefined region -- never a node.

The dump is canonical so the byte comparison is about the payload and not about
incidental formatting:

* ``sort_keys=True`` -- key order follows field declaration order, so sorting
  keeps a harmless field reordering from reading as a payload change.
* ``indent=2`` -- a readable diff is the whole point of committing it.
* ``allow_nan=False`` -- Python's ``json`` writes the bare ``NaN`` /
  ``Infinity`` tokens that no JSON parser outside Python accepts. A non-finite
  sample must raise here rather than land in a fixture, which is the same
  raw-text concern the API's own NaN gates carry: the app serves Starlette's
  default JSON encoder, and that encoder emits those tokens happily.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final

from quviz.conventions import PrincipalPlane, SliceObservable
from quviz.scene.models import SlicePayload
from quviz.scene.slices import build_slice

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "tests" / "fixtures" / "slice_golden.json"

#: 1s because it is the one state whose slice a reader can check by hand, and
#: ``phase`` because it is the only observable that carries the mask and its
#: threshold report. ``resolution=65`` is the floor for any state
#: (:data:`~quviz.scene.slices.MINIMUM_SLICE_RESOLUTION`), which keeps the
#: fixture at ~80 KB and readable in a diff.
STATE: Final[tuple[int, int, int]] = (1, 0, 0)
PLANE: Final[PrincipalPlane] = PrincipalPlane.XY
OBSERVABLE: Final[SliceObservable] = SliceObservable.PHASE
RESOLUTION: Final[int] = 65


def build() -> SlicePayload:
    """The payload the fixture holds, built the way the API builds it."""

    n, l, m = STATE
    return build_slice(
        n,
        l,
        m,
        plane=PLANE,
        observable=OBSERVABLE,
        resolution=RESOLUTION,
    )


def canonical(payload: SlicePayload) -> str:
    """``payload`` as the exact text the fixture holds, trailing newline included."""

    text = json.dumps(payload.model_dump(mode="json"), indent=2, sort_keys=True, allow_nan=False)
    return f"{text}\n"


def main() -> None:
    # ``newline="\n"`` because the default on Windows translates to CRLF, and
    # .gitattributes checks this tree out with LF: without it every
    # regeneration on Windows would rewrite the whole file.
    GOLDEN.write_text(canonical(build()), encoding="utf-8", newline="\n")
    print(f"{GOLDEN} ({GOLDEN.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
