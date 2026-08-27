/**
 * QVPC/1 wire-format decoding.
 *
 * Deliberately separate from `client.ts`: decoding a binary contract is not the
 * same concern as talking HTTP, and keeping it pure means it can be tested
 * exhaustively against the Python-generated golden vector in
 * `tests/fixtures/qvpc_golden.bin` without mocking the network.
 */
import type { PointCloudData } from './types'

export const HEADER_BYTES = 16
export const EXPECTED_MAGIC = 'QVPC'
export const SUPPORTED_VERSION = 1
export const EXPECTED_STRIDE = 5

/**
 * The only syntax the Python side emits: `f"{x:.9f}"` / `f"{x:.6f}"`, i.e. an
 * optional sign, digits, optional fraction. No exponent, no hex, no leading
 * `+`, no bare `.5`, no whitespace.
 */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/

export interface HeaderRange {
  /** Lower bound; inclusive unless `exclusiveMin` is set. */
  min: number
  /** Inclusive upper bound; omit for no upper bound. */
  max?: number
  exclusiveMin?: boolean
}

function describeRange({ min, max, exclusiveMin }: HeaderRange): string {
  const open = exclusiveMin ? '(' : '['
  return max === undefined ? `${open}${min}, ∞)` : `${open}${min}, ${max}]`
}

/**
 * Read a numeric transport header and refuse to guess.
 *
 * `Number(headers.get(name) ?? 'NaN')` looked defensive but was not: a missing
 * header became NaN and an empty one became 0 (`Number('') === 0`), and both
 * flowed silently into the Inspector and the fog scale. `Number()` is also far
 * looser than the encoder: `'1e-400'` underflows to 0, `'0x10'` is 16, and a
 * radial mass of `-0.5` or `1.5` is "finite" but physically meaningless. The
 * server promised a plain decimal inside a known range; anything else is a
 * broken response, so surface it the same way a bad payload is surfaced: by
 * throwing, with the header name in the message.
 */
export function readFiniteHeader(headers: Headers, name: string, range: HeaderRange): number {
  const raw = headers.get(name)
  if (raw === null) {
    throw new Error(`Point-cloud response header ${name} is missing.`)
  }
  if (raw.trim() === '') {
    throw new Error(`Point-cloud response header ${name} is empty.`)
  }
  if (!PLAIN_DECIMAL.test(raw)) {
    throw new Error(`Point-cloud response header ${name} is "${raw}", not a plain decimal.`)
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`Point-cloud response header ${name} is "${raw}", not a finite number.`)
  }
  const belowMin = range.exclusiveMin ? value <= range.min : value < range.min
  const aboveMax = range.max !== undefined && value > range.max
  if (belowMin || aboveMax) {
    throw new Error(
      `Point-cloud response header ${name} is "${raw}", outside ${describeRange(range)}.`,
    )
  }
  return value
}

/**
 * The inclusive phase bound, and the reason it is not `Math.PI`.
 *
 * The server writes `float32(np.angle(psi))`, and `np.angle` returns exactly
 * `pi` for a negative real amplitude. Rounded to float32 that becomes
 * 3.1415927410125732, which is *greater* than the double `Math.PI`
 * (3.141592653589793). A bound of `Math.PI` would therefore reject payloads the
 * encoder is entitled to produce, so the comparison happens in the precision
 * the wire format actually uses.
 */
export const MAX_PHASE = Math.fround(Math.PI)

function requireFinite(field: string, index: number, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `QVPC payload is invalid: ${field} at sample ${index} is ${value}, not a finite number.`,
    )
  }
}

/**
 * Validate one decoded record.
 *
 * The header can be flawless while the body carries NaN coordinates or a phase
 * outside the branch cut: those reach the GPU as invisible points and as hues
 * that no longer mean what the legend says they mean. Failing loudly here, with
 * the field name and the sample index, keeps a broken response from being
 * rendered as if it were physics.
 */
function validateSample(
  index: number,
  x: number,
  y: number,
  z: number,
  intensity: number,
  phase: number,
): void {
  requireFinite('x', index, x)
  requireFinite('y', index, y)
  requireFinite('z', index, z)
  requireFinite('intensity', index, intensity)
  requireFinite('phase', index, phase)
  // `< 0` rather than `<= 0`: -0 is a legitimate zero intensity that float32
  // round-trips, while -1e-7 is a real contract break.
  if (intensity < 0 || intensity > 1) {
    throw new Error(
      `QVPC payload is invalid: intensity at sample ${index} is ${intensity}, outside [0, 1].`,
    )
  }
  if (phase < -MAX_PHASE || phase > MAX_PHASE) {
    throw new Error(
      `QVPC payload is invalid: phase at sample ${index} is ${phase}, ` +
        `outside [-${MAX_PHASE}, ${MAX_PHASE}], the float32 [-pi, pi] range.`,
    )
  }
}

export function parsePointCloud(
  buffer: ArrayBuffer,
  headers: Headers,
): Omit<PointCloudData, 'metadata'> {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error('Point-cloud payload is shorter than the QVPC header.')
  }
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4))
  if (magic !== EXPECTED_MAGIC) {
    throw new Error(`Unexpected point-cloud magic: ${magic}`)
  }
  // Header layout mirrors struct '<4sHHII' in src/quviz/scene/binary.py:
  // magic, version, flags, count, stride.
  const view = new DataView(buffer)
  const version = view.getUint16(4, true)
  const flags = view.getUint16(6, true)
  const count = view.getUint32(8, true)
  const stride = view.getUint32(12, true)
  if (version !== SUPPORTED_VERSION || stride !== EXPECTED_STRIDE) {
    throw new Error(`Unsupported QVPC payload: version=${version}, stride=${stride}`)
  }
  if (flags !== 0) {
    // The encoder writes 0 and the Python contract test pins it. Any set bit
    // would mean a format feature this decoder does not know how to honour.
    const hex = `0x${flags.toString(16).padStart(4, '0')}`
    throw new Error(`Unsupported QVPC payload: reserved header flags must be 0, got ${hex}`)
  }
  const expectedBytes = HEADER_BYTES + count * stride * Float32Array.BYTES_PER_ELEMENT
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`QVPC size mismatch: expected ${expectedBytes}, got ${buffer.byteLength}`)
  }

  const interleaved = new Float32Array(buffer, HEADER_BYTES, count * stride)
  const positions = new Float32Array(count * 3)
  const intensity = new Float32Array(count)
  const phase = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const source = index * stride
    const target = index * 3
    validateSample(
      index,
      interleaved[source],
      interleaved[source + 1],
      interleaved[source + 2],
      interleaved[source + 3],
      interleaved[source + 4],
    )
    positions[target] = interleaved[source]
    positions[target + 1] = interleaved[source + 1]
    positions[target + 2] = interleaved[source + 2]
    intensity[index] = interleaved[source + 3]
    phase[index] = interleaved[source + 4]
  }
  // version and flags are validated above but not returned: no consumer
  // branches on them, and the test suite pins them via the golden header bytes.
  return {
    count,
    stride,
    positions,
    intensity,
    phase,
    // A probability mass is in [0, 1]; a bounding extent is a strictly positive
    // length. Both ranges are part of the contract with routes.py.
    radialMass: readFiniteHeader(headers, 'X-QuViz-Radial-Mass', { min: 0, max: 1 }),
    extentBohr: readFiniteHeader(headers, 'X-QuViz-Extent-Bohr', { min: 0, exclusiveMin: true }),
  }
}
