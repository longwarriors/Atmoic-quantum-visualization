/**
 * HTTP layer contract for `client.ts`, with `fetch` stubbed.
 *
 * The Python API tests exercise the routes with Starlette's TestClient, which
 * never executes a line of TypeScript: before this file existed, renaming the
 * point-cloud path in `client.ts` left `npm test` and `npm run build` green.
 * What is pinned here is exactly the part only the TypeScript side can get
 * wrong: the request path and query for each call, that the abort signal and
 * the response headers are passed through, and how HTTP and network failures
 * surface to the caller.
 *
 * Every response is built with the WHATWG `Response` / `Headers` classes that
 * Node provides, so the stub is exercised through the same `.ok`, `.text()`,
 * `.json()` and `.arrayBuffer()` surface the browser offers.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchCatalog,
  fetchCurrentField,
  fetchIsosurface,
  fetchMetadata,
  fetchPointCloud,
  fetchSuperpositionCatalog,
  fetchSuperpositionIsosurface,
  parsePointCloud,
} from './client'
import { parsePointCloud as parsePointCloudFromQvpc } from './qvpc'
import type { OrbitalMetadata, OrbitalParameters } from './types'

const goldenUrl = new URL('../../../tests/fixtures/qvpc_golden.bin', import.meta.url)
const goldenSpec = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../tests/fixtures/qvpc_golden.json', import.meta.url)), 'utf-8'),
) as { count: number }

function goldenBuffer(): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(goldenUrl))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const params: OrbitalParameters = { n: 3, l: 2, m: -1, z: 2, basis: 'complex' }

const metadata: OrbitalMetadata = {
  state: { ...params },
  label: '3d(-1)',
  energy_hartree: -0.2222,
  length_unit: 'bohr',
  observable: 'probability_density',
  representation: 'point_cloud',
  normalization: 'unit',
  coordinate_convention: 'physics',
  spherical_harmonic_convention: 'condon-shortley',
  geometry_semantics: 'samples',
  color_semantics: 'phase',
  references: ['griffiths2018'],
  warnings: [],
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const errorResponse = (text: string, status = 500): Response => new Response(text, { status })

/**
 * The rejection an HTTP error must surface as: an Error whose message *is* the
 * response body. Matched by equality, not substring -- V8's `JSON.parse`
 * error quotes the offending text (`"catalog offline" is not valid JSON`), so
 * a substring match passed even with the `response.ok` check deleted.
 */
const serverError = (body: string): Error => new Error(body)

const pointCloudResponse = (headers: Record<string, string> = {}): Response =>
  new Response(goldenBuffer(), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'X-QuViz-Radial-Mass': '0.999999000',
      'X-QuViz-Extent-Bohr': '100.000000',
      ...headers,
    },
  })

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>
let fetchMock: FetchMock

/** The `(url, init)` pair of the call whose path matches `pathname`. */
function requestTo(pathname: string): { url: URL; init: RequestInit | undefined } {
  const call = fetchMock.mock.calls.find(([input]) => {
    const url = new URL(String(input), 'http://unit.test')
    return url.pathname === pathname
  })
  if (call === undefined) {
    throw new Error(
      `no fetch call to ${pathname}; saw ${JSON.stringify(fetchMock.mock.calls.map((c) => String(c[0])))}`,
    )
  }
  return { url: new URL(String(call[0]), 'http://unit.test'), init: call[1] }
}

/** Route responses by pathname so a multi-request call can be stubbed in one place. */
function routeFetch(routes: Record<string, () => Response | Promise<Response>>): void {
  fetchMock.mockImplementation((input) => {
    const pathname = new URL(String(input), 'http://unit.test').pathname
    const handler = routes[pathname]
    if (handler === undefined) {
      return Promise.reject(new Error(`unstubbed fetch to ${pathname}`))
    }
    return Promise.resolve(handler())
  })
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client re-exports', () => {
  it('exposes the QVPC decoder unchanged', () => {
    expect(parsePointCloud).toBe(parsePointCloudFromQvpc)
  })
})

describe('fetchPointCloud', () => {
  it('requests the point-cloud and metadata routes with the orbital parameters, samples and seed', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': pointCloudResponse,
      '/api/orbitals/metadata': () => jsonResponse(metadata),
    })
    const controller = new AbortController()

    await fetchPointCloud(params, 20000, 7, controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const cloud = requestTo('/api/orbitals/point-cloud')
    expect(Object.fromEntries(cloud.url.searchParams)).toEqual({
      n: '3',
      l: '2',
      m: '-1',
      z: '2',
      basis: 'complex',
      samples: '20000',
      seed: '7',
    })
    expect(cloud.init).toEqual({ signal: controller.signal })
    const meta = requestTo('/api/orbitals/metadata')
    expect(Object.fromEntries(meta.url.searchParams)).toEqual({
      n: '3',
      l: '2',
      m: '-1',
      z: '2',
      basis: 'complex',
    })
    expect(meta.init).toEqual({ signal: controller.signal })
  })

  it('pins the exact request string the server routes on', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': pointCloudResponse,
      '/api/orbitals/metadata': () => jsonResponse(metadata),
    })

    await fetchPointCloud({ n: 1, l: 0, m: 0, z: 1, basis: 'real' }, 1000, 5)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/orbitals/point-cloud?n=1&l=0&m=0&z=1&basis=real&samples=1000&seed=5',
      { signal: undefined },
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/orbitals/metadata?n=1&l=0&m=0&z=1&basis=real', {
      signal: undefined,
    })
  })

  it('decodes the body through parsePointCloud and attaches the metadata', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': pointCloudResponse,
      '/api/orbitals/metadata': () => jsonResponse(metadata),
    })

    const result = await fetchPointCloud(params, 4, 0)

    const expected = parsePointCloudFromQvpc(
      goldenBuffer(),
      new Headers({ 'X-QuViz-Radial-Mass': '0.999999000', 'X-QuViz-Extent-Bohr': '100.000000' }),
    )
    expect(result.count).toBe(goldenSpec.count)
    expect(result.positions).toEqual(expected.positions)
    expect(result.intensity).toEqual(expected.intensity)
    expect(result.phase).toEqual(expected.phase)
    expect(result.metadata).toEqual(metadata)
  })

  it('passes the response headers into parsePointCloud', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': () =>
        pointCloudResponse({ 'X-QuViz-Radial-Mass': '0.750000000', 'X-QuViz-Extent-Bohr': '42.5' }),
      '/api/orbitals/metadata': () => jsonResponse(metadata),
    })

    const result = await fetchPointCloud(params, 4, 0)

    expect(result.radialMass).toBeCloseTo(0.75, 9)
    expect(result.extentBohr).toBeCloseTo(42.5, 9)
  })

  it('rejects with the header validation error when a transport header is out of range', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': () => pointCloudResponse({ 'X-QuViz-Radial-Mass': '1.5' }),
      '/api/orbitals/metadata': () => jsonResponse(metadata),
    })

    await expect(fetchPointCloud(params, 4, 0)).rejects.toThrow(
      /X-QuViz-Radial-Mass.*"1\.5".*outside \[0, 1\]/,
    )
  })

  it('rejects with the server error body on an HTTP error from the point-cloud route', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': () => errorResponse('{"detail":"l must be < n"}', 422),
      '/api/orbitals/metadata': () => jsonResponse(metadata),
    })

    await expect(fetchPointCloud(params, 4, 0)).rejects.toThrow(
      serverError('{"detail":"l must be < n"}'),
    )
  })

  it('rejects with the server error body on an HTTP error from the metadata route', async () => {
    routeFetch({
      '/api/orbitals/point-cloud': pointCloudResponse,
      '/api/orbitals/metadata': () => errorResponse('metadata unavailable', 503),
    })

    await expect(fetchPointCloud(params, 4, 0)).rejects.toThrow(serverError('metadata unavailable'))
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)

    await expect(fetchPointCloud(params, 4, 0)).rejects.toBe(failure)
  })
})

describe('fetchIsosurface', () => {
  const payload = { metadata, vertices: [], normals: [], faces: [], phase: [], density_level: 0.01 }

  it('requests the isosurface route with resolution and probability_mass', async () => {
    routeFetch({ '/api/orbitals/isosurface': () => jsonResponse(payload) })
    const controller = new AbortController()

    const result = await fetchIsosurface(params, 96, 0.9, controller.signal)

    const { url, init } = requestTo('/api/orbitals/isosurface')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      n: '3',
      l: '2',
      m: '-1',
      z: '2',
      basis: 'complex',
      resolution: '96',
      probability_mass: '0.9',
    })
    expect(init).toEqual({ signal: controller.signal })
    expect(result).toEqual(payload)
  })

  it('rejects with the server error body on an HTTP error', async () => {
    routeFetch({ '/api/orbitals/isosurface': () => errorResponse('grid too large', 422) })
    await expect(fetchIsosurface(params, 512, 0.9)).rejects.toThrow(serverError('grid too large'))
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    await expect(fetchIsosurface(params, 64, 0.9)).rejects.toBe(failure)
  })
})

describe('fetchCurrentField', () => {
  const payload = { metadata, lines: [], speed: [], seed_count: 0, max_speed: 0 }

  it('requests the current-field route with seed_count', async () => {
    routeFetch({ '/api/orbitals/current-field': () => jsonResponse(payload) })
    const controller = new AbortController()

    const result = await fetchCurrentField(params, 48, controller.signal)

    const { url, init } = requestTo('/api/orbitals/current-field')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      n: '3',
      l: '2',
      m: '-1',
      z: '2',
      basis: 'complex',
      seed_count: '48',
    })
    expect(init).toEqual({ signal: controller.signal })
    expect(result).toEqual(payload)
  })

  it('rejects with the server error body on an HTTP error', async () => {
    routeFetch({
      '/api/orbitals/current-field': () => errorResponse('real basis has no current', 422),
    })
    await expect(fetchCurrentField(params, 48)).rejects.toThrow(serverError('real basis has no current'))
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    await expect(fetchCurrentField(params, 48)).rejects.toBe(failure)
  })
})

describe('fetchMetadata', () => {
  it('requests the metadata route with only the orbital parameters', async () => {
    routeFetch({ '/api/orbitals/metadata': () => jsonResponse(metadata) })
    const controller = new AbortController()

    const result = await fetchMetadata(params, controller.signal)

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/orbitals/metadata?n=3&l=2&m=-1&z=2&basis=complex',
      { signal: controller.signal },
    )
    expect(result).toEqual(metadata)
  })

  it('rejects with the server error body on an HTTP error', async () => {
    routeFetch({ '/api/orbitals/metadata': () => errorResponse('not found', 404) })
    await expect(fetchMetadata(params)).rejects.toThrow(serverError('not found'))
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    await expect(fetchMetadata(params)).rejects.toBe(failure)
  })
})

describe('fetchCatalog', () => {
  const presets = [{ id: '1s', label: '1s', n: 1, l: 0, m: 0, z: 1, basis: 'real' }]

  it('requests the orbital catalog with no query', async () => {
    routeFetch({ '/api/orbitals/catalog': () => jsonResponse(presets) })
    const controller = new AbortController()

    const result = await fetchCatalog(controller.signal)

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/orbitals/catalog', {
      signal: controller.signal,
    })
    expect(result).toEqual(presets)
  })

  it('rejects with the server error body on an HTTP error', async () => {
    routeFetch({ '/api/orbitals/catalog': () => errorResponse('catalog offline', 500) })
    await expect(fetchCatalog()).rejects.toThrow(serverError('catalog offline'))
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    await expect(fetchCatalog()).rejects.toBe(failure)
  })
})

describe('fetchSuperpositionCatalog', () => {
  const presets = [{ id: 'sp', label: 'sp', terms: '2,0,0:1+0j;2,1,0:1+0j', period_au: 1, note: '' }]

  it('requests the superposition catalog with no query', async () => {
    routeFetch({ '/api/superposition/catalog': () => jsonResponse(presets) })
    const controller = new AbortController()

    const result = await fetchSuperpositionCatalog(controller.signal)

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/superposition/catalog', {
      signal: controller.signal,
    })
    expect(result).toEqual(presets)
  })

  it('rejects with the server error body on an HTTP error', async () => {
    routeFetch({ '/api/superposition/catalog': () => errorResponse('catalog offline', 500) })
    await expect(fetchSuperpositionCatalog()).rejects.toThrow(serverError('catalog offline'))
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    await expect(fetchSuperpositionCatalog()).rejects.toBe(failure)
  })
})

describe('fetchSuperpositionIsosurface', () => {
  const payload = { vertices: [], normals: [], faces: [], phase: [], density_level: 0.01 }
  const terms = '2,0,0:1+0j;2,1,0:0+1j'

  it('requests the superposition isosurface with the terms string URL-encoded', async () => {
    routeFetch({ '/api/superposition/isosurface': () => jsonResponse(payload) })
    const controller = new AbortController()

    const result = await fetchSuperpositionIsosurface(terms, 1.25, 64, controller.signal)

    const { url, init } = requestTo('/api/superposition/isosurface')
    // `+`, `;` and `:` must survive the round trip: a terms string that reaches
    // the server with its `+` decoded to a space is a different superposition.
    expect(url.searchParams.get('terms')).toBe(terms)
    expect(url.search).toBe(`?terms=${encodeURIComponent(terms).replace(/%20/g, '+')}&time=1.25&resolution=64`)
    expect(init).toEqual({ signal: controller.signal })
    expect(result).toEqual(payload)
  })

  it('rejects with the server error body on an HTTP error', async () => {
    routeFetch({
      '/api/superposition/isosurface': () => errorResponse('terms: unparsable', 422),
    })
    await expect(fetchSuperpositionIsosurface('nonsense', 0, 64)).rejects.toThrow(
      serverError('terms: unparsable'),
    )
  })

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('fetch failed')
    fetchMock.mockRejectedValue(failure)
    await expect(fetchSuperpositionIsosurface(terms, 0, 64)).rejects.toBe(failure)
  })
})
