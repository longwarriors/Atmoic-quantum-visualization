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
  const view = new DataView(buffer)
  const version = view.getUint16(4, true)
  const count = view.getUint32(8, true)
  const stride = view.getUint32(12, true)
  if (version !== SUPPORTED_VERSION || stride !== EXPECTED_STRIDE) {
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
