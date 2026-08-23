import { parsePointCloud } from './qvpc'
import type {
  IsosurfacePayload,
  OrbitalMetadata,
  OrbitalParameters,
  OrbitalPreset,
  PointCloudData,
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
