import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  EXPECTED_MAGIC,
  EXPECTED_STRIDE,
  type HeaderRange,
  HEADER_BYTES,
  SUPPORTED_VERSION,
  parsePointCloud,
  readFiniteHeader,
} from './qvpc'

const goldenUrl = new URL('../../../tests/fixtures/qvpc_golden.bin', import.meta.url)
const specUrl = new URL('../../../tests/fixtures/qvpc_golden.json', import.meta.url)

interface GoldenSpec {
  magic: string
  version: number
  stride: number
  count: number
  positions: number[][]
  intensity: number[]
  phase: number[]
}

const spec: GoldenSpec = JSON.parse(readFileSync(fileURLToPath(specUrl), 'utf-8'))

function goldenBuffer(): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(goldenUrl))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    'X-QuViz-Radial-Mass': '0.999999000',
    'X-QuViz-Extent-Bohr': '100.000000',
    ...overrides,
  })
}

describe('qvpc_golden.bin header, pinned field-for-field with tests/test_scene_contract.py', () => {
  // The Python side unpacks '<4sHHII' and asserts magic/version/flags/count/stride.
  // Pinning the same five fields here means neither half of the contract can
  // drift without breaking a test on its own side.
  const view = new DataView(goldenBuffer())

  it('starts with the QVPC magic', () => {
    const magic = new TextDecoder().decode(new Uint8Array(goldenBuffer(), 0, 4))
    expect(magic).toBe(EXPECTED_MAGIC)
    expect(magic).toBe(spec.magic)
  })

  it('carries version 1 at byte 4', () => {
    expect(view.getUint16(4, true)).toBe(SUPPORTED_VERSION)
    expect(spec.version).toBe(SUPPORTED_VERSION)
  })

  it('carries reserved flags == 0 at byte 6', () => {
    expect(view.getUint16(6, true)).toBe(0)
  })

  it('carries count 4 at byte 8 and stride 5 at byte 12', () => {
    expect(view.getUint32(8, true)).toBe(4)
    expect(view.getUint32(12, true)).toBe(EXPECTED_STRIDE)
    expect(spec.count).toBe(4)
    expect(spec.stride).toBe(EXPECTED_STRIDE)
  })

  it('is exactly 16 bytes of header followed by count * stride float32s', () => {
    expect(HEADER_BYTES).toBe(16)
    expect(goldenBuffer().byteLength).toBe(HEADER_BYTES + 4 * EXPECTED_STRIDE * 4)
  })
})

describe('parsePointCloud, against the Python-generated golden vector', () => {
  it('decodes exactly what the Python encoder wrote', () => {
    const result = parsePointCloud(goldenBuffer(), headers())

    expect(result.version).toBe(spec.version)
    expect(result.flags).toBe(0)
    expect(result.count).toBe(spec.count)
    expect(result.stride).toBe(spec.stride)
    expect(Array.from(result.positions)).toEqual(spec.positions.flat())
    expect(Array.from(result.intensity)).toEqual(spec.intensity)
    expect(Array.from(result.phase)).toEqual(spec.phase)
  })

  it('de-interleaves rather than copying the raw stride', () => {
    // Guards the actual bug this format invites: reading x,y,z from a stride-5
    // record without skipping intensity and phase.
    const result = parsePointCloud(goldenBuffer(), headers())
    expect(Array.from(result.positions.slice(3, 6))).toEqual(spec.positions[1])
    expect(result.phase[3]).toBe(spec.phase[3])
  })

  it('reads the transport metadata headers', () => {
    const result = parsePointCloud(goldenBuffer(), headers())
    expect(result.radialMass).toBeCloseTo(0.999999, 9)
    expect(result.extentBohr).toBeCloseTo(100, 9)
  })

  it('throws rather than reporting NaN when the metadata headers are absent', () => {
    // Number(undefined ?? 'NaN') used to flow NaN into the Inspector and the
    // fog scale; a missing header is a broken response, not a value.
    expect(() => parsePointCloud(goldenBuffer(), new Headers())).toThrow(
      /X-QuViz-Radial-Mass.*missing/i,
    )
  })

  it('throws rather than reporting 0 when a metadata header is empty', () => {
    // Number('') === 0 would silently report a 0% radial mass.
    expect(() =>
      parsePointCloud(goldenBuffer(), headers({ 'X-QuViz-Extent-Bohr': '' })),
    ).toThrow(/X-QuViz-Extent-Bohr.*empty/i)
  })

  // The Python side emits f"{radial_mass:.9f}" and f"{extent:.6f}"; anything
  // Number() would accept beyond that is a broken response, not a value.
  it.each(['1e-400', '0x10', '-0.5', '1.5'])(
    'rejects X-QuViz-Radial-Mass %j, which is not a plain decimal in [0, 1]',
    (raw) => {
      expect(() =>
        parsePointCloud(goldenBuffer(), headers({ 'X-QuViz-Radial-Mass': raw })),
      ).toThrow(/X-QuViz-Radial-Mass/)
    },
  )

  it.each(['1e-400', '0x10', '0', '-0.5', '0.000000'])(
    'rejects X-QuViz-Extent-Bohr %j, which is not a plain decimal > 0',
    (raw) => {
      expect(() =>
        parsePointCloud(goldenBuffer(), headers({ 'X-QuViz-Extent-Bohr': raw })),
      ).toThrow(/X-QuViz-Extent-Bohr/)
    },
  )

  it('accepts the closed radial-mass boundaries 0 and 1', () => {
    expect(
      parsePointCloud(goldenBuffer(), headers({ 'X-QuViz-Radial-Mass': '0.000000000' })).radialMass,
    ).toBe(0)
    expect(
      parsePointCloud(goldenBuffer(), headers({ 'X-QuViz-Radial-Mass': '1.000000000' })).radialMass,
    ).toBe(1)
  })
})

describe('readFiniteHeader', () => {
  const NAME = 'X-QuViz-Radial-Mass'
  const unitInterval: HeaderRange = { min: 0, max: 1 }
  const positive: HeaderRange = { min: 0, exclusiveMin: true }
  const read = (raw: string, range: HeaderRange = unitInterval) =>
    readFiniteHeader(new Headers({ [NAME]: raw }), NAME, range)

  it.each([
    ['0.93', 0.93],
    ['0.999999000', 0.999999],
    ['0', 0],
    ['1', 1],
  ])('parses the plain decimal %s the Python side emits', (raw, expected) => {
    expect(read(raw)).toBe(expected)
  })

  it('accepts a negative plain decimal when the range allows it', () => {
    expect(read('-2.5', { min: -10, max: 10 })).toBe(-2.5)
  })

  it('throws a descriptive error when the header is missing', () => {
    expect(() => readFiniteHeader(new Headers(), NAME, unitInterval)).toThrow(
      /X-QuViz-Radial-Mass.*missing/i,
    )
  })

  it('throws when the header is empty instead of coercing it to 0', () => {
    expect(() => read('')).toThrow(/X-QuViz-Radial-Mass.*empty/i)
  })

  // Number() is far more permissive than f"{x:.9f}": '1e-400' underflows to
  // 0, '0x10' is 16, '+0.5' and '.5' both coerce. (Headers itself strips
  // leading/trailing whitespace, so that case never reaches us.) None of these can
  // come from the Python encoder, so any of them means a broken response.
  it.each(['1e-400', '1e3', '0x10', 'abc', 'Infinity', 'NaN', '1 0', '+0.5', '.5', '5.'])(
    'rejects the non-plain-decimal syntax %j, naming the header',
    (raw) => {
      expect(() => read(raw)).toThrow(
        new RegExp(`X-QuViz-Radial-Mass.*"${raw.replace(/[.+]/g, '\\$&')}".*plain decimal`, 'i'),
      )
    },
  )

  it('throws when a syntactically valid decimal overflows to Infinity', () => {
    const huge = `1${'0'.repeat(400)}`
    expect(() => read(huge, positive)).toThrow(/X-QuViz-Radial-Mass.*not a finite number/i)
  })

  it.each(['-0.5', '1.5', '-0.000000001', '1.000000001'])(
    'rejects %s as outside the closed range [0, 1], naming the header',
    (raw) => {
      expect(() => read(raw)).toThrow(/X-QuViz-Radial-Mass.*outside \[0, 1\]/i)
    },
  )

  it('treats a closed range as inclusive at both ends', () => {
    expect(read('0')).toBe(0)
    expect(read('1')).toBe(1)
  })

  it('rejects the lower bound itself when exclusiveMin is set', () => {
    expect(() => read('0', positive)).toThrow(/X-QuViz-Radial-Mass.*outside \(0, ∞\)/i)
    expect(() => read('-1', positive)).toThrow(/outside \(0, ∞\)/i)
    expect(read('0.000001', positive)).toBe(0.000001)
  })
})

describe('parsePointCloud rejects malformed payloads', () => {
  it('rejects a buffer shorter than the header', () => {
    expect(() => parsePointCloud(new ArrayBuffer(8), headers())).toThrow(/shorter than/i)
  })

  it('rejects a wrong magic number', () => {
    const buffer = goldenBuffer()
    new Uint8Array(buffer)[0] = 0x58 // 'X'
    expect(() => parsePointCloud(buffer, headers())).toThrow(/magic/i)
  })

  // Several values per field, each asserted to appear in the message, so a
  // decoder narrowed to a single sentinel (e.g. `flags === 0xffff`) cannot
  // pass with full branch coverage.
  it.each([0x0001, 0x8000, 0xffff])('rejects reserved flags %i', (flags) => {
    // The encoder writes flags=0 and the Python contract test asserts it; a
    // decoder that never reads the field would accept a payload it does not
    // understand.
    const buffer = goldenBuffer()
    new DataView(buffer).setUint16(6, flags, true)
    const hex = `0x${flags.toString(16).padStart(4, '0')}`
    expect(() => parsePointCloud(buffer, headers())).toThrow(
      new RegExp(`reserved.*flags.*${hex}`, 'i'),
    )
  })

  it.each([0, 2, 256])('rejects unsupported version %i', (version) => {
    const buffer = goldenBuffer()
    new DataView(buffer).setUint16(4, version, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(
      new RegExp(`version=${version}\\b`),
    )
  })

  it.each([0, 4, 6])('rejects unexpected stride %i', (stride) => {
    const buffer = goldenBuffer()
    new DataView(buffer).setUint32(12, stride, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(
      new RegExp(`stride=${stride}\\b`),
    )
  })

  it('rejects a truncated payload whose count disagrees with its length', () => {
    const buffer = goldenBuffer()
    new DataView(buffer).setUint32(8, spec.count + 1, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(/size mismatch/i)
  })
})
