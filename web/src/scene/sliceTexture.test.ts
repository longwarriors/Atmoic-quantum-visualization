/**
 * `src/scene/sliceTexture.ts`: the bytes a slice plane uploads, and where in
 * space those bytes sit.
 *
 * Every payload below is SYNTHETIC and every one of them is ASYMMETRIC under
 * `row <-> col`. That is the whole point of this file. The committed golden
 * (`tests/fixtures/slice_golden.json`) is the 1s phase section: every sample is
 * `0.0`, so it is invariant under transposition and a texeliser that swapped
 * row and col would reproduce it byte for byte. So would any state whose slice
 * happens to be symmetric -- which, on the principal planes, is most of the
 * interesting ones. A ramp that differs at `(row, col)` and `(col, row)` is the
 * only fixture that can tell the two apart, so the ramp is what pins
 * `4 * (row * resolution + col)` here.
 *
 * The payloads are built as raw records and pushed through `parseSlicePayload`
 * rather than cast into shape: a fixture that could not survive the contract is
 * a fixture that proves nothing about the renderer, because no such payload can
 * reach the renderer. Where a case needs the impossible (a masked sample
 * carrying something other than `0.0`) it moves `masked_value_sentinel` with
 * it, which the contract permits and which makes "did you read this through
 * `sliceValueAt`?" an observable question instead of a stylistic one.
 */
import { describe, expect, it } from 'vitest'

import { parseSlicePayload } from '../api/sliceContract'
import type { AnySlicePayload } from '../api/sliceContract'
import { SLICE_NEUTRAL_RGB, divergingRgb, phaseRgb, sequentialRgb } from './sliceColor'
import { sliceMaxAbs, slicePlaneSize, sliceSamplePosition, sliceTexels } from './sliceTexture'

/** Odd, and at the contract's minimum: the smallest legal grid. */
const RESOLUTION = 65
const EXTENT_BOHR = 3.2
const SPACING_BOHR = (2 * EXTENT_BOHR) / (RESOLUTION - 1)
/** The sample index the origin sits on -- integral because the count is odd. */
const CENTRE = (RESOLUTION - 1) / 2

type Mutable = Record<string, unknown>

/**
 * Row-major with `col` fastest, spelled out here as this file's own
 * restatement of the layout. If this and the module ever transpose together
 * the ramp cases below stop meaning anything, which is why the index
 * `4 * (row * RESOLUTION + col)` is also written out literally in the case
 * that matters rather than only flowing through `texelAt`.
 */
function samples(fill: (row: number, col: number) => number): number[] {
  const values: number[] = []
  for (let row = 0; row < RESOLUTION; row += 1) {
    for (let col = 0; col < RESOLUTION; col += 1) {
      values.push(fill(row, col))
    }
  }
  return values
}

/**
 * The asymmetric ramp: `col - 2 * row`.
 *
 * Not symmetric, not antisymmetric, and not merely off-centre -- `f(r, c)` and
 * `f(c, r)` differ in magnitude AND generally in sign, so a transposed
 * texeliser lands on a visibly different colour rather than on the mirror of
 * the right one. Its extremes are `-2 * (RESOLUTION - 1)` at the bottom-left
 * and `+(RESOLUTION - 1)` at the top-right, so `max|value|` is
 * `2 * (RESOLUTION - 1)` and it is reached at exactly one sample.
 */
const ramp = (row: number, col: number): number => col - 2 * row
const RAMP_MAX_ABS = 2 * (RESOLUTION - 1)

/** The `xz` frame: `u = +x`, `v = +z`, and the normal is `-y`, not `+y`. */
function framedPayload(observable: string, values: number[], maxAmplitude: number): Mutable {
  return {
    layout: 'row_major_v_rows_u_columns',
    plane: 'xz',
    slice_observable: observable,
    resolution: RESOLUTION,
    extent_bohr: EXTENT_BOHR,
    spacing_bohr: SPACING_BOHR,
    origin_bohr: [0, 0, 0],
    u_axis: [1, 0, 0],
    v_axis: [0, 0, 1],
    normal: [0, -1, 0],
    length_unit: 'bohr',
    value_unit: 'bohr^-3/2',
    masked_value_sentinel: 0,
    max_amplitude_on_plane: maxAmplitude,
    metadata: { state: { n: 2, l: 1, m: 0, label: '2p_z' } },
    values,
    valid_mask: null,
    phase_mask_relative_amplitude: null,
    phase_mask_amplitude_scale: null,
    phase_mask_amplitude_threshold: null,
    phase_mask_numeric_floor: null,
    phase_masked_fraction: null,
  }
}

/**
 * A non-phase slice: no mask, and `max_amplitude_on_plane` supplied by the
 * caller because it is `max|psi|` and has no fixed relation to `max|value|`
 * for a signed component.
 */
function valuePayload(
  observable: string,
  values: number[],
  maxAmplitude: number,
): AnySlicePayload {
  return parseSlicePayload(framedPayload(observable, values, maxAmplitude))
}

/**
 * A phase slice, optionally with some samples masked.
 *
 * `sentinel` moves `masked_value_sentinel` along with the masked samples. The
 * server always sends `0.0`; a test that used `0.0` could not distinguish
 * "read the mask" from "read a value that happens to be zero", and a sentinel
 * of `9.0` -- outside `[-pi, pi]`, so unmistakably not a phase -- makes a
 * direct `values[k]` read produce a wrong ANSWER rather than a wrong style.
 */
function phasePayload(
  fill: (row: number, col: number) => number,
  maskedIndices: readonly number[] = [],
  sentinel = 0,
): AnySlicePayload {
  const values = samples(fill)
  const mask = values.map(() => true)
  for (const index of maskedIndices) {
    mask[index] = false
    values[index] = sentinel
  }
  const payload = framedPayload('phase', values, 0.31)
  payload.value_unit = 'rad'
  payload.masked_value_sentinel = sentinel
  payload.valid_mask = mask
  payload.phase_mask_relative_amplitude = 0.02
  payload.phase_mask_amplitude_scale = 0.31
  payload.phase_mask_amplitude_threshold = 0.0062
  payload.phase_mask_numeric_floor = 1e-12
  payload.phase_masked_fraction = maskedIndices.length / values.length
  return parseSlicePayload(payload)
}

/** A phase ramp that stays inside `[-pi, pi]` and is asymmetric in row/col. */
const phaseRamp = (row: number, col: number): number =>
  (Math.PI * (col - 2 * row)) / RAMP_MAX_ABS

/** The module's quantisation, restated: 8 bits per channel, round to nearest. */
const toBytes = (rgb: readonly [number, number, number]): [number, number, number] => [
  Math.round(rgb[0] * 255),
  Math.round(rgb[1] * 255),
  Math.round(rgb[2] * 255),
]

const texelAt = (texels: Uint8ClampedArray, row: number, col: number): number[] =>
  Array.from(texels.slice(4 * (row * RESOLUTION + col), 4 * (row * RESOLUTION + col) + 4))

/** One 8-bit step: the tolerance the phase wheel is held to. */
const ONE_CHANNEL_STEP = 1 / 255

describe('sliceMaxAbs', () => {
  it('recomputes max|value| over the slice, not over psi', () => {
    // `max_amplitude_on_plane` is deliberately five times the ramp's own
    // extreme here, which is exactly the relation a real signed component has
    // to |psi|: |Re psi| <= |psi| everywhere, with equality only where the
    // imaginary part vanishes. A normaliser that reached for the payload field
    // would report 5x too large and under-saturate the whole slice.
    const payload = valuePayload('wavefunction_real', samples(ramp), 5 * RAMP_MAX_ABS)
    expect(sliceMaxAbs(payload)).toBe(RAMP_MAX_ABS)
    expect(payload.max_amplitude_on_plane).toBe(5 * RAMP_MAX_ABS)
  })

  it('is zero for an all-zero slice, so the caller can see the degenerate case', () => {
    expect(sliceMaxAbs(valuePayload('wavefunction_imag', samples(() => 0), 0))).toBe(0)
  })

  it('skips masked samples instead of reading their sentinel', () => {
    // The sentinel is 9.0 and every unmasked phase is at most pi < 9.0, so a
    // scan over `values[]` returns 9 and a scan through `sliceValueAt` returns
    // the true extreme. Nothing else in this test distinguishes the two.
    const masked = [0, 7, 4211]
    const payload = phasePayload(phaseRamp, masked, 9)
    expect(sliceMaxAbs(payload)).toBeLessThanOrEqual(Math.PI)
    expect(sliceMaxAbs(payload)).toBeCloseTo(Math.PI, 12)
  })

  it('is zero when every sample is masked', () => {
    const all = Array.from({ length: RESOLUTION * RESOLUTION }, (_, index) => index)
    expect(sliceMaxAbs(phasePayload(phaseRamp, all, 9))).toBe(0)
  })
})

describe('sliceTexels (layout)', () => {
  it('fills RGBA8 for every sample', () => {
    const texels = sliceTexels(valuePayload('wavefunction_real', samples(ramp), RAMP_MAX_ABS))
    expect(texels).toBeInstanceOf(Uint8ClampedArray)
    expect(texels.length).toBe(4 * RESOLUTION * RESOLUTION)
  })

  it('writes sample (row, col) at byte 4 * (row * resolution + col)', () => {
    // THE transposition case. Both probes are picked so that the ramp's value
    // at (row, col) and at (col, row) differ in sign as well as magnitude:
    // a transposed texeliser cannot land on these bytes by accident, and a
    // symmetric fixture could not have caught it at all.
    const payload = valuePayload('wavefunction_real', samples(ramp), RAMP_MAX_ABS)
    const texels = sliceTexels(payload)
    for (const [row, col] of [
      [2, 60],
      [60, 2],
      [0, RESOLUTION - 1],
      [RESOLUTION - 1, 0],
    ]) {
      const base = 4 * (row * RESOLUTION + col)
      const expected = toBytes(divergingRgb(ramp(row, col) / RAMP_MAX_ABS))
      expect(
        [texels[base], texels[base + 1], texels[base + 2]],
        `texel at row ${row}, col ${col}`,
      ).toEqual(expected)
      expect(texels[base + 3]).toBe(255)
      // And the transposed sample is genuinely a different colour, so the
      // assertion above is discriminating rather than accidentally satisfied.
      expect(expected).not.toEqual(toBytes(divergingRgb(ramp(col, row) / RAMP_MAX_ABS)))
    }
  })

  it('refuses an observable it has no colour map for', () => {
    // Unreachable through `parseSlicePayload`, which is the point: if a fifth
    // observable is ever added to the contract, this module must be told about
    // it rather than quietly painting it as a signed field.
    const payload = valuePayload('wavefunction_real', samples(ramp), RAMP_MAX_ABS)
    const forged = { ...payload, slice_observable: 'gradient_norm' } as unknown as AnySlicePayload
    expect(() => sliceTexels(forged)).toThrow(/gradient_norm/)
  })
})

describe('sliceTexels (alpha)', () => {
  it('makes a masked texel fully transparent AND black', () => {
    // Alpha 0 alone is not enough: an RGBA texture whose transparent texels
    // carry a colour bleeds that colour under any filtering or premultiply, so
    // the masked region would tint its neighbours with a phase that is
    // undefined there. Zero the colour too.
    const masked = [0, 7, 4211]
    const texels = sliceTexels(phasePayload(phaseRamp, masked, 9))
    for (const index of masked) {
      expect(Array.from(texels.slice(4 * index, 4 * index + 4)), `texel ${index}`).toEqual([
        0, 0, 0, 0,
      ])
    }
    // A neighbour of a masked sample is untouched: the mask is per-sample.
    const neighbour = texelAt(texels, 0, 1)
    expect(neighbour[3]).toBe(255)
    expect(neighbour.slice(0, 3)).toEqual(toBytes(phaseRgb(phaseRamp(0, 1))))
  })

  it('keeps a vanishingly small amplitude opaque', () => {
    // Transparency means NO DATA. A sample that is merely a billionth of the
    // slice's peak is data -- it is the node region, which is the physically
    // interesting part of a p or d orbital -- and fading it out would make a
    // node indistinguishable from an unresolved phase.
    const values = samples(ramp)
    values[3 * RESOLUTION + 9] = RAMP_MAX_ABS * 1e-9
    const texels = sliceTexels(valuePayload('wavefunction_imag', values, RAMP_MAX_ABS))
    const texel = texelAt(texels, 3, 9)
    expect(texel[3]).toBe(255)
    expect(texel.slice(0, 3)).toEqual(toBytes(SLICE_NEUTRAL_RGB))
  })
})

describe('sliceTexels (signed observables)', () => {
  it('normalises by the slice extreme, so the peak reaches the diverging pole', () => {
    // `max_amplitude_on_plane` is 5x the ramp's extreme here. Normalising by it
    // would put the peak at t = 0.2 -- a fifth of the way out of the neutral --
    // and every real and imaginary slice in the app would render washed out
    // with no error anywhere.
    const payload = valuePayload('wavefunction_real', samples(ramp), 5 * RAMP_MAX_ABS)
    const texels = sliceTexels(payload)
    const peak = texelAt(texels, RESOLUTION - 1, 0)
    expect(peak.slice(0, 3)).toEqual(toBytes(divergingRgb(-1)))
    expect(peak.slice(0, 3)).not.toEqual(toBytes(divergingRgb(-0.2)))
  })

  it('paints a uniform neutral when the slice is identically zero', () => {
    // A = 0: every ratio is 0/0. The map has nothing to say about direction,
    // so it must say "no signal" everywhere rather than emit NaN bytes.
    const texels = sliceTexels(valuePayload('wavefunction_imag', samples(() => 0), 0))
    const neutral = toBytes(SLICE_NEUTRAL_RGB)
    for (let index = 0; index < RESOLUTION * RESOLUTION; index += 1) {
      expect(Array.from(texels.slice(4 * index, 4 * index + 4)), `texel ${index}`).toEqual([
        ...neutral,
        255,
      ])
    }
  })

  it('colours the imaginary part with the same map as the real part', () => {
    const values = samples(ramp)
    const real = sliceTexels(valuePayload('wavefunction_real', values, RAMP_MAX_ABS))
    const imag = sliceTexels(valuePayload('wavefunction_imag', values, RAMP_MAX_ABS))
    expect(Array.from(imag)).toEqual(Array.from(real))
  })
})

describe('sliceTexels (phase)', () => {
  it('quantises the phase wheel to within one 8-bit step', () => {
    const texels = sliceTexels(phasePayload(phaseRamp))
    for (const [row, col] of [
      [0, 0],
      [2, 60],
      [60, 2],
      [CENTRE, CENTRE],
      [RESOLUTION - 1, RESOLUTION - 1],
    ]) {
      const wheel = phaseRgb(phaseRamp(row, col))
      const texel = texelAt(texels, row, col)
      wheel.forEach((channel, index) => {
        expect(
          Math.abs(texel[index] / 255 - channel),
          `channel ${index} at row ${row}, col ${col}`,
        ).toBeLessThanOrEqual(ONE_CHANNEL_STEP)
      })
      expect(texel[3]).toBe(255)
    }
  })

  it('does not renormalise a phase, which is already an absolute angle', () => {
    // A phase of pi/2 is pi/2 whatever else is on the plane. Dividing by the
    // slice's own extreme -- as the signed maps must -- would make the same
    // physical phase render differently depending on its neighbours.
    const quarter = sliceTexels(phasePayload(() => Math.PI / 2))
    expect(texelAt(quarter, 4, 11).slice(0, 3)).toEqual(toBytes(phaseRgb(Math.PI / 2)))
  })
})

describe('sliceTexels (probability density)', () => {
  const density = (row: number, col: number): number => (col - 2 * row + 2 * RESOLUTION) ** 2

  it('maps sqrt(rho / rho_max), because that is |psi| / max|psi|', () => {
    const values = samples(density)
    const rhoMax = Math.max(...values)
    const payload = valuePayload('probability_density', values, Math.sqrt(rhoMax))
    const texels = sliceTexels(payload)
    for (const [row, col] of [
      [1, 5],
      [40, 3],
      [RESOLUTION - 1, RESOLUTION - 1],
    ]) {
      const rho = density(row, col)
      expect(texelAt(texels, row, col).slice(0, 3), `row ${row}, col ${col}`).toEqual(
        toBytes(sequentialRgb(Math.sqrt(rho / rhoMax))),
      )
    }
  })

  it('is not the linear ramp: a quarter of the peak density is half brightness', () => {
    // The sqrt is physics, not aesthetics. rho = |psi|^2, so a region holding a
    // quarter of the peak density holds HALF the peak amplitude, and a linear
    // map would draw the |psi| = 0.5 contour at a quarter of the ramp.
    const values = samples(() => 4)
    values[6 * RESOLUTION + 2] = 1
    const payload = valuePayload('probability_density', values, 2)
    const texel = texelAt(sliceTexels(payload), 6, 2)
    expect(texel.slice(0, 3)).toEqual(toBytes(sequentialRgb(0.5)))
    expect(texel.slice(0, 3)).not.toEqual(toBytes(sequentialRgb(0.25)))
    expect(texel[3]).toBe(255)
  })

  it('paints a uniform neutral when the density is identically zero', () => {
    const texels = sliceTexels(valuePayload('probability_density', samples(() => 0), 0))
    expect(texelAt(texels, 8, 13)).toEqual([...toBytes(SLICE_NEUTRAL_RGB), 255])
  })
})

describe('slicePlaneSize', () => {
  it('is resolution * spacing, one whole spacing wider than the sampled span', () => {
    // The half-texel trap. The sampled NODES span [-extent, extent], i.e.
    // (resolution - 1) * spacing. A texture's texels are cells whose CENTRES
    // must land on those nodes, so the plane carries half a spacing of margin
    // beyond each end sample: (resolution - 1 + 1/2 + 1/2) * spacing. Sizing
    // the mesh to 2 * extent instead shrinks the whole picture by one texel and
    // shifts every feature inward by half of one -- invisible on a smooth
    // density, and a systematic error in every node radius read off the plane.
    const payload = valuePayload('wavefunction_real', samples(ramp), RAMP_MAX_ABS)
    expect(slicePlaneSize(payload)).toBe(RESOLUTION * SPACING_BOHR)
    expect(slicePlaneSize(payload)).toBeCloseTo(2 * EXTENT_BOHR + SPACING_BOHR, 12)
    expect(slicePlaneSize(payload)).toBeGreaterThan(2 * EXTENT_BOHR)
  })
})

describe('sliceSamplePosition', () => {
  const payload = valuePayload('wavefunction_real', samples(ramp), RAMP_MAX_ABS)

  it('puts the centre sample on the origin', () => {
    expect(sliceSamplePosition(payload, CENTRE, CENTRE)).toEqual([0, 0, 0])
  })

  it('round-trips the payload frame: origin + u * u_offset + v * v_offset', () => {
    // On xz, u is +x and v is +z, so col moves x and row moves z. Swapping them
    // is a transposition of the geometry that no symmetric slice could reveal
    // -- the two probes below are mirror images of each other.
    const near = sliceSamplePosition(payload, 3, 61)
    expect(near[0]).toBeCloseTo((61 - CENTRE) * SPACING_BOHR, 12)
    expect(near[1]).toBe(0)
    expect(near[2]).toBeCloseTo((3 - CENTRE) * SPACING_BOHR, 12)

    const swapped = sliceSamplePosition(payload, 61, 3)
    expect(swapped[0]).toBeCloseTo(near[2], 12)
    expect(swapped[2]).toBeCloseTo(near[0], 12)
    expect(swapped).not.toEqual(near)
  })

  it('places the end samples exactly on +/- extent', () => {
    // The other half of the half-texel statement: the NODES reach the extent,
    // and slicePlaneSize is what adds the margin around them.
    expect(sliceSamplePosition(payload, 0, 0)).toEqual([-EXTENT_BOHR, 0, -EXTENT_BOHR])
    expect(sliceSamplePosition(payload, RESOLUTION - 1, RESOLUTION - 1)).toEqual([
      EXTENT_BOHR,
      0,
      EXTENT_BOHR,
    ])
  })

  it('follows a different plane frame rather than assuming xz', () => {
    const xy = framedPayload('wavefunction_real', samples(ramp), RAMP_MAX_ABS)
    xy.plane = 'xy'
    xy.u_axis = [1, 0, 0]
    xy.v_axis = [0, 1, 0]
    xy.normal = [0, 0, 1]
    const parsed = parseSlicePayload(xy)
    expect(sliceSamplePosition(parsed, 0, RESOLUTION - 1)).toEqual([
      EXTENT_BOHR,
      -EXTENT_BOHR,
      0,
    ])
  })

  it('rejects an index off the grid rather than reading past the samples', () => {
    expect(() => sliceSamplePosition(payload, RESOLUTION, 0)).toThrow(/row/)
    expect(() => sliceSamplePosition(payload, 0, -1)).toThrow(/col/)
  })
})
