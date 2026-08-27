/**
 * Colour maps for the slice renderer.
 *
 * A slice plane shows one of three things about the wavefunction, and each
 * needs a different kind of map (dataviz colour formula, "the four jobs"):
 *
 *   - phase, which is cyclic -> the phase wheel, unchanged;
 *   - a signed real amplitude, whose job is POLARITY -> a diverging map, two
 *     hues with a neutral midpoint;
 *   - a probability density, whose job is MAGNITUDE -> a sequential map, one
 *     hue, monotone lightness.
 *
 * All three are built out of `phaseToRgb`, which stays the single definition of
 * the app's colour language: the diverging poles ARE two points on that wheel,
 * bit for bit, and the sequential ramp's chroma peak is a third. Nothing here
 * introduces a colour the rest of the app does not already show, so a reader
 * who has learned "red is +, cyan is -" from an orbital keeps that reading on a
 * slice.
 *
 * What these maps deliberately do NOT claim: perceptual uniformity. Nothing
 * here is computed in a perceptual space, so the sequential ramp promises
 * monotone relative luminance -- measured in sliceColor.test.ts against the
 * WCAG transfer function -- and no more than that.
 *
 * A=0 (zero amplitude) is the shared floor: the phase of a zero amplitude is
 * undefined, so the phase wheel says nothing meaningful there and the caller
 * must fade to SLICE_NEUTRAL_RGB, which is exactly what both other maps paint
 * at zero. Masked samples are a different case and are not this module's: they
 * read as `null` through `sliceValueAt` and must be filtered before a value
 * reaches a colour map at all.
 */
import { phaseToRgb } from './color'

/** Linear-ish sRGB channel triple, the form three.js `Color.setRGB` takes. */
export type Rgb = [number, number, number]

/**
 * The cyclic map, re-exported rather than reimplemented.
 *
 * Period 2pi, continuous across the +/-pi seam: both are pinned by
 * scene/color.test.ts, and this re-export is what keeps them pinned for the
 * slice renderer too. At A=0 the phase carries no information -- paint
 * SLICE_NEUTRAL_RGB there instead of a wheel colour chosen by rounding noise.
 */
export { phaseToRgb as phaseRgb } from './color'

/** The wheel at phase 0: the positive pole of the diverging map. */
const POSITIVE_POLE: Rgb = phaseToRgb(0)
/** The wheel at phase pi: the negative pole, opposite POSITIVE_POLE in hue. */
const NEGATIVE_POLE: Rgb = phaseToRgb(Math.PI)

/**
 * `(1 - s) * from + s * to`, per channel.
 *
 * Written in that form and NOT as `from + s * (to - from)`: at `s === 1` this
 * one evaluates to `0 * from + 1 * to`, which returns `to`'s own doubles
 * untouched. That is what makes the diverging poles bit-identical to the phase
 * wheel instead of merely close to it, and the same holds at `s === 0` for the
 * neutral.
 */
function mix(from: Rgb, to: Rgb, s: number): Rgb {
  return [
    (1 - s) * from[0] + s * to[0],
    (1 - s) * from[1] + s * to[1],
    (1 - s) * from[2] + s * to[2],
  ]
}

/**
 * How far down from full brightness the neutral sits.
 *
 * The scene renders on `#050a13` (OrbitalCanvas's FOG_COLOR), far darker than
 * the reference palette's dark surface, and a sequential map's near-zero end is
 * allowed to recede toward the surface. 0.35 lands the neutral on `#383838`,
 * within a channel step of the reference palette's documented dark diverging
 * midpoint (`#383835`) and about 1.7:1 against this scene's background: enough
 * for the slice plane to read as a surface, not enough for the baseline of a
 * signed slice to compete with the poles.
 */
const NEUTRAL_DEPTH = 0.35

/**
 * The dark neutral both value maps paint at zero.
 *
 * Derived, not picked: the two poles are opposite points of the same hue wheel,
 * so their midpoint is the wheel's own achromatic centre -- and exactly
 * achromatic in floating point, because the two poles are the same pair of
 * doubles permuted between channels and addition commutes. Scaling a gray by a
 * scalar leaves it gray, so R === G === B holds exactly here, which is what
 * lets the diverging map be hue-antisymmetric about this point rather than
 * approximately so.
 */
const NEUTRAL: Rgb = mix([0, 0, 0], mix(POSITIVE_POLE, NEGATIVE_POLE, 0.5), NEUTRAL_DEPTH)

/** The colour of "no signal": zero amplitude, and any value a map cannot place. */
export const SLICE_NEUTRAL_RGB: Readonly<Rgb> = NEUTRAL

/**
 * Where the sequential ramp's chroma peaks, as a fraction of its range.
 *
 * A single-hue ramp carries its hue identity in the middle: at the bottom it is
 * near-neutral by construction and at the top it is tinted toward white, so
 * both ends are low-chroma and the fully saturated step belongs between them.
 */
const SEQUENTIAL_KNEE = 0.5

/**
 * The wheel's blue -- the same hue `phaseToRgb(4 * Math.PI / 3)` shows.
 *
 * Built by rotating the positive pole's channels two places rather than by
 * calling the wheel again: `[hi, lo, lo] -> [lo, lo, hi]` is a +2/3-turn hue
 * rotation on the RGB cube, so this carries the wheel's exact saturation and
 * value doubles with no rounding of its own (the spec pins it against
 * `phaseToRgb(4 * Math.PI / 3)`). Blue is the reference palette's default
 * sequential hue; on this wheel it is one third of a turn from each diverging
 * pole, so a density slice cannot be misread as a signed one.
 */
const SEQUENTIAL_MID: Rgb = [POSITIVE_POLE[1], POSITIVE_POLE[2], POSITIVE_POLE[0]]

/** How far the bright end is tinted toward white. */
const SEQUENTIAL_TINT = 0.55

/**
 * The bright end: that same blue, tinted toward white.
 *
 * The tint is what gives the ramp its dynamic range on a near-black scene --
 * the fully saturated step alone tops out at 3.3:1 against the background, the
 * tinted one at 9.5:1, so a density peak reads at a glance. Tinting
 * moves lightness and chroma only; the hue is unchanged, because red and green
 * are shifted by the same expression and stay equal.
 */
const SEQUENTIAL_TOP: Rgb = mix(SEQUENTIAL_MID, [1, 1, 1], SEQUENTIAL_TINT)

/**
 * `t` clamped into `[low, high]`, with a non-finite `t` sent to 0.
 *
 * Clamped rather than extrapolated: a caller normalising by a stale maximum
 * hands over `1 + eps`, and extrapolating past a pole leaves the unit range,
 * where three.js clips per channel and the clipped colour is a different hue.
 * Non-finite goes to 0, i.e. the neutral: a value the map cannot place is
 * painted as "no signal" rather than uploaded to the texture as NaN.
 */
function clampToRange(t: number, low: number, high: number): number {
  return Number.isFinite(t) ? Math.min(Math.max(t, low), high) : 0
}

/**
 * The diverging map for a signed field, `t` in [-1, 1].
 *
 * Zero-centred on the dark neutral, with the phase wheel's phase-0 colour at +1
 * and its phase-pi colour at -1 -- bit-identical, so the sign convention a
 * reader learns from a phase-coloured orbital transfers unchanged. Continuous
 * at zero (both arms leave the same point) and hue-antisymmetric: the two arms
 * depart from the gray axis by equal amounts in exactly opposite directions,
 * because the poles are complementary about that axis and both arms scale
 * linearly with |t|.
 */
export function divergingRgb(t: number): Rgb {
  const clamped = clampToRange(t, -1, 1)
  return clamped >= 0
    ? mix(NEUTRAL, POSITIVE_POLE, clamped)
    : mix(NEUTRAL, NEGATIVE_POLE, -clamped)
}

/**
 * The sequential map for an unsigned field, `t` in [0, 1].
 *
 * One hue, from the dark neutral at 0 through the wheel's blue at the knee to a
 * bright tint of it at 1. Every channel is non-decreasing along both segments,
 * and the sRGB transfer function is strictly increasing per channel, so
 * relative luminance rises strictly across the whole range -- which is the only
 * perceptual claim this ramp makes.
 */
export function sequentialRgb(t: number): Rgb {
  const clamped = clampToRange(t, 0, 1)
  return clamped <= SEQUENTIAL_KNEE
    ? mix(NEUTRAL, SEQUENTIAL_MID, clamped / SEQUENTIAL_KNEE)
    : mix(SEQUENTIAL_MID, SEQUENTIAL_TOP, (clamped - SEQUENTIAL_KNEE) / (1 - SEQUENTIAL_KNEE))
}
