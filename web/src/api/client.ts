import { parsePointCloud } from './qvpc'
import { parseSlicePayload, SliceContractError, type AnySlicePayload } from './sliceContract'
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
    throw new Error(await response.text())
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
    throw new Error(await response.text())
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
    throw new Error(await response.text())
  }
  return (await response.json()) as CurrentFieldPayload
}

export async function fetchMetadata(
  params: OrbitalParameters,
  signal?: AbortSignal,
): Promise<OrbitalMetadata> {
  const response = await fetch(`/api/orbitals/metadata?${queryString(params)}`, { signal })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return (await response.json()) as OrbitalMetadata
}

export async function fetchCatalog(signal?: AbortSignal): Promise<OrbitalPreset[]> {
  const response = await fetch('/api/orbitals/catalog', { signal })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return (await response.json()) as OrbitalPreset[]
}

export async function fetchSuperpositionCatalog(
  signal?: AbortSignal,
): Promise<SuperpositionPreset[]> {
  const response = await fetch('/api/superposition/catalog', { signal })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return (await response.json()) as SuperpositionPreset[]
}

/**
 * The `|Psi(t)|^2` level set of a superposition.
 *
 * Every parameter `/superposition/isosurface` accepts is sent explicitly.
 * A parameter left off the query is not an error the caller sees: the server
 * substitutes its own default (`basis=complex`, `z=1`, `a_mu=1`,
 * `probability_mass=0.90`, routes.py:301-308) and returns a perfectly valid
 * picture of a state nobody asked for.
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
    throw new Error(await response.text())
  }
  return (await response.json()) as SuperpositionIsosurfacePayload
}

/**
 * Probability-flow streamlines of a superposition at one instant, with the
 * continuity residual that says how far the rendered flow is from satisfying
 * `d(rho)/dt + div j = 0`.
 *
 * Same full-query rule as the isosurface route, over the parameter names
 * `/superposition/current-field` declares (routes.py:342-350). `arc_step` is
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
    throw new Error(await response.text())
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
    throw new Error(await response.text())
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
 * server-side defaults (`xz`, `probability_density`, routes.py:255-256), so a
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
 * Same full-query rule, over the names `/api/superposition/slice` declares
 * (routes.py:465-481).
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
