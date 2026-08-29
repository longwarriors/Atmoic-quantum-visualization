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
 * it is the one part that genuinely requires a GPU. `SceneRoot` mounts the same
 * coordinated in-canvas view through `@react-three/test-renderer`, while the
 * shell tests below inspect the Canvas props and arrived-asset effects decision.
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
import type { BoundsProps, OrbitControlsProps } from '@react-three/drei'
import ReactThreeTestRenderer, { act } from '@react-three/test-renderer'
import { act as reactAct, createElement, type ReactElement } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PLANE_FRAMES, parseSlicePayload } from '../api/sliceContract'
import type {
  CurrentFieldPayload,
  IsosurfacePayload,
  OrbitalMetadata,
  PointCloudData,
  PrincipalPlane,
  SceneStatus,
  SlicePayload,
  SuperpositionCurrentPayload,
  SuperpositionIsosurfacePayload,
  SuperpositionMetadata,
  SuperpositionSlicePayload,
} from '../api/types'
import {
  cameraDirectionFor,
  cameraDirectionForPlane,
  cameraUpForPlane,
} from '../scene/camera'
import { fogRangeFor } from '../scene/fog'
import { SCENE_READY_ATTRIBUTE } from '../scene/SceneReady'
import { useSceneStore } from '../state/useSceneStore'
import { mount } from '../test/mount'
import {
  aimCamera,
  cameraViewOf,
  OrbitalCanvas,
  RendererSettings,
  SceneContent,
  SceneRoot,
  slicePlaneOf,
  usesPresentationEffects,
} from './OrbitalCanvas'
import { selectSceneRequestInputs as sceneAssetInputs } from './sceneRequest'
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
  history: [] as Record<string, unknown>[],
}))

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>()
  return {
    ...actual,
    Canvas: (props: Record<string, unknown>) => {
      canvasProps.current = props
      canvasProps.history.push(props)
      return null
    },
  }
})

/* --------------------------------------------------- the two animations */

/**
 * `Bounds` and `OrbitControls`, RECORDED AND THEN RENDERED FOR REAL.
 *
 * The `Canvas` stub above replaces its component because a `WebGLRenderer`
 * cannot exist here. These two are the opposite case: the camera fit's duration
 * and the controls' damping flag are the props under test, but the fit is also
 * what `useBounds` hands `FitOnAssetChange` and the controls are what moves the
 * camera -- so a stub that swallowed them would take the camera-aiming and
 * readiness tests in this file down with it. The wrapper records the props it
 * was handed and passes the same object to the real component, which is why
 * every other test here behaves exactly as it did before.
 */
const boundsProps = vi.hoisted(() => ({ current: null as { maxDuration?: number } | null }))
const controlsProps = vi.hoisted(() => ({
  current: null as { enableDamping?: boolean } | null,
}))

vi.mock('@react-three/drei', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/drei')>()
  // Imported here rather than taken from this file's own import: a mock factory
  // is hoisted above the imports, and reaching a binding that has not been
  // initialised yet is a TDZ error at module load.
  const { createElement: element } = await import('react')
  return {
    ...actual,
    Bounds: (props: BoundsProps) => {
      boundsProps.current = props
      return element(actual.Bounds, props)
    },
    OrbitControls: (props: OrbitControlsProps) => {
      controlsProps.current = props
      return element(actual.OrbitControls, props)
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
  canvasProps.history = []
  boundsProps.current = null
  controlsProps.current = null
  readyContainer?.remove()
  readyContainer = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ---------------------------------------------------------------- payloads */

const orbitalMetadata = (
  state: Omit<OrbitalMetadata['state'], 'a_mu'> & { a_mu?: number },
  representation: string,
): OrbitalMetadata => ({
  state: { a_mu: 1, ...state },
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

/**
 * A slice section, built as a raw record and pushed through the contract.
 *
 * Not cast into shape: a fixture the contract would refuse is a fixture no
 * renderer can ever be handed, so casting one would prove nothing about the
 * canvas's slice wiring. The frame comes from the contract's own frozen table
 * for the same reason -- a second copy of it here could drift with the code it
 * is supposed to hold still.
 */
const SLICE_RESOLUTION = 65
const SLICE_EXTENT_BOHR = 3.2

function sliceBody(plane: PrincipalPlane, superposition: boolean): Record<string, unknown> {
  const frame = PLANE_FRAMES[plane]
  const values: number[] = []
  for (let row = 0; row < SLICE_RESOLUTION; row += 1) {
    for (let col = 0; col < SLICE_RESOLUTION; col += 1) {
      values.push(col - 2 * row)
    }
  }
  return {
    layout: 'row_major_v_rows_u_columns',
    plane,
    slice_observable: 'wavefunction_real',
    resolution: SLICE_RESOLUTION,
    extent_bohr: SLICE_EXTENT_BOHR,
    spacing_bohr: (2 * SLICE_EXTENT_BOHR) / (SLICE_RESOLUTION - 1),
    origin_bohr: [0, 0, 0],
    u_axis: [...frame.u_axis],
    v_axis: [...frame.v_axis],
    normal: [...frame.normal],
    length_unit: 'bohr',
    value_unit: 'bohr^-3/2',
    masked_value_sentinel: 0,
    max_amplitude_on_plane: 0.31,
    metadata: superposition
      ? superpositionMetadata()
      : orbitalMetadata({ n: 2, l: 1, m: 0, z: 1, basis: 'real' }, 'slice'),
    values,
    valid_mask: null,
    phase_mask_relative_amplitude: null,
    phase_mask_amplitude_scale: null,
    phase_mask_amplitude_threshold: null,
    phase_mask_numeric_floor: null,
    phase_masked_fraction: null,
  }
}

const slice = (plane: PrincipalPlane = 'xz'): SlicePayload =>
  parseSlicePayload(sliceBody(plane, false)) as SlicePayload

const superpositionSlice = (plane: PrincipalPlane = 'xy'): SuperpositionSlicePayload =>
  parseSlicePayload(sliceBody(plane, true)) as SuperpositionSlicePayload

/* ------------------------------------------------------------------ fetch */

let requestedUrls: string[] = []

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function answerWith(body: unknown): void {
  requestedUrls = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    requestedUrls.push(String(input))
    return Promise.resolve(jsonResponse(body))
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
    // The readiness flag lands on the element the canvas sits in, and the test
    // renderer creates its canvas detached. Giving it a container is what makes
    // this harness the same shape as the real `<Canvas>`.
    beforeReturn: (created: HTMLCanvasElement) => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      container.appendChild(created)
      readyContainer = container
    },
  })
  await act(async () => undefined)
  return renderer
}

/** The container `mountScene` put the canvas in, for the readiness flag. */
let readyContainer: HTMLElement | null = null

const readyFlag = (): string | null =>
  readyContainer?.getAttribute(SCENE_READY_ATTRIBUTE) ?? null

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
      superpositionSliceResolutionFloor: 103,
      superpositionBasis: 'real',
      superpositionZ: 4,
      aMu: 0.999456,
      timeAu: 6.5,
      plane: 'yz',
      sliceObservable: 'phase',
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
      superpositionSliceResolutionFloor: 103,
      superpositionBasis: 'real',
      aMu: 0.999456,
      timeAu: 6.5,
      plane: 'yz',
      sliceObservable: 'phase',
    })
  })

  it('carries the slice"s plane and observable, which nothing else can supply', () => {
    useSceneStore.setState({ plane: 'xy', sliceObservable: 'wavefunction_imag' })

    // These two are the pair whose absence is SILENT: a request that omits
    // them is answered by routes.py with its own defaults -- a valid section
    // of a plane nobody asked for, carrying a field nobody asked for, while
    // the panel goes on displaying the choice the user made.
    const inputs = sceneAssetInputs(useSceneStore.getState())
    expect(inputs.plane).toBe('xy')
    expect(inputs.sliceObservable).toBe('wavefunction_imag')
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

  it('draws either slice as one textured quad', async () => {
    const stationary = await mountAsset({ kind: 'slice', data: slice() })
    expect(typesUnder(stationary)).toEqual(['Mesh'])
    await stationary.unmount()

    // Same renderer for both, for `CurrentStreamlines`' reason: the two
    // payloads differ only in metadata, and a second component for the
    // time-dependent one could drift from this one's orientation or colour
    // space without anything failing.
    const evolving = await mountAsset({
      kind: 'superposition_slice',
      data: superpositionSlice(),
    })
    expect(typesUnder(evolving)).toEqual(['Mesh'])
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

describe('slicePlaneOf', () => {
  it('reports the plane of either slice, and none for anything else', () => {
    // The plane is read off the PAYLOAD, not off the store: the store holds
    // what was last asked for, and while a request is in flight that is a
    // different plane from the one on screen -- which is exactly when aiming
    // the camera at the store's answer would face the wrong way.
    expect(slicePlaneOf({ kind: 'slice', data: slice('yz') })).toBe('yz')
    expect(
      slicePlaneOf({ kind: 'superposition_slice', data: superpositionSlice('xy') }),
    ).toBe('xy')
    expect(slicePlaneOf({ kind: 'isosurface', data: isosurface() })).toBeUndefined()
    expect(slicePlaneOf({ kind: 'point_cloud', data: pointCloud() })).toBeUndefined()
    expect(slicePlaneOf(null)).toBeUndefined()
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

  it('faces a slice down its own normal, with the frame"s v axis as up', () => {
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      const camera = new THREE.PerspectiveCamera()
      camera.position.set(0, 0, 20)

      aimCamera(camera, undefined, plane)

      const direction = new THREE.Vector3(...cameraDirectionForPlane(plane))
        .normalize()
        .multiplyScalar(20)
      expect(camera.position.x).toBeCloseTo(direction.x, 6)
      expect(camera.position.y).toBeCloseTo(direction.y, 6)
      expect(camera.position.z).toBeCloseTo(direction.z, 6)
      // `up` is not decoration on a slice view. The xz plane's normal is -y,
      // so the camera looks straight down the default up vector: lookAt has no
      // basis to build from there and the picture degenerates. The frame's own
      // v axis is also the only choice that puts screen +Y on v, which is what
      // makes the image the grid the server sampled rather than a rotation of
      // it.
      expect(camera.up.toArray()).toEqual(cameraUpForPlane(plane))
    }
  })

  it('restores the default up when the scene stops being a slice', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0, 20)
    aimCamera(camera, undefined, 'xz')
    expect(camera.up.toArray()).toEqual([0, 0, 1])

    // The literal transition: an xz slice on screen, then a point cloud. The
    // second call is handed exactly what the canvas would hand it -- the point
    // cloud's own view and no plane.
    aimCamera(camera, cameraViewOf({ kind: 'point_cloud', data: pointCloud() }))

    // Leaving the slice's up in place would tilt every subsequent scene: the
    // camera object outlives the asset, so a `up` set once and never cleared
    // is a permanent change to how every orbital afterwards is framed.
    expect(camera.up.toArray()).toEqual([0, 1, 0])
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
      aMu: 0.999456,
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

  it('turns the store into one slice request, draws it, and faces its plane', async () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'slice',
      orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
      resolution: SLICE_RESOLUTION,
      plane: 'yz',
      sliceObservable: 'wavefunction_real',
      aMu: 0.999456,
    })
    answerWith(sliceBody('yz', false))
    const camera = defaultCamera()

    const renderer = await mountScene(() => undefined, camera)

    const query = queryOf(urlFor('/api/orbitals/slice'))
    // The two parameters the server silently defaults if they are missing.
    expect(query.get('plane')).toBe('yz')
    expect(query.get('observable')).toBe('wavefunction_real')
    expect(typesUnder(renderer)).toContain('Mesh')
    // Face-on, down the plane's own normal, with the frame's v axis up.
    expect(camera.up.toArray()).toEqual(cameraUpForPlane('yz'))
    const facing = camera.position.clone().normalize()
    const expected = new THREE.Vector3(...cameraDirectionForPlane('yz')).normalize()
    expect(facing.x).toBeCloseTo(expected.x, 5)
    expect(facing.y).toBeCloseTo(expected.y, 5)
    expect(facing.z).toBeCloseTo(expected.z, 5)

    await renderer.unmount()
  })

  it('holds the slice"s pose once the frames have run, not only at the commit', async () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'slice',
      orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
      resolution: SLICE_RESOLUTION,
      plane: 'xz',
    })
    answerWith(sliceBody('xz', false))
    const camera = defaultCamera()

    const renderer = await mountScene(() => undefined, camera)
    // The test above reads the pose at the COMMIT, which is where `aimCamera`
    // has just put it -- and that is precisely the reading that cannot see this
    // failure. `Bounds` is mounted before any asset exists and starts a fit of
    // the empty scene from its own layout effect; that fit's goal is a snapshot
    // of the camera as it was BEFORE the aim, and it is landed from a
    // `useFrame`, i.e. one frame later. Measured against this scene before the
    // fix: the settled camera came to rest at (19.2135, 11.5281, 23.0562) --
    // 1.9214 times the `<Canvas>`'s own opening position (10, 6, 12) -- while
    // `up` stayed (0, 0, 1), because `Bounds` never carries an `up` in its goal.
    // That is a plane seen from the default three-quarter direction with the
    // section's own up: an oblique parallelogram instead of a face-on square,
    // and exactly what the first CI bootstrap drew for 1s2pz-t8.4-xz.
    await renderer.advanceFrames(240, 1 / 60)

    expect(camera.up.toArray()).toEqual(cameraUpForPlane('xz'))
    const facing = camera.position.clone().normalize()
    const expected = new THREE.Vector3(...cameraDirectionForPlane('xz')).normalize()
    expect(facing.x).toBeCloseTo(expected.x, 5)
    expect(facing.y).toBeCloseTo(expected.y, 5)
    expect(facing.z).toBeCloseTo(expected.z, 5)

    await renderer.unmount()
  })

  it('flags the container only once the scene has actually stopped moving', async () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'slice',
      orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
      resolution: SLICE_RESOLUTION,
      plane: 'xz',
    })
    answerWith(sliceBody('xz', false))

    const renderer = await mountScene(() => undefined)

    // Nothing yet: the asset has arrived but drei's Bounds is still animating
    // the fit, and no frame has run at all.
    expect(readyFlag()).toBeNull()

    // Long enough for the 0.8s fit and the control damping to finish at 60Hz.
    // The point of the flag is that the harness does not have to know that
    // number -- it waits for the attribute, and this is the one place the
    // frames are counted out by hand.
    await renderer.advanceFrames(240, 1 / 60)

    // The VALUE is the scene's identity, so a harness cannot be satisfied by a
    // previous scene's leftover flag.
    expect(readyFlag()).toContain('plane=xz')

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
    expect(statuses.at(-1)?.unavailable?.reason).toContain('point cloud')
    expect(typesUnder(renderer)).not.toContain('LineSegments')

    await renderer.unmount()
  })
})

/* ------------------------------------------------- the motion preference */

/**
 * The query the scene has to ask, spelled out HERE rather than imported.
 *
 * A typo in the media string is not an error anywhere: `matchMedia` answers any
 * syntactically invalid query with `matches: false`, so the feature would
 * simply never switch on and every test that imported the app's own constant
 * would agree with it. This literal is the second opinion.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** A `matchMedia` whose answer -- and whose change events -- this spec owns. */
interface MotionPreference {
  /** Every query string the app asked about, in order. */
  readonly asked: string[]
  /** The listeners currently registered, i.e. what the app has left behind. */
  readonly listeners: ReadonlySet<(event: MediaQueryListEvent) => void>
  /** Change the platform's answer and notify whoever is listening. */
  change(matches: boolean): Promise<void>
}

/**
 * Replace `matchMedia` for one test.
 *
 * jsdom implements `matchMedia`, but its lists are inert: `matches` is false
 * for every query and no change event is ever dispatched, so the "no
 * preference" arm is the only one it can express. Everything below that is
 * about a viewer who HAS a preference, or who changes it, needs a list that can
 * be driven -- and the listener set is the only place a leaked subscription is
 * visible from.
 */
function stubMotionPreference(matches: boolean): MotionPreference {
  const asked: string[] = []
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const list = {
    matches,
    media: REDUCED_MOTION_QUERY,
    addEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
      listeners.add(listener)
    },
    removeEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
      listeners.delete(listener)
    },
  }
  vi.stubGlobal('matchMedia', (query: string) => {
    asked.push(query)
    return list
  })
  return {
    asked,
    listeners,
    async change(next: boolean): Promise<void> {
      list.matches = next
      await act(async () => {
        for (const listener of [...listeners]) {
          listener({ matches: next } as MediaQueryListEvent)
        }
      })
    },
  }
}

describe('the viewer"s motion preference', () => {
  /** A scene that is up and answered -- these tests are about neither. */
  async function mountAnyScene(): Promise<Renderer> {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'isosurface',
      orbital: { n: 3, l: 2, m: 2, z: 1, basis: 'real' },
      resolution: 65,
      probabilityMass: 0.9,
    })
    answerWith(isosurface())
    return mountScene(() => undefined)
  }

  it('collapses the fit and the damping when the viewer asks for less motion', async () => {
    const preference = stubMotionPreference(true)

    const renderer = await mountAnyScene()

    // The question actually asked. Anything else and the preference is never
    // seen, silently, on every platform.
    expect(preference.asked).toContain(REDUCED_MOTION_QUERY)
    // Zero is not "do not fit": drei advances the fit by `delta / maxDuration`
    // per frame, so zero puts the camera at the fitted pose on the first frame
    // that runs it -- one step, one pose. 0.8 puts it somewhere along an easing
    // curve, and WHERE depends on which frame the picture was taken at.
    expect(boundsProps.current?.maxDuration).toBe(0)
    // Damping keeps integrating after the input that started it, so a scene
    // that is otherwise finished is still moving. Off, the controls hold the
    // pose they were given.
    expect(controlsProps.current?.enableDamping).toBe(false)

    await renderer.unmount()
  })

  it('keeps the eased fit and the damping when nothing asks for less', async () => {
    stubMotionPreference(false)

    const renderer = await mountAnyScene()

    // The other half of the accessibility claim: this is a preference being
    // honoured, not an animation being deleted. A viewer who did not ask still
    // gets the camera move that shows where the new scene came from.
    expect(boundsProps.current?.maxDuration).toBe(0.8)
    expect(controlsProps.current?.enableDamping).toBe(true)

    await renderer.unmount()
  })

  it('treats a platform that cannot be asked as one with no preference', async () => {
    // Not hypothetical: `matchMedia` is absent under vitest's default `node`
    // environment, and reading it off a bare `window` there is a ReferenceError
    // rather than an undefined -- which would take out every spec that imports
    // this module rather than degrading to the default behaviour.
    vi.stubGlobal('matchMedia', undefined)

    const renderer = await mountAnyScene()

    expect(boundsProps.current?.maxDuration).toBe(0.8)
    expect(controlsProps.current?.enableDamping).toBe(true)

    await renderer.unmount()
  })

  it('follows a preference that changes while the scene is on screen', async () => {
    const preference = stubMotionPreference(false)
    const renderer = await mountAnyScene()
    expect(boundsProps.current?.maxDuration).toBe(0.8)
    const before = objectsUnder(renderer).map((object) => object.uuid)

    await preference.change(true)

    // Read live, not once at mount: the setting is changed from the operating
    // system's own controls, and a scene that only sampled it at startup would
    // go on swooping until the page was reloaded.
    expect(boundsProps.current?.maxDuration).toBe(0)
    expect(controlsProps.current?.enableDamping).toBe(false)
    // A re-render, not a remount. Rebuilding the tree would throw away the
    // geometry and the textures the payload was turned into and re-upload them,
    // which is a visible flash for a setting that changed nothing about what is
    // being drawn.
    expect(objectsUnder(renderer).map((object) => object.uuid)).toEqual(before)

    await renderer.unmount()
  })

  it('stops listening for the preference when the scene goes away', async () => {
    const preference = stubMotionPreference(false)
    const renderer = await mountAnyScene()
    expect(preference.listeners.size).toBe(1)

    await renderer.unmount()

    // A listener left on the media list holds the unmounted tree's setState
    // forever: every later preference change re-renders a component that is no
    // longer on screen, and one canvas mount per navigation is one more leak.
    expect(preference.listeners.size).toBe(0)
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

  const childrenOf = (props: Record<string, unknown>): ReactElement[] => {
    const children = Array.isArray(props.children) ? props.children : [props.children]
    return children.filter((child): child is ReactElement => child !== null)
  }

  const assetOf = (props: Record<string, unknown>): SceneAsset | null => {
    const scene = (Array.isArray(props.children) ? props.children[0] : props.children) as ReactElement
    return (scene.props as { asset: SceneAsset | null }).asset
  }

  it('asks for the renderer the scene needs, and says so explicitly', async () => {
    useSceneStore.setState({ representation: 'isosurface' })
    answerWith(isosurface())
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
    useSceneStore.setState({ representation: 'isosurface' })
    answerWith(isosurface())
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
    useSceneStore.setState({
      mode: 'superposition',
      bloom: 0.42,
      representation: 'streamlines',
    })
    answerWith(superpositionCurrent())
    const { props, unmount } = await mountShell()

    const children = childrenOf(props)
    expect(children).toHaveLength(2)
    const composer = children[1]
    const effects = (composer.props as { children: ReactElement[] }).children
    expect((effects[0].props as { intensity: number }).intensity).toBe(0.42)

    await unmount()
  })

  it.each([
    ['point_cloud', { kind: 'point_cloud', data: pointCloud() }],
    ['isosurface', { kind: 'isosurface', data: isosurface() }],
    [
      'superposition_isosurface',
      { kind: 'superposition_isosurface', data: superpositionIsosurface() },
    ],
  ] as const)('keeps an arrived %s phase palette out of presentation effects', (_kind, asset) => {
    // The decision takes the discriminated response itself. A requested store
    // value is intentionally not an input: it can describe the next frame
    // while this one is still on screen.
    expect(usesPresentationEffects(asset)).toBe(false)
  })

  it('keeps the post chain aligned with the arrived frame during a delayed kind switch', async () => {
    useSceneStore.setState({ mode: 'superposition', representation: 'streamlines' })
    requestedUrls = []
    let requestCount = 0
    let resolveIsosurface: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      requestCount += 1
      if (requestCount === 1) return Promise.resolve(jsonResponse(superpositionCurrent()))
      return new Promise<Response>((resolve) => {
        resolveIsosurface = resolve
      })
    })

    const { props: firstFrame, unmount } = await mountShell()
    expect(assetOf(firstFrame)?.kind).toBe('superposition_streamlines')
    expect(childrenOf(firstFrame)).toHaveLength(2)

    const transitionStart = canvasProps.history.length
    await reactAct(async () => {
      useSceneStore.setState({ representation: 'isosurface' })
    })

    // React first commits the new request while the old response is still the
    // truthful frame. That commit must retain the old frame's composer. The
    // fetch effect then clears the viewport, at which point neither an object
    // nor a composer remains while the delayed response is pending.
    const transitionRenders = canvasProps.history.slice(transitionStart)
    const oldFrameCommit = transitionRenders.find(
      (props) => assetOf(props)?.kind === 'superposition_streamlines',
    )
    expect(oldFrameCommit).toBeDefined()
    expect(childrenOf(oldFrameCommit as Record<string, unknown>)).toHaveLength(2)
    expect(assetOf(canvasProps.current as Record<string, unknown>)).toBeNull()
    expect(childrenOf(canvasProps.current as Record<string, unknown>)).toHaveLength(1)
    expect(resolveIsosurface).toBeDefined()

    await reactAct(async () => {
      resolveIsosurface?.(jsonResponse(superpositionIsosurface()))
      await Promise.resolve()
    })

    const scientificFrame = canvasProps.current as Record<string, unknown>
    expect(assetOf(scientificFrame)?.kind).toBe('superposition_isosurface')
    expect(childrenOf(scientificFrame)).toHaveLength(1)

    await unmount()
  })
})
