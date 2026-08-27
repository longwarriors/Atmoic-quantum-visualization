import { parsePointCloud } from './qvpc'
import type {
  BasisKind,
  CurrentFieldPayload,
  IsosurfacePayload,
  OrbitalMetadata,
  OrbitalParameters,
  OrbitalPreset,
  PointCloudData,
  SuperpositionCurrentPayload,
  SuperpositionIsosurfacePayload,
  SuperpositionPreset,
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
