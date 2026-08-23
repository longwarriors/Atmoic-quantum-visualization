import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  EXPECTED_MAGIC,
  EXPECTED_STRIDE,
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
})

describe('readFiniteHeader', () => {
  it('parses a finite decimal header', () => {
    const given = new Headers({ 'X-QuViz-Radial-Mass': '0.93' })
    expect(readFiniteHeader(given, 'X-QuViz-Radial-Mass')).toBe(0.93)
  })

  it('throws a descriptive error when the header is missing', () => {
    expect(() => readFiniteHeader(new Headers(), 'X-QuViz-Radial-Mass')).toThrow(
      /X-QuViz-Radial-Mass.*missing/i,
    )
  })

  it('throws when the header is empty instead of coercing it to 0', () => {
    expect(() =>
      readFiniteHeader(new Headers({ 'X-QuViz-Radial-Mass': '' }), 'X-QuViz-Radial-Mass'),
    ).toThrow(/X-QuViz-Radial-Mass.*empty/i)
  })

  it('throws when the header is not a finite number', () => {
    expect(() =>
      readFiniteHeader(new Headers({ 'X-QuViz-Radial-Mass': 'abc' }), 'X-QuViz-Radial-Mass'),
    ).toThrow(/X-QuViz-Radial-Mass.*"abc".*not a finite number/i)
    expect(() =>
      readFiniteHeader(new Headers({ 'X-QuViz-Radial-Mass': 'Infinity' }), 'X-QuViz-Radial-Mass'),
    ).toThrow(/not a finite number/i)
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

  it('rejects non-zero reserved flags', () => {
    // The encoder writes flags=0 and the Python contract test asserts it; a
    // decoder that never reads the field would accept a payload it does not
    // understand.
    const buffer = goldenBuffer()
    new DataView(buffer).setUint16(6, 0xffff, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(/reserved.*flags.*0xffff/i)
  })

  it('rejects an unsupported version', () => {
    const buffer = goldenBuffer()
    new DataView(buffer).setUint16(4, 2, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(/version=2/)
  })

  it('rejects an unexpected stride', () => {
    const buffer = goldenBuffer()
    new DataView(buffer).setUint32(12, 6, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(/stride=6/)
  })

  it('rejects a truncated payload whose count disagrees with its length', () => {
    const buffer = goldenBuffer()
    new DataView(buffer).setUint32(8, spec.count + 1, true)
    expect(() => parsePointCloud(buffer, headers())).toThrow(/size mismatch/i)
  })
})
