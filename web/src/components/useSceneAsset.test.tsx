/** @vitest-environment jsdom */
/**
 * What the scene-orchestration hook promises, driven through a plain host
 * component with `fetch` stubbed.
 *
 * The hook is deliberately store-free: every input arrives as a prop, so the
 * behaviour below is pinned without a zustand store, a WebGL context or a
 * three.js scene anywhere in the harness. Specs cannot use JSX here (the
 * vitest config carries no React plugin, so esbuild compiles this file with
 * the classic runtime), hence `createElement`.
 *
 * The fetch stub hands back a promise the spec settles by hand. That is the
 * only way to observe the states that matter -- a request still in flight when
 * the inputs change again -- which is exactly where the old fetch effect got
 * it wrong.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { planSceneRequest } from '../api/capability'
import type {
  CurrentFieldPayload,
  IsosurfacePayload,
  OrbitalMetadata,
  SceneStatus,
  SuperpositionCurrentPayload,
  SuperpositionIsosurfacePayload,
  SuperpositionMetadata,
} from '../api/types'
import { mount } from '../test/mount'
import { nextTimeAu } from './sceneRequest'
import {
  executeSceneRequest,
  sceneExtentBohr,
  useSceneAsset,
  type SceneAsset,
  type SceneAssetInputs,
} from './useSceneAsset'

/* ------------------------------------------------------------------ fetch */

interface StubbedCall {
  url: string
  signal: AbortSignal | null
  settle: (response: unknown) => void
  fail: (error: unknown) => void
}

let calls: StubbedCall[] = []
/** When set, every request is answered immediately with what this returns. */
let responder: ((url: string) => unknown) | null = null

function installFetch(): void {
  calls = []
  responder = null
  const stub = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    let settle: (response: unknown) => void = () => undefined
    let fail: (error: unknown) => void = () => undefined
    const promise = new Promise<Response>((resolve, reject) => {
      settle = (response) => {
        resolve(response as Response)
      }
      fail = reject
    })
    calls.push({ url, signal: init?.signal ?? null, settle, fail })
    const auto = responder === null ? undefined : responder(url)
    if (auto !== undefined) settle(auto)
    return promise
  }
  vi.stubGlobal('fetch', stub)
}

const jsonOk = (body: unknown): unknown => ({
  ok: true,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const bufferOk = (buffer: ArrayBuffer, headers: Record<string, string>): unknown => ({
  ok: true,
  headers: { get: (name: string) => headers[name] ?? null },
  arrayBuffer: async () => buffer,
})

function queryValue(url: string, name: string): string | null {
  const query = url.slice(url.indexOf('?') + 1)
  for (const pair of query.split('&')) {
    const [key, value] = pair.split('=')
    if (key === name) return decodeURIComponent(value ?? '')
  }
  return null
}

/* --------------------------------------------------------------- fixtures */

/**
 * Resolved from the vitest root (web/) rather than from `import.meta.url`:
 * under the jsdom environment that URL is an http:// one, and
 * `fileURLToPath` on it throws "The URL must be of scheme file".
 */
const goldenBinary = resolve(process.cwd(), '..', 'tests', 'fixtures', 'qvpc_golden.bin')

function goldenBuffer(): ArrayBuffer {
  const bytes = readFileSync(goldenBinary)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const orbitalMetadata: OrbitalMetadata = {
  state: { n: 2, l: 1, m: 1, z: 1, basis: 'complex' },
  label: '2p(+1)',
  energy_hartree: -0.125,
  length_unit: 'bohr',
  observable: 'probability_density',
  normalization: 'unit norm',
  representation: 'point_cloud',
  coordinate_convention: 'right-handed Cartesian',
  spherical_harmonic_convention: 'Condon-Shortley',
  geometry_semantics: 'samples',
  color_semantics: 'phase',
  references: ['griffiths2018'],
  warnings: ['test warning'],
}

function superpositionMetadata(timeAu: number): SuperpositionMetadata {
  return {
    terms: [
      { n: 1, l: 0, m: 0, coefficient_real: 0.7071067811865476, coefficient_imag: 0 },
      { n: 2, l: 1, m: 0, coefficient_real: 0.7071067811865476, coefficient_imag: 0 },
    ],
    label: '1s + 2p_z',
    basis: 'complex',
    z: 1,
    a_mu: 1,
    reduced_mass_ratio: 1,
    time_au: timeAu,
    energy_expectation_hartree: -0.3125,
    is_stationary: false,
    length_unit: 'bohr',
    observable: 'probability_density',
    representation: 'isosurface',
    normalization: 'unit norm',
    coordinate_convention: 'right-handed Cartesian',
    spherical_harmonic_convention: 'Condon-Shortley',
    geometry_semantics: 'level set',
    color_semantics: 'phase',
    references: ['griffiths2018'],
    warnings: [],
  }
}

function superpositionIsosurface(timeAu: number): SuperpositionIsosurfacePayload {
  return {
    vertices: [[0, 0, 0]],
    normals: [[0, 0, 1]],
    faces: [[0, 0, 0]],
    phase: [0],
    metadata: superpositionMetadata(timeAu),
    density_level: 0.002,
    requested_probability_mass: 0.9,
    captured_probability_mass: 0.9,
    finite_grid_density_integral: 0.98,
    grid_resolution: 65,
    grid_spacing_bohr: 0.4,
    integration_rule: 'midpoint',
    extent_bohr: 13,
    finite_box_tail_mass_upper_bound: 0.01,
    finite_box_mass_variation_upper_bound: 0.02,
    finite_grid_phase_variation_bound: 0.03,
    finite_grid_aliasing_variation_lower_bound: 0.004,
    finite_grid_mass_error_lower_bound: 0.005,
    finite_grid_reporting_tolerance: 0.001,
    finite_grid_mass_status: 'phase_dependent_quadrature_error',
  }
}

function superpositionCurrent(timeAu: number): SuperpositionCurrentPayload {
  return {
    lines: [
      [
        [0, 0, 0],
        [0, 0, 1],
      ],
    ],
    speed: [[0.1, 0.2]],
    max_speed: 0.2,
    metadata: superpositionMetadata(timeAu),
    seed_count: 24,
    arc_step_bohr: 0.25,
    seed_density_floor: 1e-6,
    extent_bohr: 17,
    continuity_residual: 0.01,
    continuity_absolute_residual: 0.002,
    continuity_scale: 0.2,
    continuity_scale_kind: 'transition_coherence',
    continuity_probe_count: 512,
    continuity_phase_count: 8,
    density_rate_scale: 0.3,
    integration_rule: 'rk4',
  }
}

const eigenstateIsosurface: IsosurfacePayload = {
  vertices: [[0, 0, 0]],
  normals: [[0, 0, 1]],
  faces: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  phase: [0],
  metadata: orbitalMetadata,
  density_level: 0.003,
  requested_probability_mass: 0.9,
  captured_probability_mass: 0.89,
  finite_grid_density_integral: 0.97,
  grid_resolution: 65,
  grid_spacing_bohr: 0.35,
  integration_rule: 'midpoint',
  extent_bohr: 11,
}

const eigenstateCurrentField: CurrentFieldPayload = {
  lines: [
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
  ],
  speed: [[0.4, 0.5]],
  max_speed: 0.5,
  metadata: orbitalMetadata,
  seed_count: 48,
  arc_step_bohr: 0.2,
  seed_density_floor: 1e-7,
  extent_bohr: 9,
  continuity_residual: 0,
  continuity_absolute_residual: 0,
  continuity_scale: 1,
  continuity_scale_kind: 'stationary_current',
  continuity_probe_count: 256,
  integration_rule: 'rk4',
}

/**
 * The committed slice golden, resolved from the vitest root for the same
 * reason the QVPC binary is: under jsdom `import.meta.url` is an http:// URL.
 */
const sliceGoldenPath = resolve(process.cwd(), '..', 'tests', 'fixtures', 'slice_golden.json')
const SLICE_GOLDEN_TEXT = readFileSync(sliceGoldenPath, 'utf-8')

type MutableSlice = Record<string, unknown>

const eigenstateSlice = (): MutableSlice => JSON.parse(SLICE_GOLDEN_TEXT) as MutableSlice

function superpositionSlice(timeAu: number): MutableSlice {
  const payload = eigenstateSlice()
  payload.metadata = superpositionMetadata(timeAu)
  return payload
}

const baseInputs: SceneAssetInputs = {
  mode: 'eigenstate',
  orbital: { n: 2, l: 1, m: 1, z: 1, basis: 'complex' },
  representation: 'isosurface',
  samples: 28000,
  seed: 7,
  resolution: 65,
  probabilityMass: 0.9,
  seedCount: 48,
  superpositionTerms: '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476',
  superpositionBasis: 'complex',
  aMu: 1,
  timeAu: 0,
}

const superpositionInputs: SceneAssetInputs = { ...baseInputs, mode: 'superposition' }

const sliceInputs: SceneAssetInputs = {
  ...baseInputs,
  representation: 'slice',
  plane: 'xy',
  sliceObservable: 'phase',
}

/* -------------------------------------------------------------- the host */

interface Capture {
  current: { asset: SceneAsset | null; fitKey: string | null } | null
}

function Host({
  inputs,
  onStatus,
  capture,
}: {
  inputs: SceneAssetInputs
  onStatus: (status: SceneStatus) => void
  capture: Capture
}) {
  capture.current = useSceneAsset(inputs, onStatus)
  return null
}

function PlaybackHost({
  inputs,
  onStatus,
  tickMs,
}: {
  inputs: SceneAssetInputs
  onStatus: (status: SceneStatus) => void
  tickMs: number
}) {
  const [timeAu, setTimeAu] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setTimeAu((previous) => nextTimeAu(previous))
    }, tickMs)
    return () => {
      clearInterval(id)
    }
  }, [tickMs])
  useSceneAsset({ ...inputs, timeAu }, onStatus)
  return null
}

interface ActScope {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function host(inputs: SceneAssetInputs) {
  const capture: Capture = { current: null }
  const statuses: SceneStatus[] = []
  const onStatus = (status: SceneStatus): void => {
    statuses.push(status)
  }
  const element = (next: SceneAssetInputs = inputs) =>
    createElement(Host, { inputs: next, onStatus, capture })
  return { capture, statuses, onStatus, element }
}

const latest = (statuses: SceneStatus[]): SceneStatus => statuses[statuses.length - 1]

beforeEach(() => {
  ;(globalThis as ActScope).IS_REACT_ACT_ENVIRONMENT = true
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (globalThis as ActScope).IS_REACT_ACT_ENVIRONMENT
})

describe('useSceneAsset', () => {
  it('aborts the request in flight when the scene identity changes', async () => {
    const { capture, statuses, element } = host(baseInputs)
    const tree = await mount(element(baseInputs))
    expect(calls).toHaveLength(1)

    await tree.update(element({ ...baseInputs, orbital: { ...baseInputs.orbital, n: 3 } }))

    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(capture.current?.asset).toBeNull()
    expect(latest(statuses).loading).toBe(true)
    await tree.unmount()
  })

  it('treats a superposition basis change as a different scene', async () => {
    const { element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))

    await tree.update(element({ ...superpositionInputs, superpositionBasis: 'real' }))

    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(queryValue(calls[1].url, 'basis')).toBe('real')
    await tree.unmount()
  })

  it('does not abort the request in flight for a time step', async () => {
    const { element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))
    expect(calls).toHaveLength(1)

    await tree.update(element({ ...superpositionInputs, timeAu: 0.6 }))

    // The queued step waits for the answer that is already most of the way
    // there; aborting here is what made playback render nothing at all.
    expect(calls[0].signal?.aborted).toBe(false)
    expect(calls).toHaveLength(1)

    await act(async () => {
      calls[0].settle(jsonOk(superpositionIsosurface(0)))
    })

    expect(calls).toHaveLength(2)
    expect(queryValue(calls[1].url, 'time')).toBe('0.6')
    await tree.unmount()
  })

  it('runs the queued time step after the request in flight fails', async () => {
    const { statuses, element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))
    await tree.update(element({ ...superpositionInputs, timeAu: 0.6 }))

    await act(async () => {
      calls[0].fail(new Error('boom'))
    })

    expect(latest(statuses).error).toBe('boom')
    // A failure has to free the coordinator's slot, or one bad response stops
    // playback for good.
    expect(calls).toHaveLength(2)
    expect(queryValue(calls[1].url, 'time')).toBe('0.6')
    await tree.unmount()
  })

  it('reports a non-Error rejection as its own text', async () => {
    const { statuses, element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))

    await act(async () => {
      calls[0].fail('network down')
    })

    expect(latest(statuses).error).toBe('network down')
    expect(latest(statuses).loading).toBe(false)
    await tree.unmount()
  })

  it('asks the current-field route for superposition streamlines', async () => {
    const inputs: SceneAssetInputs = { ...superpositionInputs, representation: 'streamlines' }
    const { capture, statuses, element } = host(inputs)
    const tree = await mount(element(inputs))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith('/api/superposition/current-field')).toBe(true)
    expect(calls.some((call) => call.url.includes('isosurface'))).toBe(false)

    await act(async () => {
      calls[0].settle(jsonOk(superpositionCurrent(0)))
    })

    expect(capture.current?.asset?.kind).toBe('superposition_streamlines')
    const status = latest(statuses)
    expect(status.lineCount).toBe(1)
    expect(status.continuityScaleKind).toBe('transition_coherence')
    expect(status.continuityPhaseCount).toBe(8)
    expect(status.superposition?.time_au).toBe(0)
    expect(sceneExtentBohr(capture.current?.asset ?? null)).toBe(17)
    await tree.unmount()
  })

  it('refuses a superposition point cloud without issuing a request', async () => {
    const inputs: SceneAssetInputs = { ...superpositionInputs, representation: 'point_cloud' }
    const { capture, statuses, element } = host(inputs)
    const tree = await mount(element(inputs))

    expect(calls).toHaveLength(0)
    expect(capture.current?.asset).toBeNull()
    const status = latest(statuses)
    expect(status.loading).toBe(false)
    expect(status.unavailable?.kind).toBe('point_cloud')
    expect(status.unavailable?.reason).toContain('has not been built')
    await tree.unmount()
  })

  it('keeps the rendered frame and marks the status refreshing while a later time loads', async () => {
    const { capture, statuses, element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))
    await act(async () => {
      calls[0].settle(jsonOk(superpositionIsosurface(0)))
    })
    const rendered = capture.current?.asset
    expect(rendered?.kind).toBe('superposition_isosurface')
    expect(latest(statuses).renderedTimeAu).toBe(0)

    await tree.update(element({ ...superpositionInputs, timeAu: 0.6 }))

    expect(capture.current?.asset).toBe(rendered)
    const status = latest(statuses)
    expect(status.refreshing).toBe(true)
    expect(status.loading).toBe(false)
    expect(status.timeAu).toBe(0.6)
    // The diagnostics on screen still describe the frame on screen, and the
    // status says which time that is rather than the time we asked for.
    expect(status.renderedTimeAu).toBe(0)
    expect(status.densityLevel).toBe(0.002)
    await tree.unmount()
  })

  it('leaves a stationary eigenstate alone when the clock moves', async () => {
    const { element } = host(baseInputs)
    const tree = await mount(element(baseInputs))
    await act(async () => {
      calls[0].settle(jsonOk(eigenstateIsosurface))
    })
    expect(calls).toHaveLength(1)

    await tree.update(element({ ...baseInputs, timeAu: 0.6 }))

    // The eigenstate plan carries no time parameter, so the response cannot
    // depend on the clock: re-requesting it would be a 65^3 grid for nothing.
    expect(calls).toHaveLength(1)
    await tree.unmount()
  })

  it('reports an eigenstate isosurface with its grid diagnostics', async () => {
    const { capture, statuses, element } = host(baseInputs)
    const tree = await mount(element(baseInputs))
    await act(async () => {
      calls[0].settle(jsonOk(eigenstateIsosurface))
    })

    expect(capture.current?.asset?.kind).toBe('isosurface')
    expect(capture.current?.fitKey).not.toBeNull()
    const status = latest(statuses)
    expect(status.triangleCount).toBe(2)
    expect(status.gridResolution).toBe(65)
    expect(status.capturedProbabilityMass).toBe(0.89)
    expect(status.warnings).toEqual(['test warning'])
    expect(sceneExtentBohr(capture.current?.asset ?? null)).toBe(11)
    await tree.unmount()
  })

  it('reports an eigenstate current field with its continuity evidence', async () => {
    const inputs: SceneAssetInputs = { ...baseInputs, representation: 'streamlines' }
    const { capture, statuses, element } = host(inputs)
    const tree = await mount(element(inputs))
    expect(calls[0].url.startsWith('/api/orbitals/current-field')).toBe(true)

    await act(async () => {
      calls[0].settle(jsonOk(eigenstateCurrentField))
    })

    expect(capture.current?.asset?.kind).toBe('streamlines')
    const status = latest(statuses)
    expect(status.lineCount).toBe(1)
    expect(status.continuityScaleKind).toBe('stationary_current')
    expect(sceneExtentBohr(capture.current?.asset ?? null)).toBe(9)
    await tree.unmount()
  })

  it('reports a point cloud with its sample count and radial mass', async () => {
    const inputs: SceneAssetInputs = { ...baseInputs, representation: 'point_cloud' }
    const { capture, statuses, element } = host(inputs)
    const tree = await mount(element(inputs))
    expect(calls).toHaveLength(2)

    await act(async () => {
      calls[0].settle(
        bufferOk(goldenBuffer(), {
          'X-QuViz-Radial-Mass': '0.999999000',
          'X-QuViz-Extent-Bohr': '100.000000',
        }),
      )
      calls[1].settle(jsonOk(orbitalMetadata))
    })

    const asset = capture.current?.asset
    expect(asset?.kind).toBe('point_cloud')
    const status = latest(statuses)
    expect(status.pointCount).toBeGreaterThan(0)
    expect(status.radialMass).toBe(0.999999)
    expect(status.extentBohr).toBe(100)
    expect(status.metadata?.label).toBe('2p(+1)')
    expect(sceneExtentBohr(asset ?? null)).toBe(100)
    await tree.unmount()
  })

  it('asks the eigenstate slice route and reports the section it got back', async () => {
    const { capture, statuses, element } = host(sliceInputs)
    const tree = await mount(element(sliceInputs))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith('/api/orbitals/slice')).toBe(true)
    expect(queryValue(calls[0].url, 'plane')).toBe('xy')
    expect(queryValue(calls[0].url, 'observable')).toBe('phase')
    // The one eigenstate route that reads a_mu: it rescales the derived extent
    // and the amplitude scale the phase mask is referenced to.
    expect(queryValue(calls[0].url, 'a_mu')).toBe('1')

    await act(async () => {
      calls[0].settle(jsonOk(eigenstateSlice()))
    })

    expect(capture.current?.asset?.kind).toBe('slice')
    const status = latest(statuses)
    expect(status.plane).toBe('xy')
    expect(status.sliceObservable).toBe('phase')
    expect(status.sliceResolution).toBe(65)
    expect(status.phaseMaskedFraction).toBe(0)
    expect(status.metadata?.state.n).toBe(1)
    expect(sceneExtentBohr(capture.current?.asset ?? null)).toBeCloseTo(7.31228962362227, 12)
    await tree.unmount()
  })

  it('asks the superposition slice route and reports the instant it is a section of', async () => {
    const inputs: SceneAssetInputs = { ...sliceInputs, mode: 'superposition' }
    const { capture, statuses, element } = host(inputs)
    const tree = await mount(element(inputs))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith('/api/superposition/slice')).toBe(true)
    expect(queryValue(calls[0].url, 'plane')).toBe('xy')
    expect(queryValue(calls[0].url, 'time')).toBe('0')

    await act(async () => {
      calls[0].settle(jsonOk(superpositionSlice(0)))
    })

    expect(capture.current?.asset?.kind).toBe('superposition_slice')
    const status = latest(statuses)
    expect(status.superposition?.time_au).toBe(0)
    expect(status.sliceObservable).toBe('phase')
    expect(status.renderedTimeAu).toBe(0)
    await tree.unmount()
  })

  it('treats a different plane as a different scene', async () => {
    // The failure this pins is the quiet one: a plane change that did not
    // reach the identity key leaves the old section on screen, and an `xz`
    // section of a state is a perfectly convincing picture of the wrong thing.
    const { capture, element } = host(sliceInputs)
    const tree = await mount(element(sliceInputs))

    await tree.update(element({ ...sliceInputs, plane: 'xz' }))

    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(queryValue(calls[1].url, 'plane')).toBe('xz')
    expect(capture.current?.asset).toBeNull()
    await tree.unmount()
  })

  it('treats a different observable as a different scene', async () => {
    const { element } = host(sliceInputs)
    const tree = await mount(element(sliceInputs))

    await tree.update(element({ ...sliceInputs, sliceObservable: 'wavefunction_real' }))

    expect(calls).toHaveLength(2)
    expect(queryValue(calls[1].url, 'observable')).toBe('wavefunction_real')
    await tree.unmount()
  })

  it('treats a different reduced mass as a different scene', async () => {
    // a_mu is no longer a superposition-only appendage on the key: the
    // eigenstate slice route reads it, and a muonic Bohr length is a different
    // extent and a different mask threshold.
    const { element } = host(sliceInputs)
    const tree = await mount(element(sliceInputs))

    await tree.update(element({ ...sliceInputs, aMu: 0.0054 }))

    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(queryValue(calls[1].url, 'a_mu')).toBe('0.0054')
    await tree.unmount()
  })

  it('has no extent to report without an asset', () => {
    expect(sceneExtentBohr(null)).toBeUndefined()
  })

  it('aborts the request in flight when the component unmounts', async () => {
    const { element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))

    await tree.unmount()

    expect(calls[0].signal?.aborted).toBe(true)
  })

  it('aborts the request in flight when the scene becomes unavailable', async () => {
    const inputs: SceneAssetInputs = { ...superpositionInputs, representation: 'streamlines' }
    const { capture, statuses, element } = host(inputs)
    const tree = await mount(element(inputs))
    expect(calls).toHaveLength(1)

    await tree.update(element({ ...inputs, representation: 'point_cloud' }))

    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls).toHaveLength(1)
    expect(capture.current?.asset).toBeNull()
    expect(latest(statuses).unavailable?.kind).toBe('point_cloud')
    await tree.unmount()
  })

  it('ignores a failure that arrives after the scene has changed', async () => {
    const { statuses, element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))
    await tree.update(element({ ...superpositionInputs, superpositionBasis: 'real' }))

    await act(async () => {
      calls[0].fail(new Error('answer to a question nobody is asking'))
    })

    // The scene that request described is gone; reporting its failure would
    // put a red error over a picture that is loading perfectly well.
    expect(statuses.some((status) => status.error !== undefined)).toBe(false)
    await tree.unmount()
  })

  it('ignores an answer that arrives after the scene has changed', async () => {
    const { capture, element } = host(superpositionInputs)
    const tree = await mount(element(superpositionInputs))
    await tree.update(element({ ...superpositionInputs, superpositionBasis: 'real' }))

    await act(async () => {
      calls[0].settle(jsonOk(superpositionIsosurface(0)))
    })

    expect(capture.current?.asset).toBeNull()
    await tree.unmount()
  })

  it('revisits bit-identical times on every playback lap', async () => {
    vi.useFakeTimers()
    responder = () => jsonOk(superpositionIsosurface(0))
    const tree = await mount(
      createElement(PlaybackHost, {
        inputs: superpositionInputs,
        onStatus: () => undefined,
        tickMs: 10,
      }),
    )

    for (let tick = 0; tick < 140; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
    }

    const canonical: string[] = []
    let time = 0
    for (let frame = 0; frame < 66; frame += 1) {
      canonical.push(String(time))
      time = nextTimeAu(time)
    }
    expect(new Set(canonical).size).toBe(66)
    expect(time).toBe(0)

    const requested = calls.map((call) => queryValue(call.url, 'time'))
    expect(requested.length).toBeGreaterThan(100)
    // Every request asks for a time the lap will ask for again, spelled the
    // same way: accumulating 0.6 in a float instead would put 1.7999999999999998
    // on the wire and miss the cache forever.
    expect(requested.filter((value) => value !== null && !canonical.includes(value))).toEqual([])
    expect(new Set(requested).size).toBeLessThanOrEqual(66)
    expect(new Set(requested).size).toBeLessThan(requested.length)
    await tree.unmount()
  })
})

describe('executeSceneRequest', () => {
  it('reaches the endpoint the plan names, for every cell that has one', async () => {
    const cells: SceneAssetInputs[] = [
      { ...baseInputs, representation: 'point_cloud' },
      { ...baseInputs, representation: 'isosurface' },
      { ...baseInputs, representation: 'streamlines' },
      { ...baseInputs, representation: 'slice', plane: 'yz', sliceObservable: 'phase' },
      { ...superpositionInputs, representation: 'isosurface' },
      { ...superpositionInputs, representation: 'streamlines' },
      {
        ...superpositionInputs,
        representation: 'slice',
        plane: 'yz',
        sliceObservable: 'phase',
      },
    ]

    for (const inputs of cells) {
      calls = []
      const plan = planSceneRequest(inputs)
      if (plan.status !== 'available') throw new Error(`expected a plan for ${inputs.representation}`)
      void executeSceneRequest(plan, inputs, new AbortController().signal).catch(() => undefined)
      expect(calls.some((call) => call.url.startsWith(plan.endpoint))).toBe(true)
    }
  })

  it('refuses an endpoint no client fetcher serves', async () => {
    await expect(
      executeSceneRequest(
        { status: 'available', endpoint: '/api/orbitals/hologram', params: {}, latency: 'fast' },
        baseInputs,
        new AbortController().signal,
      ),
    ).rejects.toThrow('/api/orbitals/hologram')
  })

  it('refuses a plan that is missing a parameter its endpoint needs', async () => {
    await expect(
      executeSceneRequest(
        {
          status: 'available',
          endpoint: '/api/orbitals/isosurface',
          params: { probability_mass: 0.9 },
          latency: 'slow',
        },
        baseInputs,
        new AbortController().signal,
      ),
    ).rejects.toThrow('resolution')
  })

  /**
   * The enumerated counterpart of the missing-number case, and it fails closed
   * for a sharper reason: `plane` and `observable` have server-side defaults,
   * so a plan that forgot one would not 422 -- it would return a valid section
   * of a different field, and the panel would go on describing the section it
   * asked for.
   */
  it.each([
    ['plane', { resolution: 65, a_mu: 1, observable: 'phase' }],
    ['observable', { resolution: 65, a_mu: 1, plane: 'xy' }],
  ])('refuses a slice plan with no %s', async (missing, params) => {
    await expect(
      executeSceneRequest(
        {
          status: 'available',
          endpoint: '/api/orbitals/slice',
          params,
          latency: 'slow',
        },
        sliceInputs,
        new AbortController().signal,
      ),
    ).rejects.toThrow(missing)
  })

  it('refuses a slice plan naming a plane that is not a principal plane', async () => {
    await expect(
      executeSceneRequest(
        {
          status: 'available',
          endpoint: '/api/superposition/slice',
          params: { resolution: 65, a_mu: 1, time: 0, plane: 'xw', observable: 'phase' },
          latency: 'slow',
        },
        { ...sliceInputs, mode: 'superposition' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('xw')
  })
})
