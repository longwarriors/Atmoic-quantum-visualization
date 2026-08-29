"""The committed visual fixtures must be what the builders produce.

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

**The payload.** Every fixture is rebuilt through
``scripts/write_visual_fixtures.py`` and compared against the committed file,
with mutated-copy negative controls proving the comparison can fail, and a
directory census proving no stale fixture survives a rename to go on feeding a
screenshot nothing rebuilds.

The two catalogs are compared byte-for-byte: their route-owned strings and
scalars are deterministic, including the superposition periods derived from
fixed hydrogenic energy gaps, so every difference in them is a real contract
change. The six slices are compared *structurally* --
key sets, types, list lengths, strings, integers and every ``valid_mask``
boolean exactly; float samples within :data:`FLOAT_RELATIVE_TOLERANCE` -- and
the reason is measured rather than defensive. These fixtures were generated on
Windows and CI rebuilds them on Linux, where a different libm rounds the
``arccos``/``atan2``/``cos``/``exp`` chain differently in the last digit; the
decimal reprs then differ and a byte comparison fails on a payload nothing has
changed. It did: CI run 33085530468 went red on all six slices for exactly
this, in one sample of 4225 each.

What that gives up is small and worth naming. The committed bytes are still
what the browser is served, and still the only thing the screenshots render;
what stopped being asserted is that a rebuild *on a different platform*
reproduces them digit for digit. What is still asserted is everything a
screenshot could show -- see
``test_a_perturbation_far_below_a_visible_change_is_still_caught``, which pins
the gap between the allowance and the smallest change anyone could see at ten
orders of magnitude.

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
import math
import sys
from collections.abc import Callable
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

#: The fixtures held to their exact bytes: the two preset catalogs. Their data
#: is route-owned and deterministic. In particular, superposition ``period_au``
#: is intentionally derived from fixed hydrogenic energies and ``math.tau``;
#: it does not traverse the platform-sensitive libm chain used by slice samples.
#: Any byte difference is therefore a real catalog-contract change.
#: Their non-ASCII labels (``2pₓ``, ``3d_z²``) also make them the fixtures that
#: pin ``ensure_ascii=False``, which only a comparison on the text can see.
CATALOG_NAMES: Final[tuple[str, ...]] = ("catalog-orbitals", "catalog-superposition")

#: Everything else: the computed slice payloads, compared structurally. Derived
#: as the complement rather than listed, so a fixture added to the script and
#: not to this module lands in the structural gate instead of in neither. The
#: census below asserts the two lists still cover the declared set.
SLICE_NAMES: Final[tuple[str, ...]] = tuple(
    name for name in FIXTURE_NAMES if name not in CATALOG_NAMES
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

#: How far a float may move between platforms before it counts as a change.
#:
#: Measured, not chosen. The committed fixtures were generated on Windows
#: (UCRT) and CI rebuilds them on Linux (glibc); neither libm is correctly
#: rounded, so the ``arccos``/``atan2``/``cos``/``exp`` chain behind every
#: sample disagrees in the last digit or two. From CI run 33085530468:
#: ``2pz-real-xz`` sample 0 is ``-1.3336064375039158e-05`` on glibc against
#: ``-1.3336064375039151e-05`` on UCRT, a relative gap of ``5.2e-16``, and
#: ``2p+1-phase-xy`` disagrees by one ulp, ``0.869941918910446`` against
#: ``0.8699419189104461``. This is the same effect that widened the S2 bound in
#: ``tests/test_slice_science.py`` to four ulp, for the same chain.
#:
#: ``1e-12`` sits about three orders of magnitude above that measured gap and
#: ten below the smallest change a screenshot could show: the oscillating pair
#: these fixtures exist to contrast moves by ``0.17`` of its own peak, and
#: ``test_a_perturbation_far_below_a_visible_change_is_still_caught`` pins a
#: perturbation a thousand times finer than that as still caught.
FLOAT_RELATIVE_TOLERANCE: Final[float] = 1e-12

#: A sample array is compared against its own peak as well as sample by sample.
#:
#: Without this a relative-only bound would be strictest exactly where the two
#: libms agree least. ``2pz-real-xz`` is the case that forces it: 64 of its 4225
#: samples lie on the ``z = 0`` nodal row, where the value is not a number the
#: physics produces but the residue left by ``cos(arccos(z / r))`` failing to
#: cancel -- they run from ``4.5e-18`` down to ``1.0e-20``, the smallest being
#: ``1.4e-19`` of the ``7.3e-2`` plane peak. Every digit of such a residue is
#: the libm's; demanding twelve significant figures of it would re-create the
#: flake this comparison exists to remove, while asserting nothing about the
#: picture, in which a sample nineteen orders below the peak is not there. So
#: the allowance is ``FLOAT_RELATIVE_TOLERANCE * peak + FLOAT_RELATIVE_TOLERANCE
#: * |sample|``: twelve digits where the field has amplitude, and invisibility
#: where it does not. Against the ``2pz`` peak that floor is ``7.3e-14``.
#:
#: Scalar floats do not get this treatment -- they are compared relatively with
#: no floor. None of them is a cancellation residue: the smallest,
#: ``phase_mask_numeric_floor`` at ``7.4e-16``, is a product (``64 * eps`` times
#: the amplitude scale) and so is stable in its relative digits.
SAMPLE_PEAK_TOLERANCE: Final[float] = FLOAT_RELATIVE_TOLERANCE

#: How many differences a failure lists before it stops. A payload that really
#: changed differs in thousands of samples, and the first few locate it.
MAX_REPORTED_DIFFERENCES: Final[int] = 5


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


def _kind(value: Any) -> str:
    """The JSON type of ``value``, with ``bool`` separated from ``int``.

    ``bool`` is a subclass of ``int`` in Python, so every type test in this
    module has to ask about it first. Getting that wrong would put
    ``valid_mask`` on the numeric path and compare mask bits with a tolerance,
    which is the one thing the comparison below must never do.
    """

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _sample_array(value: Any) -> NDArray[np.float64] | None:
    """``value`` as a float array if it is one, else ``None``.

    Every element must be a ``float``: a list holding an ``int`` -- or a
    ``bool``, which ``_kind`` keeps out -- is compared exactly, element by
    element, because an integer that changed did not round, it changed.
    """

    if not isinstance(value, list) or not value:
        return None
    if not all(type(item) is float for item in value):
        return None
    return np.asarray(value, dtype=np.float64)


def _compare_samples(
    rebuilt: NDArray[np.float64],
    committed: NDArray[np.float64],
    path: str,
    report: list[str],
) -> None:
    """Append the worst sample difference exceeding the allowance, if any."""

    peak = float(np.max(np.abs(committed)))
    allowed = SAMPLE_PEAK_TOLERANCE * peak + FLOAT_RELATIVE_TOLERANCE * np.abs(committed)
    excess = np.abs(rebuilt - committed) - allowed
    over = int(np.count_nonzero(excess > 0.0))
    if over == 0:
        return
    worst = int(np.argmax(excess))
    difference = abs(float(rebuilt[worst]) - float(committed[worst]))
    report.append(
        f"{path}: {over} of {committed.size} samples move by more than the cross-platform "
        f"allowance; worst at [{worst}], rebuilt {float(rebuilt[worst])!r} vs committed "
        f"{float(committed[worst])!r} (differs by {difference:.6e}, allowed "
        f"{float(allowed[worst]):.6e}, plane peak {peak:.6e})"
    )


def _compare(rebuilt: Any, committed: Any, path: str, report: list[str]) -> None:
    """Walk two parsed payloads together, appending every difference found.

    Exact on everything a renderer branches on -- key sets, types, list
    lengths, strings, integers, booleans and ``null`` -- and tolerant only on
    floats. ``valid_mask`` rides the exact path deliberately: if a mask bit ever
    differed between platforms it would mean a sample sits within ulps of the
    masking threshold, which is a real defect in where that threshold is drawn
    (one client draws a hole, another draws a pixel) and not a rounding detail
    to absorb. Let it surface.
    """

    if len(report) >= MAX_REPORTED_DIFFERENCES:
        return

    if _kind(rebuilt) != _kind(committed):
        report.append(f"{path}: rebuilt is a {_kind(rebuilt)}, committed is a {_kind(committed)}")
        return

    if isinstance(committed, dict):
        assert isinstance(rebuilt, dict)
        if rebuilt.keys() != committed.keys():
            missing = sorted(set(committed) - set(rebuilt))
            unexpected = sorted(set(rebuilt) - set(committed))
            report.append(f"{path}: key set differs -- missing {missing}, unexpected {unexpected}")
            return
        for key in sorted(committed):
            _compare(rebuilt[key], committed[key], f"{path}.{key}", report)
        return

    if isinstance(committed, list):
        assert isinstance(rebuilt, list)
        if len(rebuilt) != len(committed):
            report.append(
                f"{path}: rebuilt holds {len(rebuilt)} entries, committed holds {len(committed)}"
            )
            return
        stored, produced = _sample_array(committed), _sample_array(rebuilt)
        if stored is not None and produced is not None:
            _compare_samples(produced, stored, path, report)
            return
        for index, (left, right) in enumerate(zip(rebuilt, committed, strict=True)):
            _compare(left, right, f"{path}[{index}]", report)
        return

    if isinstance(committed, float):
        assert isinstance(rebuilt, float)
        if not math.isclose(rebuilt, committed, rel_tol=FLOAT_RELATIVE_TOLERANCE, abs_tol=0.0):
            report.append(f"{path}: rebuilt {rebuilt!r}, committed {committed!r}")
        return

    if rebuilt != committed:
        report.append(f"{path}: rebuilt {rebuilt!r}, committed {committed!r}")


def _mismatch(name: str, rebuilt: str) -> str | None:
    """Why ``rebuilt`` is not the committed fixture ``name``, or ``None``.

    One entry point for both gates below, so the generator and the fixture gate
    can never disagree about what "matches" means. Catalogs are held to their
    bytes and slices to their structure; see ``CATALOG_NAMES``.
    """

    committed = _committed_text(name)
    if name in CATALOG_NAMES:
        return None if rebuilt == committed else _locate_difference(rebuilt, committed)
    report: list[str] = []
    _compare(json.loads(rebuilt), json.loads(committed), name, report)
    return None if not report else "\n".join(report)


def _assert_fixture_is_where_the_script_puts_it(name: str) -> None:
    fixture = write_visual_fixtures.fixture_named(name)
    # ``fixture.path`` rather than a path rebuilt here: the script decides where
    # its fixtures live, and a gate that reimplements that decision would keep
    # passing against the old location after the script moved.
    assert fixture.path.is_file(), (
        f"{fixture.path} does not exist; generate it with "
        "`uv run python scripts/write_visual_fixtures.py`"
    )
    assert fixture.path == DIRECTORY / f"{name}.json"


@pytest.mark.parametrize("name", CATALOG_NAMES)
def test_the_builders_reproduce_the_committed_catalog_bytes(name: str) -> None:
    """Deterministic catalog data, including derived periods, is held to exact bytes."""

    _assert_fixture_is_where_the_script_puts_it(name)
    rebuilt = write_visual_fixtures.canonical(write_visual_fixtures.fixture_named(name).build())
    committed = _committed_text(name)

    if rebuilt != committed:
        pytest.fail(
            f"tests/fixtures/visual/{name}.json is not what the builder produces, so the preset "
            "strip in every screenshot is of a catalog the server no longer returns. Regenerate "
            "with `uv run python scripts/write_visual_fixtures.py` and review the diff.\n"
            f"{_locate_difference(rebuilt, committed)}"
        )


@pytest.mark.parametrize("name", SLICE_NAMES)
def test_the_builders_reproduce_the_committed_slice_payloads(name: str) -> None:
    """The gate. Exact on structure and masks, ``1e-12`` on the floats.

    Not a byte comparison, and the module docstring says why: the same payload
    serialises to different digits under a different libm, so byte equality is
    a claim about the C library and not about the payload. Everything a
    renderer branches on is still exact.
    """

    _assert_fixture_is_where_the_script_puts_it(name)
    rebuilt = write_visual_fixtures.canonical(write_visual_fixtures.fixture_named(name).build())

    mismatch = _mismatch(name, rebuilt)
    if mismatch is not None:
        pytest.fail(
            f"tests/fixtures/visual/{name}.json is not what the builder produces, so the "
            "screenshots taken from it are of data the server no longer serves. Regenerate with "
            "`uv run python scripts/write_visual_fixtures.py` and review the diff as the change "
            f"to the rendered payload that it is.\n{mismatch}"
        )


def _mutated(name: str, **update: Any) -> str:
    """The fixture's own payload, copied with ``update`` applied, serialised.

    ``model_copy`` rather than assignment keeps the sabotage local. Both public
    builders wrap private LRUs and return deep copies, so callers cannot corrupt
    cached payloads. ``model_copy`` also skips validation,
    which is what lets a mask bit be flipped without the payload's own
    "masked values equal the sentinel" rule rejecting the sabotage first.
    """

    payload = write_visual_fixtures.fixture_named(name).build()
    return write_visual_fixtures.canonical(payload.model_copy(update=update))


def _nudged_at_the_peak(name: str, fraction: float) -> str:
    """The payload with its largest sample moved by ``fraction`` of itself.

    The peak sample, because that is where the allowance is widest -- a
    perturbation caught there is caught anywhere, and one accepted there is the
    most generous reading of what the tolerance permits.
    """

    payload = write_visual_fixtures.fixture_named(name).build()
    values = list(payload.values)
    peak = max(range(len(values)), key=lambda index: abs(values[index]))
    values[peak] += fraction * abs(values[peak])
    return write_visual_fixtures.canonical(payload.model_copy(update={"values": values}))


def _reshaped(name: str, edit: Callable[[dict[str, Any]], None]) -> str:
    """The payload's serialised document with ``edit`` applied to its top level.

    Reaching past the model, because the shapes this has to produce are ones a
    pydantic model cannot hold: a missing field, an extra one, a ``values``
    array of the wrong length. Those are exactly the differences a byte
    comparison used to catch for free.
    """

    document: dict[str, Any] = json.loads(
        write_visual_fixtures.canonical(write_visual_fixtures.fixture_named(name).build())
    )
    edit(document)
    return json.dumps(document, indent=2, sort_keys=True, allow_nan=False, ensure_ascii=False)


def test_a_payload_of_the_wrong_shape_is_caught() -> None:
    """Negative control for the structure, not the numbers.

    The byte comparison this module used to run caught a dropped field, a new
    one, and a truncated array for free: the text simply differed. A structural
    walk catches them only if it really compares key sets and list lengths, so
    those two comparisons need a control of their own -- without this test a
    comparator that looked only at the keys both documents happen to share
    passed the whole suite (measured, which is why this test exists).

    ``valid_mask`` is the field dropped, because its absence is the difference
    between a client drawing the hole where 2p(+1) has no amplitude and having
    nothing to draw it from.
    """

    name = "2p+1-phase-xy"

    def drop_the_mask(document: dict[str, Any]) -> None:
        del document["valid_mask"]

    def add_a_field(document: dict[str, Any]) -> None:
        document["unexpected_field"] = 0

    def truncate_the_samples(document: dict[str, Any]) -> None:
        document["values"] = document["values"][:-1]

    for label, edit in (
        ("a payload missing valid_mask", drop_the_mask),
        ("a payload carrying an undeclared field", add_a_field),
        ("a payload one sample short", truncate_the_samples),
    ):
        if _mismatch(name, _reshaped(name, edit)) is None:
            pytest.fail(
                f"{label} matched its committed fixture, so the comparison is looking at the "
                "numbers without looking at the shape they arrive in"
            )


def test_a_mutated_payload_no_longer_matches_its_committed_fixture() -> None:
    """Negative control: the comparison above must be able to fail.

    Without it a ``canonical`` that ignored its argument -- one returning a
    constant, or reading the committed file back -- would satisfy every case
    above while comparing nothing. Here one built payload is copied with a
    single field changed and the comparison of the copy must fail.
    """

    name = OSCILLATING_PAIR[0]
    payload = write_visual_fixtures.fixture_named(name).build()
    mutated = _mutated(name, values=[value + 1.0 for value in payload.values])

    if _mismatch(name, mutated) is None:
        pytest.fail(
            "a payload with every sample shifted by 1.0 matched its committed fixture, so the "
            "comparison above is not actually comparing the payload"
        )


def test_a_perturbation_far_below_a_visible_change_is_still_caught() -> None:
    """The tolerance is an allowance for libm, not a blanket pass.

    One sample moved by ``1e-9`` of itself: a thousand times finer than the
    ``1e-6`` relative amplitude at which this code masks a phase as
    unresolvable, and about seven orders below one step of an 8-bit ramp -- so
    invisible in any screenshot, and still refused. That is the gap being
    claimed: three orders of magnitude above the measured cross-libm
    disagreement, ten below anything a picture could show.
    """

    name = OSCILLATING_PAIR[0]

    if _mismatch(name, _nudged_at_the_peak(name, 1e-9)) is None:
        pytest.fail(
            "one sample moved by 1e-9 of its own value matched the committed fixture, so the "
            f"{FLOAT_RELATIVE_TOLERANCE:.0e} allowance is absorbing changes far larger than the "
            "last-digit libm difference it exists for"
        )


def test_a_rebuild_with_another_libms_rounding_still_matches() -> None:
    """The other half of the claim, and the failure this comparison was written for.

    A stand-in for the Linux rebuild, built from the real payload: every sample
    walked three ulp in a direction drawn per sample, and the 64 nodal-row
    residues replaced outright. The replacement is the honest part -- those
    samples are not values the physics produces but what is left when
    ``cos(arccos(z / r))`` fails to cancel, so a different libm does not perturb
    them, it produces different ones. The assertion under them is not "these
    digits agree" but "nothing here is visible against a peak of ``7.3e-2``".

    Two things are pinned at once. That such a payload passes -- it is what CI
    rebuilt, and the byte comparison this replaced refused it (asserted below,
    so this stays a model of that failure and not of nothing). And that the
    tolerance cannot quietly be tightened back towards byte equality: doing so
    fails here, on a developer machine, instead of as a red CI on the one
    platform the developer is not using.
    """

    name = "2pz-real-xz"
    payload = write_visual_fixtures.fixture_named(name).build()
    values = np.asarray(payload.values, dtype=np.float64)
    peak = float(np.max(np.abs(values)))
    # Seeded: a control that is a different payload on every run is not a
    # control, it is a lottery over how much noise happened to be drawn.
    generator = np.random.default_rng(20260827)

    shifted = values.copy()
    for _ in range(3):
        direction = np.where(generator.random(shifted.shape) < 0.5, -np.inf, np.inf)
        shifted = np.nextafter(shifted, direction)
    # The exact zero at the origin is excluded: there ``r = 0`` and the value is
    # ``0 * exp(0)``, which no libm has an opinion about. It is the one sample of
    # the nodal row that is genuinely zero rather than a residue, and it stays
    # bitwise zero on every platform -- so a stand-in that moved it would be
    # modelling something that does not happen.
    residues = (np.abs(values) < 1e-15 * peak) & (values != 0.0)
    assert int(np.count_nonzero(residues)) == 64, "the nodal row is what makes this test the case"
    shifted[residues] = generator.uniform(-1.0, 1.0, int(np.count_nonzero(residues))) * 1e-17

    rebuilt = _mutated(name, values=shifted.tolist())
    assert rebuilt != _committed_text(name), (
        "the stand-in serialised to the committed bytes, so it models no cross-platform "
        "difference at all and the assertion below would hold for any comparison whatsoever"
    )
    assert _mismatch(name, rebuilt) is None, (
        "a payload differing from the committed one only by last-digit rounding and by which "
        "residue a libm leaves on the nodal row was reported as a change -- this is exactly what "
        "CI rebuilds on Linux, so this tolerance is about to fail CI there again"
    )


def test_a_single_flipped_mask_bit_is_caught_exactly() -> None:
    """``valid_mask`` is compared bit for bit, and nothing absorbs one flip.

    The tolerance applies to floats only. Unmasking the origin of the phase
    fixture is the regression that matters -- it is the difference between a
    client drawing the hole where 2p(+1) has no amplitude and drawing a
    spurious zero-phase pixel there -- and one bit is the whole of it.
    """

    name = "2p+1-phase-xy"
    payload = write_visual_fixtures.fixture_named(name).build()
    mask = list(payload.valid_mask)
    centre = 32 * 65 + 32
    assert mask[centre] is False, "this control assumes the origin is the masked sample"
    mask[centre] = True

    if _mismatch(name, _mutated(name, valid_mask=mask)) is None:
        pytest.fail(
            "unmasking the origin left the payload matching its committed fixture, so valid_mask "
            "is not being compared and a client could render a phase where there is no amplitude"
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
        written = raw.decode("utf-8")
        # Byte-exact against ``canonical`` -- both run in this process, so no
        # libm difference can reach it, and it is the only assertion that still
        # sees *formatting*. It has to stay: the structural comparison below
        # parses both sides, so a ``main`` that dumped at a different indent, or
        # with ``ensure_ascii=True``, would sail through it while writing files
        # the reviewer's diff no longer matches.
        assert written == write_visual_fixtures.canonical(
            write_visual_fixtures.fixture_named(name).build()
        ), (
            f"main() wrote a {name}.json that is not what canonical() produces, so the script "
            "serialises through something other than the gate's own serialiser"
        )
        assert _mismatch(name, written) is None, (
            f"main() wrote a {name}.json that differs from the committed one, so the generator "
            "and the gate above disagree about what this fixture is"
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

    # And the same census over the two gates, which is the hole the split into
    # a byte comparison and a structural one opened: a fixture in neither list
    # is declared, present on disk, and compared by nothing.
    assert sorted([*CATALOG_NAMES, *SLICE_NAMES]) == sorted(FIXTURE_NAMES)
    assert not set(CATALOG_NAMES) & set(SLICE_NAMES)
    assert CATALOG_NAMES and SLICE_NAMES, "a gate parametrised over nothing asserts nothing"


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
