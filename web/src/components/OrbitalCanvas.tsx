import { Bounds, OrbitControls, useBounds } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import * as THREE from 'three'

import type {
  BasisKind,
  OrbitalParameters,
  PrincipalPlane,
  RepresentationKind,
  SceneStatus,
  SliceObservable,
} from '../api/types'
import { Atmosphere } from '../scene/Atmosphere'
import {
  cameraDirectionFor,
  cameraDirectionForPlane,
  cameraUpForPlane,
  type CameraViewState,
} from '../scene/camera'
import { CurrentStreamlines } from '../scene/CurrentStreamlines'
import { ElectronCloud } from '../scene/ElectronCloud'
import { fogRangeFor } from '../scene/fog'
import { OrbitalSurface } from '../scene/OrbitalSurface'
import { SceneReady } from '../scene/SceneReady'
import { SliceField } from '../scene/SliceField'
import { useSceneStore, type SceneMode } from '../state/useSceneStore'
import {
  sceneExtentBohr,
  useSceneAsset,
  type SceneAsset,
  type SceneAssetInputs,
} from './useSceneAsset'

interface OrbitalCanvasProps {
  onStatus: (status: SceneStatus) => void
}

/** The colour depth fades into: the page's own background, so fog reads as distance. */
const FOG_COLOR = '#050a13'

/**
 * Closest the camera is ever placed to the nucleus when it is re-aimed.
 *
 * A camera sitting exactly at the origin has a zero-length position vector,
 * and normalising that gives NaN -- which puts the camera nowhere and blanks
 * the viewport.
 */
const MINIMUM_ORBIT_DISTANCE = 10

/**
 * Which way is up when nothing on screen argues for anything else.
 *
 * Written down because it has to be RESTORED, not merely defaulted: the camera
 * object outlives every asset, so an `up` a slice set and nobody cleared is a
 * permanent tilt on every scene drawn afterwards.
 */
const DEFAULT_CAMERA_UP: [number, number, number] = [0, 1, 0]

/**
 * How long drei's `Bounds` takes to ease the camera into a new scene's frame.
 *
 * Long enough to read as a move rather than a cut, which is the whole point:
 * without it the viewer cannot tell a re-framing from a different scene.
 */
const FIT_SECONDS = 0.8

/**
 * The same fit with the animation taken out.
 *
 * Zero does NOT mean "do not fit". `Bounds` advances the fit by
 * `delta / maxDuration` each frame and lands it the moment that reaches 1, so
 * zero lands it on the first frame that runs -- same end pose, no curve.
 */
const INSTANT_FIT_SECONDS = 0

/** The platform setting that means "stop animating things at me". */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The live media query for that setting, or null where there is nobody to ask.
 *
 * Reached through `globalThis` and tested with `typeof`, rather than read off a
 * bare `window`: outside a browser -- an SSR render, or a spec under vitest's
 * default `node` environment -- `window` is not an undefined value but an
 * undeclared identifier, and touching it is a ReferenceError that takes down
 * every module that imported this one. No platform to ask is not an error; it
 * is a viewer who has expressed no preference.
 */
function reducedMotionQuery(): MediaQueryList | null {
  if (typeof globalThis.matchMedia !== 'function') return null
  return globalThis.matchMedia(REDUCED_MOTION_QUERY)
}

/**
 * Whether the viewer has asked their platform to reduce motion -- LIVE.
 *
 * This is an accessibility setting first: a camera that swoops into every new
 * scene is exactly the kind of unrequested motion people turn this on to stop.
 * It is honoured as a subscription rather than a startup reading because it is
 * changed from the operating system's own controls, and a scene that sampled it
 * once would go on swooping until the page was reloaded.
 *
 * It also happens to be what makes the settled camera pose repeatable, which is
 * what the visual suite needs -- see the bootstrap note in e2e/slice.spec.ts.
 * That is a consequence and not the justification: the behaviour is the same
 * whether or not anybody is taking screenshots, which is the only version of it
 * worth trusting.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => reducedMotionQuery()?.matches === true)

  useEffect(() => {
    const query = reducedMotionQuery()
    if (query === null) return undefined
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    query.addEventListener('change', onChange)
    // Re-read rather than trust what the first render captured: the setting can
    // change between that render and this subscription, and nothing would ever
    // correct it -- from here on the listener reports CHANGES, not the state.
    setReduced(query.matches)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * Exactly the store fields a scene request reads, and nothing else.
 *
 * Spelled out rather than taken as the whole store type so that the list of
 * things that can change what the server is asked is visible in one place. The
 * store's own state satisfies it structurally, so `sceneAssetInputs` still
 * stops compiling if the store renames or drops one of them.
 */
export interface SceneInputSource {
  mode: SceneMode
  orbital: OrbitalParameters
  representation: RepresentationKind
  samples: number
  seed: number
  resolution: number
  probabilityMass: number
  seedCount: number
  superpositionTerms: string
  superpositionBasis: BasisKind
  superpositionZ: number
  aMu: number
  timeAu: number
  plane: PrincipalPlane
  sliceObservable: SliceObservable
}

/**
 * The store, as the request layer wants it.
 *
 * One translation, in one place. The canvas used to read the store and then
 * re-derive the request from `mode` and `representation` inline, with the
 * superposition's basis, charge and reduced mass hard-coded to the server's
 * defaults -- so the panel could describe one state while the server drew
 * another.
 */
export function sceneAssetInputs(state: SceneInputSource): SceneAssetInputs {
  return {
    mode: state.mode,
    // A plan carries ONE nuclear charge, and for a superposition request it is
    // read from `orbital.z`. The store keeps the two charges apart on purpose
    // (they describe different states), so the superposition's own charge is
    // substituted here; without this it never reaches the wire and the
    // time-dependent state is drawn at the eigenstate panel's charge.
    orbital:
      state.mode === 'superposition'
        ? { ...state.orbital, z: state.superpositionZ }
        : state.orbital,
    representation: state.representation,
    samples: state.samples,
    seed: state.seed,
    resolution: state.resolution,
    probabilityMass: state.probabilityMass,
    seedCount: state.seedCount,
    superpositionTerms: state.superpositionTerms,
    superpositionBasis: state.superpositionBasis,
    aMu: state.aMu,
    timeAu: state.timeAu,
    // The pair whose absence is SILENT. routes.py declares a default for each,
    // so a request that omits them is answered with a perfectly valid section
    // of a plane nobody asked for, carrying a field nobody asked for, while
    // the panel goes on displaying the choice the user made. Every other
    // missing parameter produces a 422 somebody can see.
    plane: state.plane,
    sliceObservable: state.sliceObservable,
  }
}

/**
 * The quantum state the camera should frame, or undefined when there isn't one.
 *
 * A superposition is a sum over states: it has no single (l, m) and therefore
 * no lobe axis to face, so it gets the neutral three-quarter view rather than
 * a viewpoint chosen from one arbitrary term.
 */
export function cameraViewOf(asset: SceneAsset | null): CameraViewState | undefined {
  if (asset === null) return undefined
  switch (asset.kind) {
    case 'point_cloud':
    case 'isosurface':
    case 'streamlines':
      return asset.data.metadata.state
    default:
      return undefined
  }
}

/**
 * The principal plane this asset is a section of, or undefined when it is not
 * a section at all.
 *
 * Read off the PAYLOAD rather than off the store, for `cameraViewOf`'s reason:
 * the store holds what was last asked for, and while a request is in flight
 * that is a different plane from the one on screen. Aiming at the store's
 * answer would face the camera at a plane that has not arrived.
 */
export function slicePlaneOf(asset: SceneAsset | null): PrincipalPlane | undefined {
  if (asset === null) return undefined
  switch (asset.kind) {
    case 'slice':
    case 'superposition_slice':
      return asset.data.plane
    default:
      return undefined
  }
}

/**
 * Put the camera on this state's canonical view direction, keeping the
 * distance the user has zoomed to.
 *
 * The direction itself comes from `src/scene/camera.ts` -- shared with the
 * tests that pin which orbitals deserve which viewpoint -- rather than from an
 * inline copy of the same `if` chain that could drift from it.
 */
export function aimCamera(
  camera: THREE.Camera,
  view: CameraViewState | undefined,
  plane?: PrincipalPlane,
): void {
  const distance = Math.max(camera.position.length(), MINIMUM_ORBIT_DISTANCE)
  const direction = new THREE.Vector3(
    ...(plane === undefined ? cameraDirectionFor(view) : cameraDirectionForPlane(plane)),
  )
  // ALWAYS set, in both arms. A slice needs the frame's own v axis as up --
  // partly so screen +Y is v and the picture is the grid the server sampled
  // rather than a rotation of it, and partly because the xz plane's normal is
  // -y, so looking down it with the default up hands lookAt two parallel
  // vectors and no basis to build from. Anything else needs that tilt GONE:
  // the camera outlives the asset, and an up set once and never cleared is a
  // tilt on every scene afterwards.
  camera.up.set(...(plane === undefined ? DEFAULT_CAMERA_UP : cameraUpForPlane(plane)))
  camera.position.copy(direction.normalize().multiplyScalar(distance))
  camera.lookAt(0, 0, 0)
}

/**
 * Frame the camera on a newly loaded scene -- once per scene, not once per
 * asset object.
 *
 * `fitKey` is the identity of the asset currently on screen, so it changes when
 * the scene does and stays put while playback swaps one time frame for the
 * next. Keying this on the asset object instead meant every arriving frame
 * teleported the camera back to the canonical direction and restarted an 0.8s
 * fit that the next frame interrupted.
 */
export function FitOnAssetChange({
  view,
  plane,
  fitKey,
  children,
}: {
  view: CameraViewState | undefined
  plane: PrincipalPlane | undefined
  fitKey: string | null
  children: ReactNode
}) {
  const bounds = useBounds()
  const { camera } = useThree()

  useLayoutEffect(() => {
    // Null until the first asset of this scene has arrived: there is nothing to
    // frame before that.
    if (fitKey === null) return undefined
    // ABANDON ANY FIT STILL IN FLIGHT, BEFORE TOUCHING THE CAMERA. `Bounds`
    // runs fits of its own -- one from its mount, and one on every canvas
    // resize, because it is mounted with `observe`. Each of those captures a
    // goal position and rotation from wherever the camera is AT THAT MOMENT and
    // then lands it from a `useFrame`, i.e. one or more frames later. Aim in
    // between the two and the landing quietly undoes the aim: it writes the
    // stale position and quaternion back over it, and leaves `up` alone,
    // because a `Bounds` goal carries no `up` at all. The result is a section
    // viewed down a direction nobody chose, with the plane's own up -- an
    // oblique parallelogram where a face-on square belongs. `refresh()` is what
    // discards that goal (it clears every `goal` field it has), so this is a
    // cancellation and not a duplicate of the measurement below.
    bounds.refresh()
    aimCamera(camera, view, plane)
    const frame = window.requestAnimationFrame(() => bounds.refresh().clip().fit())
    return () => window.cancelAnimationFrame(frame)
    // The view is compared field by field: it is a fresh object on every
    // render, and depending on the object would re-fit on every frame. `plane`
    // is a plain string and already compares by value.
  }, [bounds, camera, fitKey, plane, view?.basis, view?.l, view?.m])

  return children
}

/** Tone mapping and depth fog, both scaled to the scene actually on screen. */
export function RendererSettings({
  exposure,
  fogStrength,
  extent,
}: {
  exposure: number
  fogStrength: number
  extent?: number
}) {
  const { gl, scene } = useThree()

  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [exposure, gl])

  useEffect(() => {
    const range = fogRangeFor(extent, fogStrength)
    if (range === null) {
      // "No fog" and "fog you cannot reach" are different statements; the
      // shared module says which this is, and this clears rather than pushing
      // the distances to infinity.
      scene.fog = null
      return undefined
    }
    scene.fog = new THREE.Fog(FOG_COLOR, range.near, range.far)
    return () => {
      scene.fog = null
    }
  }, [extent, fogStrength, scene])

  return null
}

/**
 * The one thing on screen, drawn by whichever component draws that kind.
 *
 * A `switch` over the discriminated union rather than four independent
 * nullable slots: the old canvas rendered every non-null slot, so a scene
 * change that filled the new one before clearing the old drew two physically
 * different objects at the same time.
 */
export function SceneContent({
  asset,
  opacity,
  pointSize,
}: {
  asset: SceneAsset | null
  opacity: number
  pointSize: number
}) {
  if (asset === null) return null
  switch (asset.kind) {
    case 'point_cloud':
      return <ElectronCloud data={asset.data} pointSize={pointSize} opacity={opacity} />
    case 'isosurface':
    case 'superposition_isosurface':
      return <OrbitalSurface data={asset.data} opacity={opacity} />
    case 'slice':
    case 'superposition_slice':
      // One renderer for both, for the same reason the two current fields
      // share one below: the payloads differ only in metadata, and a second
      // component could drift from this one's orientation or colour space
      // with nothing failing.
      return <SliceField data={asset.data} />
    default:
      // Both current fields are the same observable with the same geometry, so
      // they share one renderer rather than two that could drift apart.
      return <CurrentStreamlines data={asset.data} opacity={opacity} />
  }
}

type SceneStoreState = ReturnType<typeof useSceneStore.getState>

interface SceneViewProps {
  state: SceneStoreState
  asset: SceneAsset | null
  fitKey: string | null
}

/**
 * The in-canvas view of an already coordinated scene.
 *
 * Keeping the fetched asset as an explicit input is important: the same asset
 * must drive both the object that is drawn and the post-processing decision in
 * `OrbitalCanvas`. The requested representation can lead the response while a
 * fetch is in flight, but this value always describes the frame on screen.
 */
function SceneView({ state, asset, fitKey }: SceneViewProps) {
  const extent = sceneExtentBohr(asset)
  const reducedMotion = usePrefersReducedMotion()

  return (
    <>
      <RendererSettings exposure={state.exposure} fogStrength={state.fogStrength} extent={extent} />
      <Atmosphere showGrid={state.showGrid} extent={extent} />
      {/* The two animations this scene runs on its own, both of which a viewer
          can ask it not to. The fit eases the camera into a new scene's frame;
          the damping keeps the controls coasting after a drag ends. Neither
          carries any information the still picture does not, which is why both
          collapse rather than degrade. */}
      <Bounds
        fit
        clip
        observe
        margin={1.35}
        maxDuration={reducedMotion ? INSTANT_FIT_SECONDS : FIT_SECONDS}
      >
        <FitOnAssetChange
          view={cameraViewOf(asset)}
          plane={slicePlaneOf(asset)}
          fitKey={fitKey}
        >
          <SceneContent asset={asset} opacity={state.opacity} pointSize={state.pointSize} />
        </FitOnAssetChange>
      </Bounds>
      <OrbitControls
        makeDefault
        enableDamping={!reducedMotion}
        dampingFactor={0.07}
        minDistance={2}
        maxDistance={90}
        autoRotate={state.autoRotate}
        autoRotateSpeed={0.34}
      />
      {/* Unconditional, with no environment gate: the scene's own statement
          that it has stopped moving, and the only thing the visual CI is
          allowed to wait on. */}
      <SceneReady fitKey={fitKey} />
    </>
  )
}

function useSceneModel(onStatus: OrbitalCanvasProps['onStatus']): SceneViewProps {
  const state = useSceneStore()
  const { asset, fitKey } = useSceneAsset(sceneAssetInputs(state), onStatus)
  return { state, asset, fitKey }
}

/**
 * Everything inside the canvas that does not need a GPU.
 *
 * Split out from `OrbitalCanvas` so the composition can be mounted under
 * `@react-three/test-renderer` and asserted on: the store reaches the request
 * layer here, the asset reaches the right component here, and the scene's own
 * extent reaches the fog and the grid here.
 */
export function SceneRoot({ onStatus }: OrbitalCanvasProps) {
  const model = useSceneModel(onStatus)
  return <SceneView {...model} />
}

/** Whether the frame actually on screen may use the presentation post chain. */
export function usesPresentationEffects(asset: SceneAsset | null): boolean {
  if (asset === null) return false
  switch (asset.kind) {
    case 'point_cloud':
    case 'isosurface':
    case 'superposition_isosurface':
      return false
    case 'slice':
    case 'superposition_slice':
    case 'streamlines':
    case 'superposition_streamlines':
      return true
  }

  // Compile-time fail-closed policy: a new asset kind must choose its colour
  // treatment explicitly instead of silently inheriting presentation effects.
  const unhandled: never = asset
  throw new Error(`usesPresentationEffects: unhandled asset ${String(unhandled)}`)
}

/**
 * The WebGL surface, and nothing else.
 *
 * Every decision this component used to make -- what to fetch, what to keep on
 * screen while the next frame loads, which component draws the answer, where
 * to put the camera, how far the fog reaches -- now lives in a module that can
 * be tested without a GPU. What is left here is the one part that genuinely
 * needs one.
 */
export function OrbitalCanvas({ onStatus }: OrbitalCanvasProps) {
  const model = useSceneModel(onStatus)
  // Point clouds and isosurfaces use the adjacent phase legend as a data key.
  // A full-frame bloom/vignette pass runs after material fog/tone-mapping
  // flags and would therefore recolour even an explicitly unlit data layer.
  // Keep that presentation chain off those two representations. Slice pixels
  // retain their separately baselined pipeline; streamlines retain the legacy
  // speed presentation until each receives the same representation-level
  // visual audit.
  // This MUST follow the arrived asset, not the store's requested
  // representation. During a cross-kind request the store leads the screen;
  // consulting it here would briefly recolour the old scientific frame (or
  // remove effects from the old presentation frame) before the response lands.
  const showPresentationEffects = usesPresentationEffects(model.asset)

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [10, 6, 12], fov: 42, near: 0.01, far: 500 }}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      }}
      shadows
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.0
      }}
    >
      <SceneView {...model} />
      {showPresentationEffects ? (
        /* Bloom and vignette read the rendered buffers back, so unlike
           everything above them they cannot exist without a real renderer. */
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={model.state.bloom}
            luminanceThreshold={0.56}
            luminanceSmoothing={0.46}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.18} darkness={0.76} />
        </EffectComposer>
      ) : null}
    </Canvas>
  )
}
