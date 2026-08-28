/**
 * Runtime validation of a slice payload, and the only accessor for its samples.
 *
 * `src/api/schema.gen.ts` types the wire format; it cannot check it. Every
 * field below is `number`, `number[]` or `boolean[]` to the compiler, so a
 * payload whose `values` are one row short, whose mask disagrees with its own
 * reported fraction, or whose frame is left-handed type-checks perfectly and
 * then renders as a picture nobody can tell is wrong. This module is the other
 * half: the server's cross-field rules, restated on the client and *checked*,
 * so a broken payload fails at the boundary with the offending field named
 * instead of arriving in the scene as a plausible image.
 *
 * Three rules earn their place by being invisible in the types:
 *
 * **The layout.** `k = row * resolution + col`, `row` indexing `v` (slow) and
 * `col` indexing `u` (fast). Transposing that is undetectable on the 1s golden
 * -- and on any state whose slice happens to be symmetric -- and silently
 * mirrors every asymmetric one. `sliceValueAt` is therefore the ONLY accessor
 * this module exports: index arithmetic written out at each call site is index
 * arithmetic that will eventually be written out wrong.
 *
 * **The frame.** `u x v = n` with the frozen per-plane table, which makes the
 * `xz` normal `-y`. A right-handed frame is what makes a phase winding's sign
 * and a current's circulation mean anything; `+y` there would mirror both while
 * still satisfying "unit, orthogonal, and a normal".
 *
 * **The mask.** A masked sample is a low-amplitude, phase-undefined sample --
 * NOT a certificate that a node passes through it, and not a certificate that
 * one does not. Masked entries carry the finite sentinel `0.0` so that a
 * strict JSON parser survives the payload and a client that ignores the mask
 * draws a definite placeholder; but `0.0` is also a perfectly good phase
 * ("positive real"), which is precisely why `sliceValueAt` returns `null`
 * rather than the sentinel, and why a masked sample holding anything but the
 * sentinel is a contract violation rather than a curiosity.
 *
 * The rules mirror `quviz.scene.models._SlicePayloadBase.validate_slice_consistency`
 * and `quviz.physics.planes`, deliberately as an independent restatement
 * rather than a shared artefact: a generated validator would be one more thing
 * the same server generates, and the point of a client-side check is that it
 * fails when the server changes in a way nobody meant to change.
 */
import type {
  PrincipalPlane,
  SliceObservable,
  SlicePayload,
  SuperpositionSlicePayload,
} from './types'

/** Either slice payload: they differ only in the type of `metadata`. */
export type AnySlicePayload = SlicePayload | SuperpositionSlicePayload

/**
 * The sample grid the accessors need, and nothing else.
 *
 * Both payloads satisfy it. Typing `sliceValueAt` / `sliceMaskedFraction` on
 * this rather than on `AnySlicePayload` says out loud that reading a sample
 * depends on the grid alone -- not on which metadata came with it -- and lets
 * a caller hold a slice's samples without carrying the whole payload.
 */
export interface SliceSamples {
  resolution: number
  values: number[]
  valid_mask?: boolean[] | null
  phase_masked_fraction?: number | null
}

/** The one sample order the server emits, and the one this module assumes. */
export const SLICE_LAYOUT = 'row_major_v_rows_u_columns'

/** `quviz.scene.slices.MINIMUM_SLICE_RESOLUTION`. */
export const MINIMUM_SLICE_RESOLUTION = 65

/** `quviz.scene.slices.MAXIMUM_SLICE_RESOLUTION`. */
export const MAXIMUM_SLICE_RESOLUTION = 513

export const PRINCIPAL_PLANES: readonly PrincipalPlane[] = ['xy', 'xz', 'yz']

export const SLICE_OBSERVABLES: readonly SliceObservable[] = [
  'probability_density',
  'wavefunction_real',
  'wavefunction_imag',
  'phase',
]

type Vector3 = readonly [number, number, number]

interface PlaneFrame {
  readonly u_axis: Vector3
  readonly v_axis: Vector3
  readonly normal: Vector3
}

/**
 * The frozen frames, `quviz.physics.planes.PLANE_FRAMES`.
 *
 * `xz` has normal `-y` because `x_hat x z_hat = -y_hat`. Writing `+y` there
 * gives a left-handed frame that still passes every "is it a unit normal"
 * check ever written.
 */
export const PLANE_FRAMES: Readonly<Record<PrincipalPlane, PlaneFrame>> = {
  xy: { u_axis: [1, 0, 0], v_axis: [0, 1, 0], normal: [0, 0, 1] },
  xz: { u_axis: [1, 0, 0], v_axis: [0, 0, 1], normal: [0, -1, 0] },
  yz: { u_axis: [0, 1, 0], v_axis: [0, 0, 1], normal: [1, 0, 0] },
}

/**
 * The five terms of the mask rule, which a phase slice reports in full and a
 * non-phase slice does not report at all.
 */
export const PHASE_MASK_REPORT_FIELDS = [
  'phase_mask_relative_amplitude',
  'phase_mask_amplitude_scale',
  'phase_mask_amplitude_threshold',
  'phase_mask_numeric_floor',
  'phase_masked_fraction',
] as const

/**
 * Tolerance for the geometric identities (unit length, orthogonality, the
 * cross product, the spacing).
 *
 * The server sends exact `0.0` / `±1.0` components and computes
 * `2 * extent / (resolution - 1)` with the same IEEE operations in the same
 * order, so the honest comparison is exact equality. It is not written that
 * way because an exact test would make this module fail on an arithmetically
 * identical payload that merely took a different evaluation route, which is a
 * false alarm rather than a contract violation. 1e-12 is ~4500 ulp at 1.0:
 * far above any rounding difference, far below any real disagreement (the
 * smallest one that matters, a mirrored normal, is off by 2).
 */
const GEOMETRY_TOLERANCE = 1e-12

/** A reported fraction is `count / resolution**2` recomputed the same way. */
const FRACTION_TOLERANCE = 1e-12

/**
 * The phase bound, in doubles.
 *
 * `np.angle` returns exactly `pi` for a negative real amplitude and the
 * payload carries it as a double, so `Math.PI` is the exact bound and an
 * inclusive comparison is right. (Contrast `src/api/qvpc.ts`, where the same
 * value arrives as float32 and rounds UP to 3.1415927410125732, above
 * `Math.PI` -- a bound of `Math.PI` there would reject payloads the encoder is
 * entitled to produce.)
 */
const PHASE_BOUND = Math.PI

/**
 * A payload that broke a stated rule, with the field that broke it.
 *
 * `field` is machine-readable on purpose: the caller that surfaces this to a
 * user should not be parsing a sentence, and a test that asserts only "it
 * threw" goes on passing while the rule it names is deleted and a neighbouring
 * one fires instead.
 */
export class SliceContractError extends Error {
  readonly field: string

  constructor(field: string, detail: string) {
    super(`Slice payload field ${field}: ${detail}`)
    this.name = 'SliceContractError'
    this.field = field
  }
}

type RawRecord = Record<string, unknown>

function fail(field: string, detail: string): never {
  throw new SliceContractError(field, detail)
}

function describeValue(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : `${typeof value} ${String(value)}`
}

function requireRecord(raw: unknown, field: string): RawRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(field, `must be a JSON object, got ${describeValue(raw)}`)
  }
  return raw as RawRecord
}

function requireNumber(source: RawRecord, field: string): number {
  const value = source[field]
  if (typeof value !== 'number') {
    fail(field, `must be a number, got ${describeValue(value)}`)
  }
  if (!Number.isFinite(value)) {
    // The pinned server rejects non-finite values before or during response
    // rendering, but this validator is also a boundary for cached fixtures,
    // custom transports and direct object callers. Do not make its safety
    // depend on one response class remaining strict.
    fail(field, `must be finite -- JSON carries no NaN or Infinity -- got ${String(value)}`)
  }
  return value
}

/** Entry-wise finiteness, shared by the vectors and by `values`. */
function requireFiniteEntries(field: string, entries: readonly unknown[]): number[] {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (typeof entry !== 'number') {
      fail(field, `entry ${index} must be a number, got ${describeValue(entry)}`)
    }
    if (!Number.isFinite(entry)) {
      fail(field, `entry ${index} must be finite -- JSON carries no NaN or Infinity`)
    }
  }
  return entries as number[]
}

function requireVector(source: RawRecord, field: string): Vector3 {
  const value = source[field]
  if (!Array.isArray(value) || value.length !== 3) {
    fail(field, `must have three components, got ${describeValue(value)}`)
  }
  const [x, y, z] = requireFiniteEntries(field, value)
  return [x, y, z]
}

function requireSampleArray(source: RawRecord, field: string, expected: number): number[] {
  const value = source[field]
  if (!Array.isArray(value)) {
    fail(field, `must be an array, got ${describeValue(value)}`)
  }
  if (value.length !== expected) {
    fail(field, `must hold resolution**2 = ${expected} samples, got ${value.length}`)
  }
  return requireFiniteEntries(field, value)
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function vectorsAgree(a: Vector3, b: Vector3): boolean {
  return a.every((component, index) => Math.abs(component - b[index]) <= GEOMETRY_TOLERANCE)
}

function requireResolution(source: RawRecord): number {
  const resolution = requireNumber(source, 'resolution')
  if (!Number.isInteger(resolution)) {
    fail('resolution', `must be an integer, got ${resolution}`)
  }
  if (resolution % 2 === 0) {
    // The sample axis is `spacing * (arange(resolution) - (resolution - 1) / 2)`,
    // which contains the origin only for an odd count -- and every symmetry
    // and mask claim a slice makes is stated about a plane through the origin.
    fail('resolution', `must be odd so a sample lies on the origin, got ${resolution}`)
  }
  if (resolution < MINIMUM_SLICE_RESOLUTION || resolution > MAXIMUM_SLICE_RESOLUTION) {
    fail(
      'resolution',
      `must be between ${MINIMUM_SLICE_RESOLUTION} and ${MAXIMUM_SLICE_RESOLUTION}, ` +
        `got ${resolution}`,
    )
  }
  return resolution
}

function requireGrid(source: RawRecord, resolution: number): void {
  const extent = requireNumber(source, 'extent_bohr')
  if (extent <= 0) {
    fail('extent_bohr', `must be positive, got ${extent}`)
  }
  const spacing = requireNumber(source, 'spacing_bohr')
  if (spacing <= 0) {
    fail('spacing_bohr', `must be positive, got ${spacing}`)
  }
  const expected = (2 * extent) / (resolution - 1)
  if (Math.abs(spacing - expected) > GEOMETRY_TOLERANCE * expected) {
    fail(
      'spacing_bohr',
      `must equal 2 * extent_bohr / (resolution - 1) = ${expected}, got ${spacing}`,
    )
  }
}

function requireFrame(source: RawRecord, plane: PrincipalPlane): void {
  const origin = requireVector(source, 'origin_bohr')
  if (!vectorsAgree(origin, [0, 0, 0])) {
    fail('origin_bohr', `must be the coordinate origin [0, 0, 0], got [${origin.join(', ')}]`)
  }

  // The geometric invariants first, because they are the ones a renderer acts
  // on and they say what is wrong in the renderer's own terms.
  const u = requireVector(source, 'u_axis')
  const v = requireVector(source, 'v_axis')
  const n = requireVector(source, 'normal')
  for (const [field, axis] of [
    ['u_axis', u],
    ['v_axis', v],
  ] as const) {
    const length = Math.sqrt(dot(axis, axis))
    if (Math.abs(length - 1) > GEOMETRY_TOLERANCE) {
      fail(field, `must be a unit vector, has length ${length}`)
    }
  }
  if (Math.abs(dot(u, v)) > GEOMETRY_TOLERANCE) {
    fail('v_axis', `must be orthogonal to u_axis, their dot product is ${dot(u, v)}`)
  }
  const expectedNormal = cross(u, v)
  if (!vectorsAgree(n, expectedNormal)) {
    fail(
      'normal',
      `must be u_axis x v_axis = [${expectedNormal.join(', ')}], got [${n.join(', ')}] -- ` +
        'a mirrored normal reverses every circulation and phase-winding sign on this plane',
    )
  }

  // Then the frozen table, which catches the one class the geometry cannot
  // see: an orthonormal, right-handed frame attached to the wrong plane.
  const frame = PLANE_FRAMES[plane]
  for (const [field, actual, expected] of [
    ['u_axis', u, frame.u_axis],
    ['v_axis', v, frame.v_axis],
    ['normal', n, frame.normal],
  ] as const) {
    if (!vectorsAgree(actual, expected)) {
      fail(
        field,
        `must be [${expected.join(', ')}] on the ${plane} plane, got [${actual.join(', ')}]`,
      )
    }
  }
}

function requireMaskReport(source: RawRecord, isPhase: boolean): void {
  for (const field of PHASE_MASK_REPORT_FIELDS) {
    const value = source[field]
    const reported = value !== undefined && value !== null
    if (isPhase && !reported) {
      fail(field, 'a phase slice must report every term of the mask rule it applied')
    }
    if (!isPhase && reported) {
      fail(field, `only a phase slice carries a mask rule, got ${describeValue(value)}`)
    }
    if (reported) {
      requireNumber(source, field)
    }
  }
}

function requireMask(source: RawRecord, isPhase: boolean, expected: number): boolean[] | null {
  const value = source.valid_mask
  const present = value !== undefined && value !== null
  if (isPhase && !present) {
    fail(
      'valid_mask',
      'a phase slice must carry a mask: the phase is undefined wherever the amplitude is not ' +
        'resolved, and an unmasked phase slice cannot say where that is',
    )
  }
  if (!isPhase && present) {
    fail('valid_mask', 'only a phase slice carries a mask; every other observable is defined ' +
      'wherever psi is')
  }
  if (!present) {
    return null
  }
  if (!Array.isArray(value)) {
    fail('valid_mask', `must be an array, got ${describeValue(value)}`)
  }
  if (value.length !== expected) {
    fail('valid_mask', `must hold resolution**2 = ${expected} entries, got ${value.length}`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== 'boolean') {
      fail('valid_mask', `entry ${index} must be a boolean, got ${describeValue(value[index])}`)
    }
  }
  return value as boolean[]
}

function requireSamples(
  values: readonly number[],
  mask: readonly boolean[] | null,
  isPhase: boolean,
  sentinel: number,
): void {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (mask !== null && !mask[index]) {
      if (value !== sentinel) {
        fail(
          'values',
          `sample ${index} is masked, so it must equal masked_value_sentinel (${sentinel}) ` +
            `exactly, got ${value}. A masked sample marks a low-amplitude, phase-undefined ` +
            'region -- never a node -- and the sentinel is what a client that ignores the mask ' +
            'draws instead of cancellation residue',
        )
      }
      continue
    }
    if (isPhase && (value < -PHASE_BOUND || value > PHASE_BOUND)) {
      fail('values', `unmasked phase sample ${index} is outside [-pi, pi]: ${value}`)
    }
  }
}

/**
 * Validate a decoded slice response and return it typed.
 *
 * The argument is the object a JSON parse produced, not a string: the raw text
 * is the transport's problem, and a payload that reached here through
 * `response.json()` has already had `NaN` / `Infinity` decided for it -- which
 * is why the finiteness checks below are not redundant with parsing.
 *
 * Returns the SAME object, typed, rather than a copy: a 513-sample slice
 * carries 263169 doubles and copying them per frame is a real cost. The
 * payload must therefore be treated as read-only, exactly as the server's own
 * cached payloads are.
 */
export function parseSlicePayload(raw: unknown): AnySlicePayload {
  const source = requireRecord(raw, 'payload')

  if (source.layout !== SLICE_LAYOUT) {
    fail(
      'layout',
      `must be "${SLICE_LAYOUT}" -- sample k = row * resolution + col, row indexing v and col ` +
        `indexing u -- got ${describeValue(source.layout)}`,
    )
  }

  const plane = source.plane
  if (typeof plane !== 'string' || !PRINCIPAL_PLANES.includes(plane as PrincipalPlane)) {
    fail('plane', `must be one of ${PRINCIPAL_PLANES.join(', ')}, got ${describeValue(plane)}`)
  }
  const observable = source.slice_observable
  if (
    typeof observable !== 'string' ||
    !SLICE_OBSERVABLES.includes(observable as SliceObservable)
  ) {
    fail(
      'slice_observable',
      `must be one of ${SLICE_OBSERVABLES.join(', ')}, got ${describeValue(observable)}`,
    )
  }
  const isPhase = observable === 'phase'

  const resolution = requireResolution(source)
  requireGrid(source, resolution)
  requireFrame(source, plane as PrincipalPlane)

  // Only the discriminant, not the whole of it: which metadata a payload
  // carries is what makes the returned union sound, while the fields inside it
  // are held by `schema.gen.ts` and by the Python contract tests. Stating that
  // boundary is the point -- an unchecked `as` would not.
  const metadata = requireRecord(source.metadata, 'metadata')
  if (!('state' in metadata) && !('terms' in metadata)) {
    fail(
      'metadata',
      'must identify an eigenstate (a "state" field) or a superposition (a "terms" field)',
    )
  }

  const sentinel = requireNumber(source, 'masked_value_sentinel')
  const maxAmplitude = requireNumber(source, 'max_amplitude_on_plane')
  if (maxAmplitude < 0) {
    fail('max_amplitude_on_plane', `must not be negative, got ${maxAmplitude}`)
  }

  const expected = resolution * resolution
  const values = requireSampleArray(source, 'values', expected)
  requireMaskReport(source, isPhase)
  const mask = requireMask(source, isPhase, expected)
  requireSamples(values, mask, isPhase, sentinel)

  const payload = source as unknown as AnySlicePayload
  sliceMaskedFraction(payload)
  return payload
}

/**
 * The value at `(row, col)`, or `null` where the mask says the phase is not
 * defined.
 *
 * The only row-major accessor this module exports, and the only place
 * `row * resolution + col` is written. `null` rather than the sentinel because
 * the sentinel is a legal value of the field it sits in: returning `0.0` here
 * would hand a caller a phase of "positive real" for a sample whose phase is
 * undefined, and nothing downstream could tell the two apart.
 */
export function sliceValueAt(payload: SliceSamples, row: number, col: number): number | null {
  const { resolution } = payload
  requireIndex('row', row, resolution)
  requireIndex('col', col, resolution)
  const index = row * resolution + col
  const mask = payload.valid_mask
  if (mask != null && !mask[index]) {
    return null
  }
  return payload.values[index]
}

function requireIndex(field: string, value: number, resolution: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= resolution) {
    fail(field, `must be an integer in [0, ${resolution}), got ${value}`)
  }
}

/**
 * The masked fraction, recomputed from the mask and cross-checked against the
 * number the payload reports.
 *
 * The recomputation is the authority. `phase_masked_fraction` is a diagnostic
 * -- it is what a user is shown when a slice looks emptier than expected -- and
 * a diagnostic that disagrees with the data it summarises is worse than none,
 * because it is the number someone will quote. A slice with no mask has
 * nothing masked, and `parseSlicePayload` has already refused any non-phase
 * payload that reports a fraction at all.
 */
export function sliceMaskedFraction(payload: SliceSamples): number {
  const mask = payload.valid_mask
  if (mask == null) {
    return 0
  }
  let masked = 0
  for (const valid of mask) {
    if (!valid) {
      masked += 1
    }
  }
  const fraction = masked / mask.length
  const reported = payload.phase_masked_fraction
  if (reported == null) {
    fail('phase_masked_fraction', 'a masked slice must report the fraction it masked')
  }
  if (Math.abs(fraction - reported) > FRACTION_TOLERANCE) {
    fail(
      'phase_masked_fraction',
      `reports ${reported}, but the mask holds ${masked} masked of ${mask.length} = ${fraction}`,
    )
  }
  return fraction
}
