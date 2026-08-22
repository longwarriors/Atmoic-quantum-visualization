import type {
  IsosurfacePayload,
  OrbitalMetadata,
  OrbitalParameters,
  OrbitalPreset,
  PointCloudData,
} from './types'

const HEADER_BYTES = 16
const EXPECTED_MAGIC = 'QVPC'

function queryString(params: Record<string, string | number>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => search.set(key, String(value)))
  return search.toString()
}

export function parsePointCloud(buffer: ArrayBuffer, headers: Headers): PointCloudData {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error('Point-cloud payload is shorter than the QVPC header.')
  }
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4))
  if (magic !== EXPECTED_MAGIC) {
    throw new Error(`Unexpected point-cloud magic: ${magic}`)
  }
  const view = new DataView(buffer)
  const version = view.getUint16(4, true)
  const count = view.getUint32(8, true)
  const stride = view.getUint32(12, true)
  if (version !== 1 || stride !== 5) {
    throw new Error(`Unsupported QVPC payload: version=${version}, stride=${stride}`)
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
    positions[target] = interleaved[source]
    positions[target + 1] = interleaved[source + 1]
    positions[target + 2] = interleaved[source + 2]
    intensity[index] = interleaved[source + 3]
    phase[index] = interleaved[source + 4]
  }
  return {
    count,
    stride,
    positions,
    intensity,
    phase,
    radialMass: Number(headers.get('X-QuViz-Radial-Mass') ?? 'NaN'),
    extentBohr: Number(headers.get('X-QuViz-Extent-Bohr') ?? 'NaN'),
  }
}

export async function fetchPointCloud(
  params: OrbitalParameters,
  samples: number,
  seed: number,
  signal?: AbortSignal,
): Promise<PointCloudData> {
  const query = queryString({ ...params, samples, seed })
  const response = await fetch(`/api/orbitals/point-cloud?${query}`, { signal })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  const buffer = await response.arrayBuffer()
  return parsePointCloud(buffer, response.headers)
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
