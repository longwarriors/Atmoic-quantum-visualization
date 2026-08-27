import { describe, expect, it } from 'vitest'

import { phaseToRgb } from './color'
import { SLICE_NEUTRAL_RGB, divergingRgb, phaseRgb, sequentialRgb } from './sliceColor'

/**
 * WCAG relative luminance, reimplemented here on purpose.
 *
 * sliceColor.ts exports no luminance function, so this spec cannot be checking
 * the ramp against the very formula the ramp was built from -- the ramp is
 * built from control points and this is the independent measurement of what
 * those control points do. The sRGB transfer function is strictly increasing
 * per channel, so a ramp whose channels never decrease has a strictly
 * increasing luminance; that implication is what the monotonicity case below
 * measures rather than assumes.
 */
const linearize = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

const relativeLuminance = (rgb: readonly [number, number, number]): number =>
  0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])

/**
 * The departure from the achromatic (gray) axis: what a colour says about hue,
 * with lightness divided out. Zero exactly when R === G === B.
 */
const chroma = (rgb: readonly [number, number, number]): [number, number, number] => {
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3
  return [rgb[0] - mean, rgb[1] - mean, rgb[2] - mean]
}

const chromaMagnitude = (rgb: readonly [number, number, number]): number =>
  Math.hypot(...chroma(rgb))

/** A fine grid: 1001 samples, so the midpoint and both endpoints are exact. */
const SAMPLES = 1001
const grid = (low: number, high: number): number[] =>
  Array.from({ length: SAMPLES }, (_, index) => low + ((high - low) * index) / (SAMPLES - 1))

/** One 8-bit step: the smallest difference the framebuffer can represent. */
const ONE_CHANNEL_STEP = 1 / 255

describe('phaseRgb', () => {
  it('is phaseToRgb itself, so the wheel has exactly one definition', () => {
    // The slice renderer must not fork the phase wheel. If this ever becomes a
    // re-implementation, the two representations drift apart channel by channel
    // and no endpoint identity below can hold.
    expect(phaseRgb).toBe(phaseToRgb)
  })

  it('stays periodic over a full turn', () => {
    for (const phase of [-2.4, -0.3, 0, 0.7, 2.9]) {
      const base = phaseRgb(phase)
      const wrapped = phaseRgb(phase + 2 * Math.PI)
      base.forEach((channel, index) => expect(channel).toBeCloseTo(wrapped[index], 12))
    }
  })
})

describe('divergingRgb', () => {
  it('lands bit-identically on the phase wheel at +1', () => {
    // Not "close to": one colour language across representations means the
    // positive pole of a signed slice is the SAME double triple the phase wheel
    // paints at phase 0, so a legend drawn from either map matches the other.
    const pole = divergingRgb(1)
    const wheel = phaseToRgb(0)
    expect(pole[0]).toBe(wheel[0])
    expect(pole[1]).toBe(wheel[1])
    expect(pole[2]).toBe(wheel[2])
  })

  it('lands bit-identically on the phase wheel at -1', () => {
    const pole = divergingRgb(-1)
    const wheel = phaseToRgb(Math.PI)
    expect(pole[0]).toBe(wheel[0])
    expect(pole[1]).toBe(wheel[1])
    expect(pole[2]).toBe(wheel[2])
  })

  it('separates the two poles, so +A and -A never render alike', () => {
    const positive = divergingRgb(1)
    const negative = divergingRgb(-1)
    const distance = positive.reduce(
      (total, channel, index) => total + Math.abs(channel - negative[index]),
      0,
    )
    expect(distance).toBeGreaterThan(0.3)
  })

  it('is continuous at zero: the left and right limits agree within one channel step', () => {
    // A diverging map with a seam at the baseline draws a hard edge along every
    // nodal surface -- exactly where a signed slice is most interesting, and
    // exactly where a rendering artefact reads as physics.
    const left = divergingRgb(-1e-6)
    const right = divergingRgb(1e-6)
    const centre = divergingRgb(0)
    for (let index = 0; index < 3; index += 1) {
      expect(Math.abs(left[index] - right[index])).toBeLessThan(ONE_CHANNEL_STEP)
      expect(Math.abs(left[index] - centre[index])).toBeLessThan(ONE_CHANNEL_STEP)
      expect(Math.abs(right[index] - centre[index])).toBeLessThan(ONE_CHANNEL_STEP)
    }
  })

  it('paints zero as an exactly achromatic dark neutral', () => {
    const centre = divergingRgb(0)
    // Exactly achromatic, not nearly: the hue-antisymmetry below is a statement
    // about departures from THIS point, and it is only meaningful if the point
    // itself sits on the gray axis.
    expect(centre[0]).toBe(centre[1])
    expect(centre[1]).toBe(centre[2])
    expect(chromaMagnitude(centre)).toBe(0)
    // Dark: the scene renders on #050a13, and a bright midpoint would make the
    // baseline of a signed slice the loudest thing on screen.
    expect(centre[0]).toBeGreaterThan(0)
    expect(centre[0]).toBeLessThan(0.3)
    expect(centre).toEqual([...SLICE_NEUTRAL_RGB])
  })

  it('is hue-antisymmetric: the chromatic departure at -t negates the one at +t', () => {
    for (const t of grid(0, 1)) {
      const positive = chroma(divergingRgb(t))
      const negative = chroma(divergingRgb(-t))
      for (let index = 0; index < 3; index += 1) {
        expect(negative[index]).toBeCloseTo(-positive[index], 12)
      }
    }
  })

  it('has a chromatic departure to be antisymmetric about', () => {
    // Without this the case above passes vacuously on any map that is gray
    // everywhere: -0 is 0.
    for (const t of [0.25, 0.5, 0.75, 1]) {
      expect(chromaMagnitude(divergingRgb(t))).toBeGreaterThan(0.05)
      expect(chromaMagnitude(divergingRgb(-t))).toBeGreaterThan(0.05)
    }
  })

  it('keeps every channel inside the unit range', () => {
    for (const t of grid(-1, 1)) {
      for (const channel of divergingRgb(t)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('clamps t outside [-1, 1] onto the poles instead of extrapolating past them', () => {
    // A caller normalising by a stale maximum hands over 1 + eps; extrapolation
    // there leaves the unit range and three.js clips it to a different hue.
    expect(divergingRgb(4)).toEqual(divergingRgb(1))
    expect(divergingRgb(-4)).toEqual(divergingRgb(-1))
  })
})

describe('sequentialRgb', () => {
  it('starts at the same dark neutral every map paints at zero', () => {
    // A=0 is the shared floor of all three maps: at zero amplitude the phase is
    // undefined, so a phase slice has nothing to say there either and the caller
    // fades to this neutral. Zero must therefore look the same in every
    // representation, or switching maps moves the vacuum.
    expect(sequentialRgb(0)).toEqual(divergingRgb(0))
    expect(sequentialRgb(0)).toEqual([...SLICE_NEUTRAL_RGB])
  })

  it('increases relative luminance strictly over a fine grid', () => {
    // The claim this map makes is monotone LUMINANCE -- not perceptual
    // uniformity, which nothing here measures and nothing here should assert.
    let previous = -Infinity
    for (const t of grid(0, 1)) {
      const luminance = relativeLuminance(sequentialRgb(t))
      expect(luminance).toBeGreaterThan(previous)
      previous = luminance
    }
  })

  it('spans a real luminance range, so the monotonicity above is not a hairline', () => {
    expect(relativeLuminance(sequentialRgb(1))).toBeGreaterThan(
      relativeLuminance(sequentialRgb(0)) + 0.4,
    )
  })

  it('holds a single hue: red and green track each other exactly at every t', () => {
    // One hue means the two off-hue channels stay locked together; the third
    // carries the magnitude. Exact equality, because both are computed from the
    // same control-point channels by the same expression -- an "almost equal"
    // here would mean the ramp had picked up a second hue somewhere.
    for (const t of grid(0, 1)) {
      const [red, green, blue] = sequentialRgb(t)
      expect(red).toBe(green)
      expect(blue).toBeGreaterThanOrEqual(red)
    }
  })

  it('takes its hue from the phase wheel rather than a new colour', () => {
    // The chroma peak of the ramp is the wheel's own blue (phase 4pi/3), so the
    // slice renderer introduces no colour the rest of the app does not already
    // use.
    const wheelBlue = phaseToRgb((4 * Math.PI) / 3)
    const peak = sequentialRgb(0.5)
    for (let index = 0; index < 3; index += 1) {
      expect(peak[index]).toBeCloseTo(wheelBlue[index], 9)
    }
  })

  it('keeps every channel inside the unit range', () => {
    for (const t of grid(0, 1)) {
      for (const channel of sequentialRgb(t)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('clamps t outside [0, 1] onto the ends', () => {
    expect(sequentialRgb(3)).toEqual(sequentialRgb(1))
    expect(sequentialRgb(-3)).toEqual(sequentialRgb(0))
  })
})

describe('non-finite input', () => {
  it('paints a value it cannot place as the neutral rather than NaN', () => {
    // Masked slice entries read as null through sliceValueAt and never reach a
    // colour map; a NaN that slips through anyway (a 0/0 normalisation over an
    // all-masked row) would otherwise be uploaded into the texture and rendered
    // as whatever the driver makes of NaN.
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(divergingRgb(bad)).toEqual([...SLICE_NEUTRAL_RGB])
      expect(sequentialRgb(bad)).toEqual([...SLICE_NEUTRAL_RGB])
    }
  })
})
