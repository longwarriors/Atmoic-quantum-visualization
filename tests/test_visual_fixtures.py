"""The committed visual fixtures must be byte-for-byte what the builders produce.

``tests/fixtures/visual/`` holds the eight canned server responses the front-end
screenshot suite renders: six slice payloads at ``resolution=65`` and the two
preset catalogs. They are committed for the same reason
``tests/fixtures/slice_golden.json`` is -- so a change to the numbers a client
receives arrives as a diff someone reads rather than as a re-derivation every
test recomputes and therefore agrees with -- and for one reason of their own: a
screenshot diff is only evidence about *rendering* if the bytes going into the
renderer are pinned. An unpinned fixture turns every visual regression into an
argument about whether the data moved.

So this module gates two separate things.

**The bytes.** Every fixture is rebuilt through
``scripts/write_visual_fixtures.py`` and compared, with a mutated-copy negative
control proving the comparison can fail, and a directory census proving no
stale fixture survives a rename to go on feeding a screenshot nothing rebuilds.

**The physics the screenshots are read as evidence for.** Two of the six slices
exist as a *pair*, and each pair carries a claim that a reviewer looking at two
PNGs is being asked to believe:

* ``degenerate-stationary-xz`` at ``t=0`` and ``t=8.4`` -- 2s + 2p_z share the
  energy ``-1/8`` hartree, so the time dependence is one global phase and
  ``|Psi|^2`` cannot move. The pair is the negative control of the whole
  animation feature: two identical pictures. Asserted on the arrays, because
  "the two PNGs look the same" is also what a renderer that ignores ``time_au``
  produces.
* ``1s2pz`` at ``t=0`` and ``t=8.4`` -- 1s + 2p_z beat at
  ``omega = E_2 - E_1 = 3/8`` hartree, period ``2*pi/omega = 16.7551...``, so
  ``t=8.4`` is within ``0.023`` au of the half period and the interference term
  has all but exactly reversed. The pair is the positive control: the dipole
  has swung from one lobe to the other. Asserted with a *quantified* floor, not
  merely "something differs", because a one-sample wobble would satisfy
  "differs" while the picture stayed put.

Regenerate with::

    uv run python scripts/write_visual_fixtures.py

and read the diff: a surprise here is a change to what the screenshots are of.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Final, NoReturn

import numpy as np
import pytest
from numpy.typing import NDArray

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "write_visual_fixtures.py"
DIRECTORY = ROOT / "tests" / "fixtures" / "visual"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Registered before ``exec_module``, which is importlib's own documented
    # recipe and not defensiveness here: ``@dataclass`` resolves its field
    # annotations through ``sys.modules[cls.__module__]``, so a script holding
    # one raises ``AttributeError: 'NoneType' object has no attribute
    # '__dict__'`` at class-creation time if the module was never registered
    # (reproduced -- it is how this line got written). The name is the script's
    # stem, which shadows nothing importable.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


write_visual_fixtures = _load_script(SCRIPT)

FIXTURE_NAMES: Final[tuple[str, ...]] = tuple(
    sorted(fixture.name for fixture in write_visual_fixtures.FIXTURES)
)

#: The stationary pair. Same shell, same energy, so only ``time_au`` may differ.
DEGENERATE_PAIR: Final[tuple[str, str]] = (
    "degenerate-stationary-xz-t0",
    "degenerate-stationary-xz-t8.4",
)

#: The oscillating pair, half a Bohr period apart.
OSCILLATING_PAIR: Final[tuple[str, str]] = ("1s2pz-t0-xz", "1s2pz-t8.4-xz")

#: What a degenerate pair is allowed to differ by, and why it is not zero.
#:
#: The claim is exact -- a common ``exp(-i E t / hbar)`` cancels out of
#: ``|Psi|^2`` -- but the arithmetic is not: ``SuperpositionState.evaluate``
#: multiplies each term by that phase separately and sums, so the two times
#: reach ``|Psi|^2`` through different roundings. The measured gap is
#: ``2.6e-18`` against a peak density of ``1.99e-2``: about one ulp of a double,
#: and roughly ``3e-14`` of the ``1/255`` step an 8-bit rendering quantises to.
#: The bound below leaves ~400x headroom over the measured value, which is room
#: for a different libm, not room for physics.
DEGENERATE_MAX_ABSOLUTE_DIFFERENCE: Final[float] = 1e-15

#: The same statement referred to the picture: relative to the peak of the
#: field, a difference this small cannot survive quantisation to any display.
DEGENERATE_MAX_RELATIVE_DIFFERENCE: Final[float] = 1e-12

#: What the oscillating pair must move by, in the units of the payload
#: (``bohr^-3``). Measured: ``2.7366e-2`` against a peak of ``1.5915e-1``.
OSCILLATING_MIN_ABSOLUTE_DIFFERENCE: Final[float] = 2.0e-2

#: And relative to that peak: ``0.1719`` measured, i.e. about 44 steps of an
#: 8-bit ramp. This is the number that makes the screenshot pair evidence.
OSCILLATING_MIN_RELATIVE_DIFFERENCE: Final[float] = 0.15


def _committed_text(name: str) -> str:
    # ``read_bytes`` rather than ``read_text``: on Windows text mode would
    # translate the committed LF line endings and every comparison here would
    # be about newline handling instead of about the payload.
    return (DIRECTORY / f"{name}.json").read_bytes().decode("utf-8")


def _document(name: str) -> dict[str, Any]:
    document: dict[str, Any] = json.loads(_committed_text(name))
    return document


def _values(name: str) -> NDArray[np.float64]:
    return np.asarray(_document(name)["values"], dtype=np.float64)


def _locate_difference(rebuilt: str, committed: str) -> str:
    """Where two fixture texts first diverge, as a line a person can read.

    Not cosmetic. A bare ``assert rebuilt == committed`` on these strings makes
    pytest build a character diff of two ~117 KB documents: measured, the run
    had not finished rendering it after two minutes, so the gate's *failure*
    mode was an apparent hang and the reason was never printed. The comparison
    below is exact either way; only the report is bounded.
    """

    for index, (produced, stored) in enumerate(zip(rebuilt, committed, strict=False)):
        if produced != stored:
            window = slice(max(0, index - 60), index + 60)
            return (
                f"first difference at character {index}\n"
                f"  rebuilt  : ...{rebuilt[window]}...\n"
                f"  committed: ...{committed[window]}..."
            )
    shared = min(len(rebuilt), len(committed))
    return (
        f"identical for {shared} characters, then one text ends: "
        f"rebuilt is {len(rebuilt)} characters, committed is {len(committed)}"
    )


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_the_builders_reproduce_the_committed_visual_fixture_bytes(name: str) -> None:
    """The gate. Any difference at all, in either direction, fails here."""

    fixture = write_visual_fixtures.fixture_named(name)
    # ``fixture.path`` rather than a path rebuilt here: the script decides where
    # its fixtures live, and a gate that reimplements that decision would keep
    # passing against the old location after the script moved.
    assert fixture.path.is_file(), (
        f"{fixture.path} does not exist; generate it with "
        "`uv run python scripts/write_visual_fixtures.py`"
    )
    assert fixture.path == DIRECTORY / f"{name}.json"
    rebuilt = write_visual_fixtures.canonical(fixture.build())
    committed = _committed_text(name)

    if rebuilt != committed:
        pytest.fail(
            f"tests/fixtures/visual/{name}.json is not what the builder produces, so the "
            "screenshots taken from it are of data the server no longer serves. Regenerate with "
            "`uv run python scripts/write_visual_fixtures.py` and review the diff as the change "
            f"to the rendered payload that it is.\n{_locate_difference(rebuilt, committed)}"
        )


def test_a_mutated_payload_no_longer_matches_its_committed_fixture() -> None:
    """Negative control: the comparison above must be able to fail.

    Without it a ``canonical`` that ignored its argument -- one returning a
    constant, or reading the committed file back -- would satisfy every case
    above while comparing nothing. Here one built payload is copied with a
    single field changed and the serialisation of the copy must differ.
    """

    name = OSCILLATING_PAIR[0]
    payload = write_visual_fixtures.fixture_named(name).build()

    # ``model_copy`` rather than assignment: ``build_superposition_slice`` is
    # ``lru_cache``d, so the payload it hands back is shared and mutating it in
    # place would corrupt every later caller in this process.
    mutated = payload.model_copy(update={"values": [value + 1.0 for value in payload.values]})
    # ``pytest.fail`` rather than ``assert !=`` for the reason given in
    # ``_locate_difference``: on failure the two texts are equal and ~117 KB,
    # and pytest would spend minutes rendering them instead of saying so.
    if write_visual_fixtures.canonical(mutated) == _committed_text(name):
        pytest.fail(
            "a payload with every sample shifted by 1.0 serialised to the committed bytes, so "
            "the comparison above is not actually comparing the payload"
        )


def test_an_undeclared_fixture_name_is_refused_and_the_refusal_names_the_set() -> None:
    """A typo must fail loudly here, not silently gate nothing.

    ``fixture_named`` is what every gate in this module resolves a name
    through. Returning ``None`` -- or any quiet miss -- for an unknown name
    would let a renamed fixture drop out of the parametrised gate without a
    word, which is the same hole the directory census closes from the other
    side.
    """

    with pytest.raises(KeyError) as failure:
        write_visual_fixtures.fixture_named("2pz-real-xy")

    message = str(failure.value)
    assert "2pz-real-xy" in message
    for name in FIXTURE_NAMES:
        assert name in message, f"the refusal must name {name} so a typo is visible against it"


def test_main_writes_every_declared_fixture_with_unix_line_endings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``main`` must write the whole declared set, as LF, byte-identical to the gate.

    Two failure modes, both of which have bitten this repo's other generators.
    The default ``write_text`` on Windows translates ``\\n`` to CRLF while
    ``.gitattributes`` checks the tree out with LF, so every regeneration would
    rewrite every file in full and no diff would be readable. And a ``main``
    that serialised through anything other than ``canonical`` would produce
    files the byte gate above then refuses, with the script and its own gate
    permanently disagreeing.

    Run against ``tmp_path`` rather than the real directory so the test cannot
    repair a fixture it is supposed to be judging.
    """

    monkeypatch.setattr(write_visual_fixtures, "DIRECTORY", tmp_path / "visual")
    write_visual_fixtures.main()

    written = sorted(path.stem for path in (tmp_path / "visual").glob("*.json"))
    assert written == sorted(FIXTURE_NAMES)

    for name in FIXTURE_NAMES:
        raw = (tmp_path / "visual" / f"{name}.json").read_bytes()
        assert b"\r" not in raw, (
            f"{name}.json was written with CRLF; .gitattributes checks this tree out with LF, so "
            "every regeneration on Windows would rewrite the whole file and hide the real diff"
        )
        assert raw.decode("utf-8") == _committed_text(name), (
            f"main() wrote a {name}.json that differs from the committed one, so the generator "
            "and the byte gate above disagree about what this fixture is"
        )


def test_the_fixture_directory_holds_exactly_the_declared_set() -> None:
    """No orphans, so a rename cannot leave a screenshot fed by dead bytes.

    The parametrised gate above only visits fixtures the script still declares.
    A file left behind by a rename would keep whatever it held, and the byte
    gate would never look at it again.
    """

    assert DIRECTORY.is_dir(), (
        f"{DIRECTORY} does not exist; generate it with "
        "`uv run python scripts/write_visual_fixtures.py`"
    )
    on_disk = sorted(path.stem for path in DIRECTORY.glob("*.json"))
    assert on_disk == sorted(FIXTURE_NAMES), (
        "tests/fixtures/visual/ does not hold exactly the fixtures the script declares. A file "
        "here that the script no longer builds is never rebuilt and never compared, so a "
        "screenshot can go on being taken of bytes nothing derives."
    )


def test_the_degenerate_pair_is_the_same_field_at_two_times() -> None:
    """Physics claim 1: 2s + 2p_z is stationary, so only ``time_au`` may move.

    Both terms have ``n=2``, hence one energy, hence one global phase, which
    ``|Psi|^2`` discards. The screenshot pair is the negative control for the
    animation: two identical pictures. Asserted on the arrays because a
    renderer that silently ignored ``time_au`` would produce the same two PNGs
    for the wrong reason -- so the fixtures must first be shown to carry two
    different times.
    """

    early, late = DEGENERATE_PAIR
    assert _document(early)["metadata"]["time_au"] == 0.0
    assert _document(late)["metadata"]["time_au"] == 8.4
    assert _document(early)["metadata"]["is_stationary"] is True

    first, second = _values(early), _values(late)
    peak = float(np.max(np.abs(first)))
    assert peak > 0.0, "a degenerate density of exactly zero everywhere proves nothing"

    difference = float(np.max(np.abs(first - second)))
    assert difference <= DEGENERATE_MAX_ABSOLUTE_DIFFERENCE, (
        f"the degenerate pair differs by {difference:.3e} bohr^-3, above the "
        f"{DEGENERATE_MAX_ABSOLUTE_DIFFERENCE:.0e} floating-point bound. A degenerate "
        "superposition's density cannot evolve, so this is either a broken energy or a broken "
        "time phase -- not rounding."
    )
    assert difference / peak <= DEGENERATE_MAX_RELATIVE_DIFFERENCE, (
        f"the degenerate pair differs by {difference / peak:.3e} of its own peak; nothing this "
        "large is rounding"
    )


def test_the_oscillating_pair_moves_by_an_amount_a_screenshot_can_show() -> None:
    """Physics claim 2: 1s + 2p_z at half a Bohr period has visibly moved.

    ``omega = E_2 - E_1 = 3/8`` hartree and ``T = 2*pi/omega = 16.7551...`` au,
    so ``t=8.4`` sits ``0.0224`` au past the half period -- close enough that
    ``cos(omega t) = -0.99996``, i.e. the interference term has essentially
    reversed and the dipole has swung to the opposite lobe. ``8.4`` rather than
    ``8.3776`` because it is a whole multiple of the ``0.6`` au playback step,
    so the frame the screenshot shows is a frame playback actually lands on.

    A quantified floor, not an inequality: "the arrays differ" is satisfied by
    a single sample in the tail, which is not a picture anyone can read.
    """

    early, late = OSCILLATING_PAIR
    assert _document(early)["metadata"]["time_au"] == 0.0
    assert _document(late)["metadata"]["time_au"] == 8.4
    assert _document(early)["metadata"]["is_stationary"] is False

    first, second = _values(early), _values(late)
    peak = float(np.max(np.abs(first)))
    difference = float(np.max(np.abs(first - second)))

    assert difference >= OSCILLATING_MIN_ABSOLUTE_DIFFERENCE, (
        f"the 1s + 2p_z pair differs by only {difference:.3e} bohr^-3, below the "
        f"{OSCILLATING_MIN_ABSOLUTE_DIFFERENCE:.0e} floor. Half a Bohr period apart the density "
        "must have swung between lobes; this little movement means the time phase is not being "
        "applied."
    )
    assert difference / peak >= OSCILLATING_MIN_RELATIVE_DIFFERENCE, (
        f"the 1s + 2p_z pair differs by {difference / peak:.4f} of its peak, below the "
        f"{OSCILLATING_MIN_RELATIVE_DIFFERENCE} floor -- less than the movement a reader is being "
        "asked to see in the screenshot pair."
    )

    # The two claims side by side: the pair that must not move and the pair
    # that must. Stated as a ratio so the gate is about the *contrast* the two
    # screenshot pairs are read as, and not only about two independent bounds.
    stationary = float(np.max(np.abs(_values(DEGENERATE_PAIR[0]) - _values(DEGENERATE_PAIR[1]))))
    assert difference > stationary * 1e12, (
        f"the oscillating pair moves by {difference:.3e} and the stationary pair by "
        f"{stationary:.3e}; these are not separated by the many orders of magnitude that make "
        "one pair a picture of motion and the other a picture of rounding"
    )


def test_the_phase_fixture_carries_a_masked_sample_at_the_origin() -> None:
    """The mask fixture must actually exercise the mask, not merely declare it.

    ``2p(+1)`` on the ``xy`` plane is ``r e^{-r/2} sin(theta) e^{i phi}`` with
    ``theta = pi/2``: non-zero everywhere except the origin, where the
    amplitude vanishes and the phase is undefined. That single masked sample --
    the centre of a 65x65 grid, index ``32 * 65 + 32`` -- is the whole reason
    this fixture exists: it is what a client reading ``valid_mask`` renders as
    a hole and a client ignoring it renders as a bogus zero-phase pixel.

    A byte comparison is satisfied by any file, this one included after a
    regeneration that quietly moved the plane to ``xz`` and masked nothing.
    """

    document = _document("2p+1-phase-xy")

    assert document["slice_observable"] == "phase"
    assert document["plane"] == "xy"
    assert document["resolution"] == 65
    assert len(document["values"]) == 65 * 65

    mask = document["valid_mask"]
    assert mask is not None, "a phase fixture without a mask pins nothing about masking"
    masked = [index for index, valid in enumerate(mask) if not valid]
    assert masked == [32 * 65 + 32], (
        f"expected exactly the centre sample to be masked, got {masked}; the origin is the only "
        "point of this plane where 2p(+1) has no amplitude"
    )
    assert document["values"][masked[0]] == document["masked_value_sentinel"]

    # The frozen mask rule: the threshold comes from the STATE's amplitude
    # scale (``L_ref**-1.5``), never from this plane's own maximum. Reading it
    # off the plane would rescale it to whatever residue happened to be there.
    assert (
        document["phase_mask_amplitude_threshold"]
        == document["phase_mask_relative_amplitude"] * document["phase_mask_amplitude_scale"]
    )
    assert document["phase_mask_amplitude_scale"] != document["max_amplitude_on_plane"]


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_no_fixture_carries_a_token_a_strict_json_parser_would_reject(name: str) -> None:
    """``allow_nan=False`` is load-bearing, so it is checked on the raw text.

    Python's ``json`` writes the bare ``NaN`` / ``Infinity`` tokens that no
    parser outside Python accepts -- and the consumer here is a browser. These
    files are read back by Python, so a round-trip through ``json.loads`` would
    accept them silently; the gate has to be on the text.
    """

    def reject(token: str) -> NoReturn:
        raise AssertionError(
            f"tests/fixtures/visual/{name}.json holds the bare {token!r} token, which the browser "
            "that renders this fixture will not parse"
        )

    json.loads(_committed_text(name), parse_constant=reject)
