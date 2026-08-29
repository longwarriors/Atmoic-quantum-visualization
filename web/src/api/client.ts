import { parsePointCloud } from './qvpc'
import {
  MAXIMUM_SLICE_RESOLUTION,
  MINIMUM_SLICE_RESOLUTION,
  parseSlicePayload,
  SliceContractError,
  type AnySlicePayload,
} from './sliceContract'
import type {
  BasisKind,
  CurrentFieldPayload,
  IsosurfacePayload,
  OrbitalMetadata,
  OrbitalParameters,
  OrbitalPreset,
  PointCloudData,
  PrincipalPlane,
  SliceObservable,
  SlicePayload,
  SuperpositionCurrentPayload,
  SuperpositionIsosurfacePayload,
  SuperpositionPreset,
  SuperpositionSlicePayload,
} from './types'

export { parsePointCloud } from './qvpc'

function queryString(params: object): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => search.set(key, String(value)))
  return search.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Turn FastAPI's string or validation-list `detail` into readable UI copy. */
function formatFastApiDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail.trim() || null
  if (!Array.isArray(detail)) return null

  const messages = detail.flatMap((entry) => {
    if (typeof entry === 'string') return entry.trim() ? [entry.trim()] : []
    if (!isRecord(entry) || typeof entry.msg !== 'string') return []
    const location = Array.isArray(entry.loc)
      ? entry.loc.map((part) => String(part)).join('.')
      : ''
    return [location ? `${location}: ${entry.msg}` : entry.msg]
  })
  return messages.length === 0 ? null : messages.join('; ')
}

/**
 * Preserve plain-text/proxy errors, while unwrapping the JSON envelope used by
 * FastAPI (`{"detail": ...}`). This is shared by every route so a fail-closed
 * numerical 422 reaches the panel as an explanation instead of raw JSON.
 */
async function responseError(response: Response): Promise<Error> {
  const body = (await response.text()).trim()
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  if (!body) return new Error(`Request failed with ${status}.`)

  try {
    const payload: unknown = JSON.parse(body)
    if (isRecord(payload)) {
      const detail = formatFastApiDetail(payload.detail)
      if (detail !== null) return new Error(detail)
    }
    if (typeof payload === 'string' && payload.trim()) return new Error(payload.trim())
  } catch {
    // A reverse proxy or development server may return text/HTML. Preserve it.
  }
  return new Error(body)
}

function parseOrbitalPreset(value: unknown, index: number): OrbitalPreset {
  const location = `orbital catalog[${index}]`
  if (!isRecord(value)) throw new Error(`${location} must be an object`)

  const { id, label, n, l, m, basis, z } = value
  if (typeof id !== 'string' || !id.trim()) throw new Error(`${location}.id must be a string`)
  if (typeof label !== 'string' || !label.trim()) {
    throw new Error(`${location}.label must be a string`)
  }
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new Error(`${location}.n must be a positive integer`)
  }
  if (typeof l !== 'number' || !Number.isInteger(l) || l < 0 || l >= n) {
    throw new Error(`${location}.l must be an integer in 0..n-1`)
  }
  if (typeof m !== 'number' || !Number.isInteger(m) || Math.abs(m) > l) {
    throw new Error(`${location}.m must be an integer with |m| <= l`)
  }
  if (basis !== 'real' && basis !== 'complex') {
    throw new Error(`${location}.basis must be "real" or "complex"`)
  }
  if (z !== undefined && (typeof z !== 'number' || !Number.isFinite(z) || z <= 0)) {
    throw new Error(`${location}.z must be a positive finite number when present`)
  }

  const preset: Omit<OrbitalPreset, 'z'> = { id, label, n, l, m, basis }
  return z === undefined ? preset : { ...preset, z }
}

function parseSuperpositionPreset(value: unknown, index: number): SuperpositionPreset {
  const location = `superposition catalog[${index}]`
  if (!isRecord(value)) throw new Error(`${location} must be an object`)

  const {
    id,
    label,
    terms,
    period_au,
    note,
    slice_resolution_floor,
  } = value
  if (typeof id !== 'string' || !id.trim()) throw new Error(`${location}.id must be a string`)
  if (typeof label !== 'string' || !label.trim()) {
    throw new Error(`${location}.label must be a string`)
  }
  if (typeof terms !== 'string' || !terms.trim()) {
    throw new Error(`${location}.terms must be a string`)
  }
  if (typeof period_au !== 'number' || !Number.isFinite(period_au) || period_au < 0) {
    throw new Error(`${location}.period_au must be a finite non-negative number`)
  }
  if (typeof note !== 'string') throw new Error(`${location}.note must be a string`)
  if (
    typeof slice_resolution_floor !== 'number' ||
    !Number.isInteger(slice_resolution_floor) ||
    slice_resolution_floor < MINIMUM_SLICE_RESOLUTION ||
    slice_resolution_floor > MAXIMUM_SLICE_RESOLUTION ||
    slice_resolution_floor % 2 === 0
  ) {
    throw new Error(
      `${location}.slice_resolution_floor must be an odd integer in ` +
      `${MINIMUM_SLICE_RESOLUTION}..${MAXIMUM_SLICE_RESOLUTION}`,
    )
  }
  return {
    id,
    label,
    terms,
    period_au,
    note,
    slice_resolution_floor,
  }
}

export async function fetchPointCloud(
  params: OrbitalParameters,
  samples: number,
  seed: number,
  signal?: AbortSignal,
): Promise<PointCloudData> {
  const query = queryString({ ...params, samples, seed })
  const [response, metadata] = await Promise.all([
    fetch(`/api/orbitals/point-cloud?${query}`, { signal }),
    fetchMetadata(params, signal),
  ])
  if (!response.ok) {
    throw await responseError(response)
  }
  const buffer = await response.arrayBuffer()
  return { ...parsePointCloud(buffer, response.headers), metadata }
}

export async function fetchIsosurface(
  params: OrbitalParameters,
  resolution: number,
  probabilityMass: number,
  signal?: AbortSignal,
): Promise<IsosurfacePayload> {
  const query = queryString({ ...params, resolution, probability_mass: probabilityMass })
  const response = await fetch(`/api/orbitals/isosurface?${query}`, { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as IsosurfacePayload
}

export async function fetchCurrentField(
  params: OrbitalParameters,
  seedCount: number,
  signal?: AbortSignal,
): Promise<CurrentFieldPayload> {
  const query = queryString({ ...params, seed_count: seedCount })
  const response = await fetch(`/api/orbitals/current-field?${query}`, { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as CurrentFieldPayload
}

export async function fetchMetadata(
  params: OrbitalParameters,
  signal?: AbortSignal,
): Promise<OrbitalMetadata> {
  const response = await fetch(`/api/orbitals/metadata?${queryString(params)}`, { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as OrbitalMetadata
}

export async function fetchCatalog(signal?: AbortSignal): Promise<OrbitalPreset[]> {
  const response = await fetch('/api/orbitals/catalog', { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('orbital catalog must be an array')
  return payload.map(parseOrbitalPreset)
}

export async function fetchSuperpositionCatalog(
  signal?: AbortSignal,
): Promise<SuperpositionPreset[]> {
  const response = await fetch('/api/superposition/catalog', { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('superposition catalog must be an array')
  return payload.map(parseSuperpositionPreset)
}

/**
 * The `|Psi(t)|^2` level set of a superposition.
 *
 * Every parameter `/superposition/isosurface` accepts is sent explicitly.
 * A parameter left off the query is not an error the caller sees: the server
 * substitutes its own default (`basis=complex`, `z=1`, `a_mu=1`,
 * `probability_mass=0.90` on `/api/superposition/isosurface`) and returns a
 * perfectly valid picture of a state nobody asked for.
 */
export async function fetchSuperpositionIsosurface(
  terms: string,
  time: number,
  resolution: number,
  basis: BasisKind,
  z: number,
  aMu: number,
  probabilityMass: number,
  signal?: AbortSignal,
): Promise<SuperpositionIsosurfacePayload> {
  const query = queryString({
    terms,
    time,
    resolution,
    basis,
    z,
    a_mu: aMu,
    probability_mass: probabilityMass,
  })
  const response = await fetch(`/api/superposition/isosurface?${query}`, { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as SuperpositionIsosurfacePayload
}

/**
 * Probability-flow streamlines of a superposition at one instant, with the
 * continuity residual that says how far the rendered flow is from satisfying
 * `d(rho)/dt + div j = 0`.
 *
 * Same full-query rule as the isosurface route, over the parameter names
 * `/superposition/current-field` declares. `arc_step` is
 * deliberately not sent: the server's `None` default lets it choose a step
 * from the state's own extent, and a client-side number would override that
 * with a worse one.
 */
export async function fetchSuperpositionCurrentField(
  terms: string,
  time: number,
  seedCount: number,
  basis: BasisKind,
  z: number,
  aMu: number,
  signal?: AbortSignal,
): Promise<SuperpositionCurrentPayload> {
  const query = queryString({ terms, time, seed_count: seedCount, basis, z, a_mu: aMu })
  const response = await fetch(`/api/superposition/current-field?${query}`, { signal })
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as SuperpositionCurrentPayload
}

/**
 * Which state a slice describes, decided by the metadata it carries.
 *
 * `parseSlicePayload` proves the payload has metadata identifying an
 * eigenstate or a superposition, but it returns the union: only the caller
 * knows which route it asked. These two predicates close that gap without an
 * `as`, and they are worth having because the two payloads are otherwise
 * *identical* -- same grid, same frame, same samples -- so a superposition
 * answer served from the eigenstate route would render as a flawless picture
 * and only surface much later, as a missing `state` in the Inspector.
 */
function isEigenstateSlice(payload: AnySlicePayload): payload is SlicePayload {
  return 'state' in payload.metadata
}

function isSuperpositionSlice(payload: AnySlicePayload): payload is SuperpositionSlicePayload {
  return 'terms' in payload.metadata
}

/**
 * Decode, validate, and confirm the payload is the kind the route promised.
 *
 * The validation is not optional decoration: `src/api/schema.gen.ts` types the
 * wire format and cannot check it, so a transposed grid, a mirrored normal or
 * a mask that disagrees with its own reported fraction all type-check and then
 * render as a picture nobody can tell is wrong. `parseSlicePayload` is that
 * check, and this is the boundary it belongs at -- once past here the payload
 * is a scene.
 */
async function decodeSlice<T extends AnySlicePayload>(
  response: Response,
  kind: (payload: AnySlicePayload) => payload is T,
  expected: string,
): Promise<T> {
  if (!response.ok) {
    throw await responseError(response)
  }
  const payload = parseSlicePayload(await response.json())
  if (!kind(payload)) {
    throw new SliceContractError(
      'metadata',
      `must describe ${expected}, which is what this route returns`,
    )
  }
  return payload
}

/**
 * One scalar field of an eigenstate on a principal plane through the origin.
 *
 * Every parameter `/api/orbitals/slice` accepts is sent explicitly, for the
 * reason the superposition routes send theirs: a parameter left off the query
 * is not an error the caller sees. `plane` and `observable` both carry
 * server-side defaults (`xz`, `probability_density`), so a
 * dropped one returns a valid section of a different field with no complaint
 * at all. `a_mu` is here too -- this is the only eigenstate route that reads
 * it, and it rescales the derived extent and the amplitude scale the phase
 * mask is referenced to.
 *
 * The extent is derived from the state and reported back; it is deliberately
 * not a parameter.
 */
export async function fetchSlice(
  params: OrbitalParameters,
  resolution: number,
  aMu: number,
  plane: PrincipalPlane,
  observable: SliceObservable,
  signal?: AbortSignal,
): Promise<SlicePayload> {
  const query = queryString({ ...params, resolution, a_mu: aMu, plane, observable })
  const response = await fetch(`/api/orbitals/slice?${query}`, { signal })
  return decodeSlice(response, isEigenstateSlice, 'an eigenstate (a "state" field)')
}

/**
 * One scalar field of a superposition on a principal plane at one instant.
 *
 * Same full-query rule, over the names declared by `/api/superposition/slice`.
 */
export async function fetchSuperpositionSlice(
  terms: string,
  time: number,
  resolution: number,
  basis: BasisKind,
  z: number,
  aMu: number,
  plane: PrincipalPlane,
  observable: SliceObservable,
  signal?: AbortSignal,
): Promise<SuperpositionSlicePayload> {
  const query = queryString({
    terms,
    time,
    resolution,
    basis,
    z,
    a_mu: aMu,
    plane,
    observable,
  })
  const response = await fetch(`/api/superposition/slice?${query}`, { signal })
  return decodeSlice(response, isSuperpositionSlice, 'a superposition (a "terms" field)')
}
