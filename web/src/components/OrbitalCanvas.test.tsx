/** @vitest-environment jsdom */
/**
 * WHAT THIS SPEC PROVES: composition, not rendering.
 *
 * `OrbitalCanvas` is a shell. It owns no physics, derives no geometry and
 * decides nothing about fetching -- it wires the store to `useSceneAsset`, the
 * asset to the right scene component, and the scene's own extent to the fog and
 * the grid. Every assertion below is about that wiring: which module was handed
 * which value, which object ended up in the scene graph, which URL the store's
 * fields produced. NOTHING here claims that anything looks right, or indeed
 * that a single pixel is drawn -- there is no WebGL context in this process,
 * no frame is rendered, and visual claims belong to PR-8C's visual CI. A green
 * run of this file means the parts are connected, not that the picture is
 * correct.
 *
 * The `<Canvas>` element itself is deliberately outside what is exercised here:
 * it is the one part that genuinely requires a GPU. Everything under it lives
 * in `SceneRoot`, which `@react-three/test-renderer` can mount with no real
 * renderer -- so the shell is thin enough that testing its parts IS testing it.
 *
 * Harness facts from the T0 spike this file depends on: specs cannot use JSX
 * (vitest.config.ts declares no React plugin, so esbuild compiles with the
 * classic runtime and JSX dies with "React is not defined"), and
 * `renderer.scene.children[i]` is a `ReactThreeTestInstance` wrapper -- so
 * assertions read `.instance` and `.type`, never `instanceof`, which is false
 * across the test renderer's second copy of three. `jsdom` rather than the
 * config's default `node` environment because the scene reaches
 * `window.devicePixelRatio` and `window.requestAnimationFrame`.
 */
import ReactThreeTestRenderer, { act } from '@react-three/test-renderer'
import { createElement, type ReactElement } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CurrentFieldPayload,
  IsosurfacePayload,
  OrbitalMetadata,
  PointCloudData,
  SceneStatus,
  SuperpositionCurrentPayload,
  SuperpositionIsosurfacePayload,
  SuperpositionMetadata,
} from '../api/types'
import { cameraDirectionFor } from '../scene/camera'
import { fogRangeFor } from '../scene/fog'
import { useSceneStore } from '../state/useSceneStore'
import { mount } from '../test/mount'
import {
  aimCamera,
  cameraViewOf,
  OrbitalCanvas,
  RendererSettings,
  SceneContent,
  SceneRoot,
  sceneAssetInputs,
} from './OrbitalCanvas'
import type { SceneAsset } from './useSceneAsset'

/* --------------------------------------------------------- the GPU shell */

/**
 * `<Canvas>` is the one NO-GO in this file: it builds a real `WebGLRenderer`
 * against a real DOM canvas, which neither jsdom nor
 * `@react-three/test-renderer` can provide. It is therefore replaced at the
 * MODULE BOUNDARY -- and only it: every other export of
 * `@react-three/fiber` is passed through untouched, so the test renderer
 * (which imports `createRoot` and the r3f context from the same module, never
 * `Canvas`) still drives the real reconciler for every other test here.
 *
 * The stub records the props it was handed and renders nothing. That is
 * deliberate: what is being checked is the CONFIGURATION the shell hands the
 * renderer, not what the renderer would then draw with it.
 */
const canvasProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}))

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>()
  return {
    ...actual,
    Canvas: (props: Record<string, unknown>) => {
      canvasProps.current = props
      return null
    },
  }
})

/* ------------------------------------------------------------- act scope */

interface ActScope {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let restoreActEnvironment: () => void = () => undefined
const initialStore = useSceneStore.getState()

beforeEach(() => {
  const scope = globalThis as ActScope
  const had = 'IS_REACT_ACT_ENVIRONMENT' in scope
  const previous = scope.IS_REACT_ACT_ENVIRONMENT
  scope.IS_REACT_ACT_ENVIRONMENT = true
  restoreActEnvironment = () => {
    if (had) {
      scope.IS_REACT_ACT_ENVIRONMENT = previous
    } else {
      delete scope.IS_REACT_ACT_ENVIRONMENT
    }
  }
  useSceneStore.setState(initialStore, true)
})

afterEach(() => {
  restoreActEnvironment()
  useSceneStore.setState(initialStore, true)
  canvasProps.current = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ---------------------------------------------------------------- payloads */

const orbitalMetadata = (
  state: OrbitalMetadata['state'],
  representation: string,
): OrbitalMetadata => ({
  state,
  label: 'test state',
  energy_hartree: -0.125,
  length_unit: 'bohr',
  observable: 'test',
  representation,
  normalization: 'unit',
  coordinate_convention: 'physics',
  spherical_harmonic_convention: 'condon-shortley',
  geometry_semantics: 'test',
  color_semantics: 'test',
  references: [],
  warnings: [],
})

const superpositionMetadata = (): SuperpositionMetadata => ({
  terms: [{ n: 1, l: 0, m: 0, coefficient_real: 1, coefficient_imag: 0 }],
  label: 'test superposition',
  basis: 'complex',
  z: 1,
  a_mu: 1,
  reduced_mass_ratio: 1,
  time_au: 4,
  energy_expectation_hartree: -0.5,
  is_stationary: false,
  length_unit: 'bohr',
  observable: 'test',
  representation: 'test',
  normalization: 'unit',
  coordinate_convention: 'physics',
  spherical_harmonic_convention: 'condon-shortley',
  geometry_semantics: 'test',
  color_semantics: 'test',
  references: [],
  warnings: [],
})

const SURFACE = {
  vertices: [
    [0, 0, 0],
    [3, 0, 0],
    [0, 3, 0],
  ],
  normals: [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
  faces: [[0, 1, 2]],
  phase: [0, 1, 2],
}

const STREAMLINES = {
  lines: [
    [
      [0, 0, 0],
      [1, 1, 1],
      [2, 2, 2],
    ],
  ],
  speed: [[0, 1, 2]],
  max_speed: 2,
}

function pointCloud(): PointCloudData {
  return {
    count: 2,
    stride: 3,
    positions: new Float32Array([0, 0, 0, 1, 1, 1]),
    intensity: new Float32Array([1, 1]),
    phase: new Float32Array([0, 1]),
    radialMass: 0.9,
    extentBohr: 11,
    metadata: orbitalMetadata({ n: 2, l: 1, m: 1, z: 1, basis: 'real' }, 'point_cloud'),
  }
}

function isosurface(): IsosurfacePayload {
  return {
    ...SURFACE,
    metadata: orbitalMetadata({ n: 3, l: 2, m: 2, z: 1, basis: 'real' }, 'isosurface'),
    density_level: 0.002,
    requested_probability_mass: 0.9,
    captured_probability_mass: 0.9,
    finite_grid_density_integral: 0.999,
    grid_resolution: 65,
    grid_spacing_bohr: 0.4,
    integration_rule: 'trapezoid',
    extent_bohr: 17,
  }
}

function currentField(): CurrentFieldPayload {
  return {
    ...STREAMLINES,
    metadata: orbitalMetadata({ n: 2, l: 1, m: 1, z: 1, basis: 'complex' }, 'streamlines'),
    seed_count: 1,
    arc_step_bohr: 0.1,
    seed_density_floor: 1e-6,
    extent_bohr: 13,
    continuity_residual: 1e-9,
    continuity_absolute_residual: 1e-9,
    continuity_scale: 1,
    continuity_scale_kind: 'stationary_current',
    continuity_probe_count: 8,
    integration_rule: 'rk4',
  }
}

function superpositionIsosurface(): SuperpositionIsosurfacePayload {
  return {
    ...SURFACE,
    metadata: superpositionMetadata(),
    density_level: 0.002,
    requested_probability_mass: 0.9,
    captured_probability_mass: 0.9,
    finite_grid_density_integral: 0.999,
    grid_resolution: 65,
    grid_spacing_bohr: 0.4,
    integration_rule: 'trapezoid',
    extent_bohr: 19,
    finite_box_tail_mass_upper_bound: 1e-4,
    finite_box_mass_variation_upper_bound: 1e-4,
    finite_grid_phase_variation_bound: 1e-4,
    finite_grid_aliasing_variation_lower_bound: 1e-6,
    finite_grid_mass_error_lower_bound: 1e-6,
    finite_grid_reporting_tolerance: 1e-3,
    finite_grid_mass_status: 'no_error_above_tolerance_proven',
  }
}

function superpositionCurrent(): SuperpositionCurrentPayload {
  return {
    ...STREAMLINES,
    metadata: superpositionMetadata(),
    seed_count: 3,
    arc_step_bohr: 0.1,
    seed_density_floor: 1e-6,
    extent_bohr: 23,
    continuity_residual: 2e-9,
    continuity_absolute_residual: 2e-9,
    continuity_scale: 1,
    continuity_scale_kind: 'transition_coherence',
    continuity_probe_count: 8,
    continuity_phase_count: 4,
    density_rate_scale: 1,
    integration_rule: 'rk4',
  }
}

/* ------------------------------------------------------------------ fetch */

let requestedUrls: string[] = []

function answerWith(body: unknown): void {
  requestedUrls = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    requestedUrls.push(String(input))
    return Promise.resolve({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response)
  })
}

/** The one URL of this run that hit `endpoint`. */
const urlFor = (endpoint: string): string => {
  const found = requestedUrls.filter((url) => url.startsWith(endpoint))
  expect(found).toHaveLength(1)
  return found[0]
}

const queryOf = (url: string): URLSearchParams =>
  new URLSearchParams(url.slice(url.indexOf('?') + 1))

/* ---------------------------------------------------------------- harness */

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

/**
 * Mount the in-canvas scene and let the first response settle.
 *
 * The camera is handed in rather than defaulted because r3f keeps its camera
 * OUT of the scene graph -- there is no way to reach it through
 * `renderer.scene`, so a spec that wants to assert on where the camera ended
 * up has to own the object.
 */
async function mountScene(
  onStatus: (status: SceneStatus) => void,
  camera: THREE.PerspectiveCamera = defaultCamera(),
): Promise<Renderer> {
  const renderer = await ReactThreeTestRenderer.create(createElement(SceneRoot, { onStatus }), {
    camera,
  })
  await act(async () => undefined)
  return renderer
}

function defaultCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500)
  camera.position.set(10, 6, 12)
  return camera
}

const sceneOf = (renderer: Renderer): THREE.Scene => renderer.scene.instance as THREE.Scene

/**
 * Every three OBJECT anywhere under the scene, in tree order.
 *
 * `allChildren` is one level deep and includes attached instances (materials,
 * geometries), so this walks with `findAll` and then keeps only what is
 * actually in the scene graph -- `isObject3D` rather than `instanceof`, which
 * is false across the test renderer's second copy of three.
 */
const objectsUnder = (renderer: Renderer): THREE.Object3D[] =>
  renderer.scene
    .findAll(() => true)
    .map((child) => child.instance)
    .filter((object) => (object as { isObject3D?: boolean }).isObject3D === true)

const typesUnder = (renderer: Renderer): string[] =>
  objectsUnder(renderer).map((object) => object.type)

/* ------------------------------------------------- store -> hook inputs */

describe('sceneAssetInputs', () => {
  it('hands the request layer every field the store holds for it', () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      orbital: { n: 3, l: 2, m: -1, z: 2.5, basis: 'complex' },
      representation: 'isosurface',
      samples: 31000,
      seed: 11,
      resolution: 71,
      probabilityMass: 0.77,
      seedCount: 33,
      superpositionTerms: '1,0,0,1',
      superpositionBasis: 'real',
      superpositionZ: 4,
      superpositionAMu: 0.999456,
      timeAu: 6.5,
    })

    // The argument is the live store state: if the store renames or drops a
    // field this call stops type-checking, which is the point of taking the
    // whole snapshot rather than a hand-copied subset.
    expect(sceneAssetInputs(useSceneStore.getState())).toEqual({
      mode: 'eigenstate',
      orbital: { n: 3, l: 2, m: -1, z: 2.5, basis: 'complex' },
      representation: 'isosurface',
      samples: 31000,
      seed: 11,
      resolution: 71,
      probabilityMass: 0.77,
      seedCount: 33,
      superpositionTerms: '1,0,0,1',
      superpositionBasis: 'real',
      aMu: 0.999456,
      timeAu: 6.5,
    })
  })

  it('sends the superposition its OWN nuclear charge, not the eigenstate panel"s', () => {
    useSceneStore.setState({
      mode: 'superposition',
      orbital: { n: 3, l: 2, m: -1, z: 2.5, basis: 'complex' },
      superpositionZ: 4,
    })

    // A plan carries one z, and for a superposition it is `orbital.z` -- so the
    // store's separate superposition charge has to be substituted here or it
    // never reaches the wire and the time-dependent state is drawn at the
    // eigenstate panel's charge instead.
    expect(sceneAssetInputs(useSceneStore.getState()).orbital.z).toBe(4)
    expect(sceneAssetInputs(useSceneStore.getState()).orbital.n).toBe(3)
  })

  it('leaves the eigenstate charge alone in eigenstate mode', () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      orbital: { n: 3, l: 2, m: -1, z: 2.5, basis: 'complex' },
      superpositionZ: 4,
    })

    expect(sceneAssetInputs(useSceneStore.getState()).orbital.z).toBe(2.5)
  })
})

/* --------------------------------------------------- asset -> component */

describe('SceneContent', () => {
  const mountAsset = async (asset: SceneAsset | null): Promise<Renderer> =>
    ReactThreeTestRenderer.create(
      createElement(SceneContent, { asset, opacity: 0.8, pointSize: 3 }),
    )

  it('draws nothing at all while there is no asset', async () => {
    const renderer = await mountAsset(null)
    expect(renderer.scene.allChildren).toHaveLength(0)
    await renderer.unmount()
  })

  it('draws a point cloud as points', async () => {
    const renderer = await mountAsset({ kind: 'point_cloud', data: pointCloud() })
    expect(typesUnder(renderer)).toEqual(['Points'])
    await renderer.unmount()
  })

  it('draws either isosurface as a surface mesh', async () => {
    const stationary = await mountAsset({ kind: 'isosurface', data: isosurface() })
    expect(typesUnder(stationary)).toEqual(['Group', 'Mesh'])
    await stationary.unmount()

    const evolving = await mountAsset({
      kind: 'superposition_isosurface',
      data: superpositionIsosurface(),
    })
    expect(typesUnder(evolving)).toEqual(['Group', 'Mesh'])
    await evolving.unmount()
  })

  it('draws either current field through the one streamline component', async () => {
    const stationary = await mountAsset({ kind: 'streamlines', data: currentField() })
    expect(typesUnder(stationary)).toEqual(['LineSegments'])
    await stationary.unmount()

    // The whole reason `CurrentStreamlines` is typed on `StreamlineGeometry`:
    // a time-dependent current field is the same observable and must not get a
    // second renderer that could drift from this one.
    const evolving = await mountAsset({
      kind: 'superposition_streamlines',
      data: superpositionCurrent(),
    })
    expect(typesUnder(evolving)).toEqual(['LineSegments'])
    await evolving.unmount()
  })

  it('never has two physically different objects on screen at once', async () => {
    const renderer = await mountAsset({ kind: 'isosurface', data: isosurface() })
    expect(typesUnder(renderer)).toEqual(['Group', 'Mesh'])

    // The old canvas kept four independent state slots and rendered every
    // non-null one, so a scene change that filled the new slot before clearing
    // the old drew both. A discriminated union cannot express that.
    await renderer.update(
      createElement(SceneContent, {
        asset: { kind: 'streamlines', data: currentField() },
        opacity: 0.8,
        pointSize: 3,
      }),
    )
    expect(typesUnder(renderer)).toEqual(['LineSegments'])

    await renderer.unmount()
  })
})

/* --------------------------------------------------------- camera aiming */

describe('cameraViewOf', () => {
  it('reports the quantum state of an eigenstate asset', () => {
    // The payload's own state object, not a copy: whatever the server said the
    // frame is IS what the camera is aimed at.
    expect(cameraViewOf({ kind: 'point_cloud', data: pointCloud() })).toMatchObject({
      basis: 'real',
      l: 1,
      m: 1,
    })
    expect(cameraViewOf({ kind: 'isosurface', data: isosurface() })).toMatchObject({
      basis: 'real',
      l: 2,
      m: 2,
    })
    expect(cameraViewOf({ kind: 'streamlines', data: currentField() })).toMatchObject({
      basis: 'complex',
      l: 1,
      m: 1,
    })
  })

  it('reports no state for a superposition, which has no single (l, m)', () => {
    // A superposition is a sum over states; there is no lobe axis to face, so
    // the neutral three-quarter view is the only honest one.
    expect(cameraViewOf({ kind: 'superposition_isosurface', data: superpositionIsosurface() })).toBeUndefined()
    expect(cameraViewOf({ kind: 'superposition_streamlines', data: superpositionCurrent() })).toBeUndefined()
    expect(cameraViewOf(null)).toBeUndefined()
  })
})

describe('aimCamera', () => {
  it('puts the camera on the canonical direction for the state, at its own distance', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(10, 6, 12)
    const distance = camera.position.length()

    aimCamera(camera, { basis: 'real', l: 1, m: 1 })

    const expected = new THREE.Vector3(...cameraDirectionFor({ basis: 'real', l: 1, m: 1 }))
      .normalize()
      .multiplyScalar(distance)
    expect(camera.position.x).toBeCloseTo(expected.x, 6)
    expect(camera.position.y).toBeCloseTo(expected.y, 6)
    expect(camera.position.z).toBeCloseTo(expected.z, 6)
    // The user's own zoom is preserved: only the direction is chosen for them.
    expect(camera.position.length()).toBeCloseTo(distance, 6)
  })

  it('takes the direction from the shared camera module, for every state it knows', () => {
    for (const view of [
      undefined,
      { basis: 'complex', l: 1, m: 1 } as const,
      { basis: 'real', l: 1, m: 0 } as const,
      { basis: 'real', l: 2, m: -2 } as const,
      { basis: 'real', l: 2, m: 1 } as const,
      { basis: 'real', l: 3, m: 0 } as const,
    ]) {
      const camera = new THREE.PerspectiveCamera()
      camera.position.set(0, 0, 20)
      aimCamera(camera, view)
      const expected = new THREE.Vector3(...cameraDirectionFor(view)).normalize().multiplyScalar(20)
      expect(camera.position.x).toBeCloseTo(expected.x, 6)
      expect(camera.position.y).toBeCloseTo(expected.y, 6)
      expect(camera.position.z).toBeCloseTo(expected.z, 6)
    }
  })

  it('holds the camera off the nucleus when it starts at the origin', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0, 0)

    aimCamera(camera, undefined)

    // A zero-length position would normalise to NaN and put the camera nowhere.
    expect(camera.position.length()).toBeCloseTo(10, 6)
  })
})

/* --------------------------------------------------------------- the fog */

describe('RendererSettings', () => {
  const mountSettings = async (
    exposure: number,
    fogStrength: number,
    extent?: number,
  ): Promise<Renderer> =>
    ReactThreeTestRenderer.create(
      createElement(RendererSettings, { exposure, fogStrength, extent }),
    )

  it('takes its fog distances from the shared fog module', async () => {
    const renderer = await mountSettings(1, 0.4, 20)
    const fog = sceneOf(renderer).fog as THREE.Fog

    const expected = fogRangeFor(20, 0.4)
    expect(expected).not.toBeNull()
    expect(fog.near).toBeCloseTo(expected?.near ?? -1, 6)
    expect(fog.far).toBeCloseTo(expected?.far ?? -1, 6)

    await renderer.unmount()
  })

  it('states no fog at all, rather than fog nobody can reach, at zero strength', async () => {
    const renderer = await mountSettings(1, 0, 20)

    expect(sceneOf(renderer).fog).toBeNull()

    await renderer.unmount()
  })

  it('clears the fog it set when it goes away', async () => {
    const renderer = await mountSettings(1, 0.4, 20)
    const scene = sceneOf(renderer)
    expect(scene.fog).not.toBeNull()

    await renderer.unmount()

    expect(scene.fog).toBeNull()
  })
})

/* ----------------------------------------------------------- composition */

describe('SceneRoot', () => {
  it('turns the store into one superposition streamline request and draws its answer', async () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      superpositionTerms: '1,0,0,0.6;2,1,1,0.8',
      superpositionBasis: 'real',
      superpositionZ: 2,
      superpositionAMu: 0.999456,
      seedCount: 17,
      timeAu: 4,
      orbital: { n: 2, l: 1, m: 1, z: 9, basis: 'complex' },
    })
    answerWith(superpositionCurrent())
    const statuses: SceneStatus[] = []

    const renderer = await mountScene((status) => statuses.push(status))

    const query = queryOf(urlFor('/api/superposition/current-field'))
    // Every one of these came from a store field. A missing parameter is not
    // an error the user sees: the server substitutes its own default and
    // returns a valid picture of a state nobody asked for.
    expect(query.get('terms')).toBe('1,0,0,0.6;2,1,1,0.8')
    expect(query.get('basis')).toBe('real')
    expect(query.get('z')).toBe('2')
    expect(query.get('a_mu')).toBe('0.999456')
    expect(query.get('seed_count')).toBe('17')
    expect(query.get('time')).toBe('4')

    expect(typesUnder(renderer)).toContain('LineSegments')
    expect(statuses.at(-1)?.lineCount).toBe(1)

    await renderer.unmount()
  })

  it('scales fog and grid to the extent of the asset that actually arrived', async () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      fogStrength: 0.4,
      showGrid: true,
    })
    answerWith(superpositionCurrent())

    const renderer = await mountScene(() => undefined)
    const extent = superpositionCurrent().extent_bohr

    // 23 bohr, from the payload -- not the 8-bohr stand-in the scene uses
    // before anything has arrived. Fog and grid are depth cues, and a cue
    // scaled to the wrong object is a lie about how big the object is.
    const expected = fogRangeFor(extent, 0.4)
    expect((sceneOf(renderer).fog as THREE.Fog).near).toBeCloseTo(expected?.near ?? -1, 6)
    const grid = objectsUnder(renderer).find(
      (object) =>
        ((object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined)?.type ===
        'PlaneGeometry',
    )
    expect(grid?.position.y).toBeCloseTo(-1.05 * extent, 6)

    await renderer.unmount()
  })

  it('aims the camera by the arrived state, once the first frame is up', async () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'isosurface',
      orbital: { n: 3, l: 2, m: 2, z: 1, basis: 'real' },
      resolution: 65,
      probabilityMass: 0.9,
    })
    answerWith(isosurface())
    const camera = defaultCamera()

    const renderer = await mountScene(() => undefined, camera)

    // The payload says basis 'real', l = 2, m = 2 -- lobes in the xy-plane, so
    // the shared camera module puts the viewer on +z.
    const direction = new THREE.Vector3(
      ...cameraDirectionFor({ basis: 'real', l: 2, m: 2 }),
    ).normalize()
    const actual = camera.position.clone().normalize()
    expect(actual.x).toBeCloseTo(direction.x, 5)
    expect(actual.y).toBeCloseTo(direction.y, 5)
    expect(actual.z).toBeCloseTo(direction.z, 5)

    await renderer.unmount()
  })

  it('says why a closed cell is empty, and asks the server nothing', async () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'point_cloud',
    })
    answerWith(superpositionCurrent())
    const statuses: SceneStatus[] = []

    const renderer = await mountScene((status) => statuses.push(status))

    // Disabled with a stated reason, never hidden -- and never turned into a
    // 422 from a route that was always going to refuse it.
    expect(requestedUrls).toEqual([])
    expect(statuses.at(-1)?.unavailable?.kind).toBe('point_cloud')
    expect(statuses.at(-1)?.unavailable?.reason).toContain('point-cloud')
    expect(typesUnder(renderer)).not.toContain('LineSegments')

    await renderer.unmount()
  })
})

/* ---------------------------------------------------------- the GPU shell */

describe('OrbitalCanvas', () => {
  /** Mount the shell and hand back the props its `<Canvas>` was given. */
  async function mountShell(): Promise<{
    props: Record<string, unknown>
    unmount: () => Promise<void>
  }> {
    const tree = await mount(createElement(OrbitalCanvas, { onStatus: () => undefined }))
    const props = canvasProps.current
    expect(props).not.toBeNull()
    return { props: props as Record<string, unknown>, unmount: () => tree.unmount() }
  }

  it('asks for the renderer the scene needs, and says so explicitly', async () => {
    const { props, unmount } = await mountShell()

    expect(props.shadows).toBe(true)
    // Capped at 2: a 3x display costs nine times the fill for no more
    // information, and this scene is fill-bound.
    expect(props.dpr).toEqual([1, 2])
    expect(props.camera).toMatchObject({ position: [10, 6, 12], fov: 42, near: 0.01, far: 500 })
    expect(props.gl).toMatchObject({
      antialias: true,
      alpha: true,
      // The screenshot path reads the drawing buffer back after the frame is
      // composited, which is empty unless it is preserved.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })

    await unmount()
  })

  it('puts the renderer in sRGB with filmic tone mapping the moment it exists', async () => {
    const { props, unmount } = await mountShell()
    const gl = { outputColorSpace: '', toneMapping: -1, toneMappingExposure: -1 }

    ;(props.onCreated as (state: { gl: typeof gl }) => void)({ gl })

    // Colour space is not decoration: an untagged renderer writes linear
    // values into an sRGB framebuffer and every phase colour comes out wrong.
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace)
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping)
    expect(gl.toneMappingExposure).toBe(1)

    await unmount()
  })

  it('hands the canvas the scene and the post chain, with bloom from the store', async () => {
    useSceneStore.setState({ bloom: 0.42 })
    const { props, unmount } = await mountShell()

    const children = props.children as ReactElement[]
    expect(children).toHaveLength(2)
    const composer = children[1]
    const effects = (composer.props as { children: ReactElement[] }).children
    expect((effects[0].props as { intensity: number }).intensity).toBe(0.42)

    await unmount()
  })
})
