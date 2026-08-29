"""The committed slice golden must be byte-for-byte what the builder produces.

``tests/fixtures/slice_golden.json`` is the serialised form of one slice
payload: the 1s phase section of the ``xy`` plane at ``resolution=65``. It is
committed for the same reason ``qvpc_golden.bin`` is -- so that a change to the
numbers a client receives has to show up as a diff someone reads, rather than
as a quiet re-derivation that every test recomputes and therefore every test
agrees with.

What the golden pins is the whole payload *shape and geometry*: the derived
``extent_bohr`` (a slice never takes an extent from the caller), the
``spacing_bohr`` that follows from it, the ``(u, v, n)`` frame of the ``xy``
plane, the row-major sample order, the metadata, and the four numbers of the
phase-mask report -- ``relative``, ``amplitude_scale``, ``threshold``,
``numeric_floor`` -- together with ``max_amplitude_on_plane`` and
``phase_masked_fraction``.

What it does not pin is a masked region. 1s is real and positive everywhere, so
the phase field is zero at every sample and, at this state's extent, no sample
falls below the threshold: the committed ``valid_mask`` is all ``true`` and
``phase_masked_fraction`` is ``0.0``. That is the honest reading of this
fixture -- it exercises the mask *rule* (a phase slice carries a mask and a full
threshold report at all; the threshold is referenced to the state's
``L_ref**-1.5`` amplitude scale, not to the plane's own maximum) and not a
masked region. A masked sample would in any case mark a low-amplitude,
phase-undefined region, never a node.

Regenerate with::

    uv run python scripts/write_slice_golden.py

and read the diff: a surprise here is a change to what the slice endpoints
serve.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any, NoReturn

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "write_slice_golden.py"
GOLDEN = ROOT / "tests" / "fixtures" / "slice_golden.json"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


write_slice_golden = _load_script(SCRIPT)


def test_the_builder_reproduces_the_committed_slice_golden_bytes() -> None:
    """The gate. Any difference at all, in either direction, fails here."""

    assert GOLDEN.is_file(), (
        f"{GOLDEN} does not exist; generate it with `uv run python scripts/write_slice_golden.py`"
    )
    # ``read_bytes`` rather than ``read_text``: on Windows text mode would
    # translate the committed LF line endings and the comparison would be about
    # newline handling instead of about the payload.
    committed = GOLDEN.read_bytes().decode("utf-8")
    rebuilt = write_slice_golden.canonical(write_slice_golden.build())

    assert rebuilt == committed, (
        "tests/fixtures/slice_golden.json is not what the slice builder produces. Regenerate it "
        "with `uv run python scripts/write_slice_golden.py` and review the diff as the change to "
        "the served payload that it is."
    )


def test_a_mutated_payload_no_longer_matches_the_golden() -> None:
    """Negative control: the comparison above must be able to fail.

    Without it a ``canonical`` that ignored its argument -- one returning a
    constant, or reading the committed file back -- would satisfy the test
    above while comparing nothing. Here the built payload is copied with one
    field changed, and the serialisation of the copy must differ.

    ``model_copy`` rather than assignment keeps this negative control local.
    :func:`build_slice` wraps a private LRU but returns a deep copy, so public
    callers cannot corrupt the cached payload.
    """

    payload = write_slice_golden.build()
    committed = GOLDEN.read_bytes().decode("utf-8")

    mutated = payload.model_copy(update={"values": [value + 1.0 for value in payload.values]})
    assert write_slice_golden.canonical(mutated) != committed, (
        "a payload with every sample shifted by 1.0 serialised to the committed bytes, so the "
        "comparison above is not actually comparing the payload"
    )


def test_the_golden_is_a_phase_slice_carrying_its_whole_mask_report() -> None:
    """What the fixture is *for*, stated so a regeneration cannot quietly gut it.

    A byte comparison is satisfied by any file, including one whose observable
    drifted to ``probability_density`` -- where ``valid_mask`` and all four
    threshold fields are ``null`` by the payload's own rules, and the golden
    would then pin none of the mask contract it exists to pin.
    """

    document: dict[str, Any] = json.loads(GOLDEN.read_bytes().decode("utf-8"))

    assert document["slice_observable"] == "phase"
    assert document["plane"] == "xy"
    assert document["resolution"] == 65
    assert len(document["values"]) == 65 * 65
    assert len(document["valid_mask"]) == 65 * 65
    for field in (
        "phase_mask_relative_amplitude",
        "phase_mask_amplitude_scale",
        "phase_mask_amplitude_threshold",
        "phase_mask_numeric_floor",
        "phase_masked_fraction",
        "max_amplitude_on_plane",
    ):
        assert document[field] is not None, f"a phase golden must report {field}"

    # The frozen mask rule: the threshold is the relative tolerance times an
    # amplitude scale taken from the STATE (``L_ref**-1.5``, and ``L_ref`` is 1
    # bohr for 1s at Z=1), never from this plane's own maximum. Reading it off
    # the plane would rescale the threshold to whatever residue a nodal plane
    # happens to carry.
    assert document["phase_mask_amplitude_scale"] == 1.0
    assert (
        document["phase_mask_amplitude_threshold"]
        == document["phase_mask_relative_amplitude"] * document["phase_mask_amplitude_scale"]
    )
    assert document["phase_mask_amplitude_scale"] != document["max_amplitude_on_plane"]


def test_the_golden_text_carries_no_token_a_strict_json_parser_would_reject() -> None:
    """``allow_nan=False`` is load-bearing, so it is checked on the raw text.

    Python's ``json`` writes the bare ``NaN`` / ``Infinity`` tokens that no
    parser outside Python accepts. This fixture is read back by Python, so a
    round-trip through ``json.loads`` would accept them silently; the gate has
    to be on the text.
    """

    def reject(token: str) -> NoReturn:
        raise AssertionError(
            f"the committed golden holds the bare {token!r} token, which no JSON parser outside "
            "Python accepts"
        )

    json.loads(GOLDEN.read_bytes().decode("utf-8"), parse_constant=reject)
