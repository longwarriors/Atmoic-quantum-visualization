/**
 * `src/api/sliceContract.ts` against the committed slice payload.
 *
 * The fixture is `tests/fixtures/slice_golden.json`, written by
 * `scripts/write_slice_golden.py` and rebuilt byte for byte by
 * `tests/test_slice_contract.py`, so the same bytes the Python suite pins are
 * the bytes the browser-side validator is held to. The golden is the 1s phase
 * section of the `xy` plane at `resolution=65`: every sample is unmasked and
 * every phase is `0.0`, which is what makes it a *positive* control and
 * nothing more. Every rejection below is therefore a MUTATION of that golden --
 * one field at a time, so each case names exactly the rule it is about, and so
 * a rule that stops firing cannot hide behind a payload that was malformed in
 * three other ways as well.
 *
 * The case that matters most is `ignores the mask` further down: a masked
 * sample carries the finite sentinel `0.0`, and `0.0` is a perfectly good
 * phase -- it reads as "positive real". A client that ignores `valid_mask`
 * therefore does not fail, it silently draws phase-undefined cancellation
 * residue as a definite colour. That is why `sliceValueAt` is the only
 * row-major accessor this module exposes and why it returns `null` rather than
 * the sentinel, and why a masked sample whose value is NOT the sentinel is a
 * contract violation rather than a curiosity: it is the one shape in which the
 * server could hand a mask-ignoring client something worse than a placeholder.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MAXIMUM_SLICE_RESOLUTION,
  MINIMUM_SLICE_RESOLUTION,
  SLICE_LAYOUT,
  SliceContractError,
  parseSlicePayload,
  sliceMaskedFraction,
  sliceValueAt,
} from './sliceContract'

const goldenUrl = new URL('../../../tests/fixtures/slice_golden.json', import.meta.url)

/** Read once, re-parsed per case: every case mutates, none may see another's edit. */
const GOLDEN_TEXT = readFileSync(fileURLToPath(goldenUrl), 'utf-8')

type Mutable = Record<string, unknown>

function freshGolden(): Mutable {
  return JSON.parse(GOLDEN_TEXT) as Mutable
}

function numberList(payload: Mutable, field: string): number[] {
  return payload[field] as number[]
}

function maskList(payload: Mutable): boolean[] {
  return payload.valid_mask as boolean[]
}

function resolutionOf(payload: Mutable): number {
  return payload.resolution as number
}

/**
 * The golden with sample `index` masked: the mask flag cleared, the value left
 * at the sentinel, and the reported fraction updated to match. This is a
 * *valid* payload -- the shape the mask rule exists to describe, which the
 * all-`true` golden cannot exercise on its own.
 */
function goldenWithMaskedSample(index: number): Mutable {
  const payload = freshGolden()
  maskList(payload)[index] = false
  numberList(payload, 'values')[index] = payload.masked_value_sentinel as number
  payload.phase_masked_fraction = 1 / resolutionOf(payload) ** 2
  return payload
}

/**
 * The golden as a non-phase slice: no mask, and no threshold report either.
 * Only `phase` carries those, so this is the other half of the mask rule.
 */
function goldenAsDensitySlice(): Mutable {
  const payload = freshGolden()
  payload.slice_observable = 'probability_density'
  payload.value_unit = 'bohr^-3'
  payload.valid_mask = null
  payload.phase_mask_relative_amplitude = null
  payload.phase_mask_amplitude_scale = null
  payload.phase_mask_amplitude_threshold = null
  payload.phase_mask_numeric_floor = null
  payload.phase_masked_fraction = null
  return payload
}

/**
 * Mutate a fresh golden, parse it, and require a `SliceContractError` naming
 * `field`. Asserting the field (not merely "it threw") is what keeps these
 * cases honest: several rules guard the same `values` array, and a test that
 * only demanded a throw would go on passing while the rule it names is deleted
 * and a neighbouring one fires instead.
 */
function expectRejection(field: string, detail: string, mutate: (payload: Mutable) => void): void {
  const payload = freshGolden()
  mutate(payload)
  let thrown: unknown
  try {
    parseSlicePayload(payload)
  } catch (error) {
    thrown = error
  }
  expect(thrown, `parseSlicePayload accepted a payload mutated at ${field}`).toBeInstanceOf(
    SliceContractError,
  )
  const error = thrown as SliceContractError
  expect(error.field).toBe(field)
  expect(error.message).toContain(field)
  expect(error.message).toContain(detail)
}

describe('parseSlicePayload (golden)', () => {
  it('accepts the committed golden payload and reports its grid', () => {
    const payload = parseSlicePayload(freshGolden())
    expect(payload.layout).toBe(SLICE_LAYOUT)
    expect(payload.plane).toBe('xy')
    expect(payload.slice_observable).toBe('phase')
    expect(payload.resolution).toBe(MINIMUM_SLICE_RESOLUTION)
    expect(payload.values).toHaveLength(MINIMUM_SLICE_RESOLUTION ** 2)
    expect(payload.origin_bohr).toEqual([0, 0, 0])
    expect(payload.u_axis).toEqual([1, 0, 0])
    expect(payload.v_axis).toEqual([0, 1, 0])
    expect(payload.normal).toEqual([0, 0, 1])
    const expectedSpacing = (2 * payload.extent_bohr) / (payload.resolution - 1)
    expect(payload.spacing_bohr).toBeCloseTo(expectedSpacing, 15)
  })

  it('accepts a payload with a masked sample and a matching reported fraction', () => {
    const payload = parseSlicePayload(goldenWithMaskedSample(17))
    expect(payload.valid_mask?.[17]).toBe(false)
    expect(sliceMaskedFraction(payload)).toBeCloseTo(1 / MINIMUM_SLICE_RESOLUTION ** 2, 15)
  })

  it('accepts a non-phase slice that carries neither mask nor threshold report', () => {
    const payload = parseSlicePayload(goldenAsDensitySlice())
    expect(payload.valid_mask).toBeNull()
    expect(sliceMaskedFraction(payload)).toBe(0)
  })
})

describe('parseSlicePayload (rejections)', () => {
  it('rejects a non-object payload', () => {
    expect(() => parseSlicePayload(null)).toThrow(SliceContractError)
    expect(() => parseSlicePayload([1, 2, 3])).toThrow(SliceContractError)
  })

  it('rejects a payload whose layout is not the row-major one', () => {
    expectRejection('layout', SLICE_LAYOUT, (payload) => {
      payload.layout = 'column_major_u_rows_v_columns'
    })
  })

  it('rejects an unknown plane', () => {
    expectRejection('plane', 'xy', (payload) => {
      payload.plane = 'uv'
    })
  })

  it('rejects an unknown observable', () => {
    expectRejection('slice_observable', 'phase', (payload) => {
      payload.slice_observable = 'probability_current'
    })
  })

  it('rejects an even resolution, which puts no sample on the origin', () => {
    expectRejection('resolution', 'odd', (payload) => {
      payload.resolution = 64
      numberList(payload, 'values').length = 64 ** 2
      maskList(payload).length = 64 ** 2
    })
  })

  it('rejects a resolution below the floor', () => {
    expectRejection('resolution', String(MINIMUM_SLICE_RESOLUTION), (payload) => {
      payload.resolution = 63
    })
  })

  it('rejects a resolution above the cap', () => {
    expectRejection('resolution', String(MAXIMUM_SLICE_RESOLUTION), (payload) => {
      payload.resolution = 515
    })
  })

  it('rejects a non-integer resolution', () => {
    expectRejection('resolution', 'integer', (payload) => {
      payload.resolution = 65.5
    })
  })

  it('rejects a values array whose length is not resolution squared', () => {
    expectRejection('values', String(MINIMUM_SLICE_RESOLUTION ** 2), (payload) => {
      numberList(payload, 'values').pop()
    })
  })

  it('rejects a values array that is not an array', () => {
    expectRejection('values', 'array', (payload) => {
      payload.values = 'row_major'
    })
  })

  it('rejects a non-finite sample, which JSON cannot carry', () => {
    expectRejection('values', 'finite', (payload) => {
      numberList(payload, 'values')[3] = Number.NaN
    })
  })

  it('rejects a sample that is not a number', () => {
    expectRejection('values', 'number', (payload) => {
      numberList(payload, 'values')[3] = '0.0' as unknown as number
    })
  })

  it('rejects a mask on a non-phase slice', () => {
    const payload = goldenAsDensitySlice()
    payload.valid_mask = new Array<boolean>(MINIMUM_SLICE_RESOLUTION ** 2).fill(true)
    let thrown: unknown
    try {
      parseSlicePayload(payload)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SliceContractError)
    expect((thrown as SliceContractError).field).toBe('valid_mask')
    expect((thrown as SliceContractError).message).toContain('phase')
  })

  it('rejects a phase slice with no mask', () => {
    expectRejection('valid_mask', 'phase', (payload) => {
      payload.valid_mask = null
    })
  })

  it('rejects a mask whose length does not match the values', () => {
    expectRejection('valid_mask', String(MINIMUM_SLICE_RESOLUTION ** 2), (payload) => {
      maskList(payload).pop()
    })
  })

  it('rejects a mask entry that is not a boolean', () => {
    expectRejection('valid_mask', 'boolean', (payload) => {
      maskList(payload)[9] = 1 as unknown as boolean
    })
  })

  it('rejects a mask that is not an array', () => {
    expectRejection('valid_mask', 'array', (payload) => {
      payload.valid_mask = 'true'
    })
  })

  it('rejects a phase slice that omits a threshold term', () => {
    expectRejection('phase_mask_amplitude_scale', 'phase', (payload) => {
      payload.phase_mask_amplitude_scale = null
    })
  })

  it('rejects a non-phase slice that still reports a threshold term', () => {
    const payload = goldenAsDensitySlice()
    payload.phase_mask_amplitude_threshold = 1e-6
    let thrown: unknown
    try {
      parseSlicePayload(payload)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SliceContractError)
    expect((thrown as SliceContractError).field).toBe('phase_mask_amplitude_threshold')
  })

  it('ignores the mask at its peril: a masked sample must hold the sentinel', () => {
    // The type-level control. `0.0` is a legal phase, so a masked sample that
    // holds anything else is the one payload shape in which ignoring
    // `valid_mask` renders cancellation residue as a definite colour instead
    // of a definite placeholder. Nothing about the JSON types says so; only
    // this rule does.
    const payload = goldenWithMaskedSample(17)
    numberList(payload, 'values')[17] = 0.75
    let thrown: unknown
    try {
      parseSlicePayload(payload)
    } catch (error) {
      thrown = error
    }
    expect(thrown, 'a masked sample holding 0.75 was accepted').toBeInstanceOf(SliceContractError)
    expect((thrown as SliceContractError).field).toBe('values')
    expect((thrown as SliceContractError).message).toContain('masked_value_sentinel')
    expect((thrown as SliceContractError).message).toContain('17')
  })

  it('rejects a non-finite masked-value sentinel', () => {
    expectRejection('masked_value_sentinel', 'finite', (payload) => {
      payload.masked_value_sentinel = Number.POSITIVE_INFINITY
    })
  })

  it('rejects an unmasked phase outside [-pi, pi]', () => {
    expectRejection('values', 'outside', (payload) => {
      numberList(payload, 'values')[42] = 4
    })
    expectRejection('values', 'outside', (payload) => {
      numberList(payload, 'values')[42] = -4
    })
  })

  it('accepts an unmasked phase at exactly +/-pi', () => {
    const payload = freshGolden()
    numberList(payload, 'values')[42] = Math.PI
    numberList(payload, 'values')[43] = -Math.PI
    expect(parseSlicePayload(payload).values[42]).toBe(Math.PI)
  })

  it('rejects a spacing inconsistent with the extent and resolution', () => {
    expectRejection('spacing_bohr', 'extent_bohr', (payload) => {
      payload.spacing_bohr = (payload.spacing_bohr as number) * 1.001
    })
  })

  it('rejects a non-positive extent', () => {
    expectRejection('extent_bohr', 'positive', (payload) => {
      payload.extent_bohr = 0
    })
  })

  it('rejects a non-positive spacing', () => {
    // Caught as a spacing of its own rather than as an inconsistency with the
    // extent: a zero or negative spacing collapses every sample position onto
    // the origin, and saying "does not equal 2 * extent / (resolution - 1)"
    // would send a reader looking at the extent instead.
    expectRejection('spacing_bohr', 'positive', (payload) => {
      payload.spacing_bohr = 0
    })
  })

  it('rejects a scalar that is not a number', () => {
    expectRejection('spacing_bohr', 'number', (payload) => {
      payload.spacing_bohr = '0.22850905073819594'
    })
  })

  it('rejects an origin away from the coordinate origin', () => {
    expectRejection('origin_bohr', 'origin', (payload) => {
      numberList(payload, 'origin_bohr')[2] = 0.5
    })
  })

  it('rejects a vector field that is not a three-component array', () => {
    expectRejection('origin_bohr', 'three', (payload) => {
      payload.origin_bohr = [0, 0]
    })
    expectRejection('origin_bohr', 'three', (payload) => {
      payload.origin_bohr = 0
    })
  })

  it('rejects a non-unit in-plane axis', () => {
    expectRejection('u_axis', 'unit', (payload) => {
      payload.u_axis = [2, 0, 0]
    })
  })

  it('rejects in-plane axes that are not orthogonal', () => {
    expectRejection('v_axis', 'orthogonal', (payload) => {
      payload.v_axis = [1, 0, 0]
    })
  })

  it('rejects a normal that is not u x v, which would mirror handedness', () => {
    expectRejection('normal', 'u_axis x v_axis', (payload) => {
      payload.normal = [0, 0, -1]
    })
  })

  it('rejects a well-formed frame attached to the wrong plane', () => {
    // Orthonormal and right-handed, so every geometric rule above passes: the
    // xy frame relabelled `xz`. Only the frozen per-plane table catches it,
    // and getting it wrong would silently rotate every sample position a
    // client reconstructs from the frame.
    expectRejection('v_axis', 'xz', (payload) => {
      payload.plane = 'xz'
    })
  })

  it('rejects metadata that identifies neither an eigenstate nor a superposition', () => {
    expectRejection('metadata', 'metadata', (payload) => {
      payload.metadata = { label: '1s, m=0' }
    })
  })

  it('rejects a reported masked fraction that disagrees with the mask', () => {
    expectRejection('phase_masked_fraction', 'phase_masked_fraction', (payload) => {
      payload.phase_masked_fraction = 0.5
    })
  })

  it('rejects a non-finite maximum amplitude', () => {
    expectRejection('max_amplitude_on_plane', 'finite', (payload) => {
      payload.max_amplitude_on_plane = Number.NaN
    })
  })

  it('rejects a negative maximum amplitude', () => {
    expectRejection('max_amplitude_on_plane', 'negative', (payload) => {
      payload.max_amplitude_on_plane = -1
    })
  })
})

describe('sliceValueAt', () => {
  it('reads row-major: k = row * resolution + col', () => {
    const payload = parseSlicePayload(freshGolden())
    const resolution = payload.resolution
    // Every golden sample is 0.0, so identity to `values[k]` is asserted
    // against the index arithmetic rather than against the number: build a
    // payload whose samples ARE their own index (still finite, still inside
    // the phase bound once scaled) and read three interior cells.
    const indexed = freshGolden()
    const values = numberList(indexed, 'values')
    for (let k = 0; k < values.length; k += 1) {
      values[k] = (k / values.length) * Math.PI
    }
    const parsed = parseSlicePayload(indexed)
    for (const [row, col] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [resolution - 1, resolution - 1],
    ] as const) {
      expect(sliceValueAt(parsed, row, col)).toBe(parsed.values[row * resolution + col])
    }
    // Row indexes v (slow) and col indexes u (fast): swapping them changes the
    // answer everywhere off the diagonal, which is the whole content of the
    // layout constant.
    expect(sliceValueAt(parsed, 1, 0)).not.toBe(sliceValueAt(parsed, 0, 1))
  })

  it('returns null for a masked sample rather than the sentinel', () => {
    const payload = parseSlicePayload(goldenWithMaskedSample(17))
    const resolution = payload.resolution
    const row = Math.floor(17 / resolution)
    const col = 17 % resolution
    expect(payload.values[17]).toBe(0)
    expect(sliceValueAt(payload, row, col)).toBeNull()
    expect(sliceValueAt(payload, 0, 0)).toBe(0)
  })

  it('reads every sample of an unmasked non-phase slice', () => {
    const payload = parseSlicePayload(goldenAsDensitySlice())
    expect(sliceValueAt(payload, 3, 4)).toBe(payload.values[3 * payload.resolution + 4])
  })

  it('refuses an out-of-range or non-integer index instead of reading past the row', () => {
    const payload = parseSlicePayload(freshGolden())
    for (const [row, col, field] of [
      [-1, 0, 'row'],
      [payload.resolution, 0, 'row'],
      [0, -1, 'col'],
      [0, payload.resolution, 'col'],
      [0.5, 0, 'row'],
    ] as const) {
      let thrown: unknown
      try {
        sliceValueAt(payload, row, col)
      } catch (error) {
        thrown = error
      }
      expect(thrown, `sliceValueAt accepted ${field}=${row},${col}`).toBeInstanceOf(
        SliceContractError,
      )
      expect((thrown as SliceContractError).field).toBe(field)
    }
  })
})

describe('sliceMaskedFraction', () => {
  it('recomputes the fraction from the mask itself', () => {
    expect(sliceMaskedFraction(parseSlicePayload(freshGolden()))).toBe(0)
    expect(sliceMaskedFraction(parseSlicePayload(goldenWithMaskedSample(0)))).toBe(
      1 / MINIMUM_SLICE_RESOLUTION ** 2,
    )
  })

  it('refuses a reported fraction that the mask does not support', () => {
    // The payload is built through the parser, then the REPORTED number is
    // moved: the recomputation is the authority, and a diagnostic that
    // disagrees with the data it summarises is a broken payload, not a
    // rounding difference.
    const payload = parseSlicePayload(freshGolden())
    const tampered = { ...payload, phase_masked_fraction: 0.25 }
    let thrown: unknown
    try {
      sliceMaskedFraction(tampered)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SliceContractError)
    expect((thrown as SliceContractError).field).toBe('phase_masked_fraction')
  })

  it('refuses a masked slice that reports no fraction at all', () => {
    const payload = parseSlicePayload(freshGolden())
    const stripped = { ...payload, phase_masked_fraction: null }
    let thrown: unknown
    try {
      sliceMaskedFraction(stripped)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SliceContractError)
    expect((thrown as SliceContractError).field).toBe('phase_masked_fraction')
  })
})
