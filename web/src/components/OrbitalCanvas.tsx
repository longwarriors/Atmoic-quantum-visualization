import { Bounds, OrbitControls, useBounds } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { type ReactNode, useEffect, useLayoutEffect } from 'react'
import * as THREE from 'three'

import type {
  BasisKind,
  OrbitalParameters,
  RepresentationKind,
  SceneStatus,
} from '../api/types'
import { Atmosphere } from '../scene/Atmosphere'
import { cameraDirectionFor, type CameraViewState } from '../scene/camera'
import { CurrentStreamlines } from '../scene/CurrentStreamlines'
import { ElectronCloud } from '../scene/ElectronCloud'
import { fogRangeFor } from '../scene/fog'
import { OrbitalSurface } from '../scene/OrbitalSurface'
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
  superpositionAMu: number
  timeAu: number
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
    aMu: state.superpositionAMu,
    timeAu: state.timeAu,
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
 * Put the camera on this state's canonical view direction, keeping the
 * distance the user has zoomed to.
 *
 * The direction itself comes from `src/scene/camera.ts` -- shared with the
 * tests that pin which orbitals deserve which viewpoint -- rather than from an
 * inline copy of the same `if` chain that could drift from it.
 */
export function aimCamera(camera: THREE.Camera, view: CameraViewState | undefined): void {
  const distance = Math.max(camera.position.length(), MINIMUM_ORBIT_DISTANCE)
  const direction = new THREE.Vector3(...cameraDirectionFor(view))
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
  fitKey,
  children,
}: {
  view: CameraViewState | undefined
  fitKey: string | null
  children: ReactNode
}) {
  const bounds = useBounds()
  const { camera } = useThree()

  useLayoutEffect(() => {
    // Null until the first asset of this scene has arrived: there is nothing to
    // frame before that.
    if (fitKey === null) return undefined
    aimCamera(camera, view)
    const frame = window.requestAnimationFrame(() => bounds.refresh().clip().fit())
    return () => window.cancelAnimationFrame(frame)
    // The view is compared field by field: it is a fresh object on every
    // render, and depending on the object would re-fit on every frame.
  }, [bounds, camera, fitKey, view?.basis, view?.l, view?.m])

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
    default:
      // Both current fields are the same observable with the same geometry, so
      // they share one renderer rather than two that could drift apart.
      return <CurrentStreamlines data={asset.data} opacity={opacity} />
  }
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
  const state = useSceneStore()
  const { asset, fitKey } = useSceneAsset(sceneAssetInputs(state), onStatus)
  const extent = sceneExtentBohr(asset)

  return (
    <>
      <RendererSettings exposure={state.exposure} fogStrength={state.fogStrength} extent={extent} />
      <Atmosphere showGrid={state.showGrid} extent={extent} />
      <Bounds fit clip observe margin={1.35} maxDuration={0.8}>
        <FitOnAssetChange view={cameraViewOf(asset)} fitKey={fitKey}>
          <SceneContent asset={asset} opacity={state.opacity} pointSize={state.pointSize} />
        </FitOnAssetChange>
      </Bounds>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        minDistance={2}
        maxDistance={90}
        autoRotate={state.autoRotate}
        autoRotateSpeed={0.34}
      />
    </>
  )
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
  const bloom = useSceneStore((state) => state.bloom)

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
      <SceneRoot onStatus={onStatus} />
      {/* Bloom and vignette read the rendered buffers back, so unlike
          everything above them they cannot exist without a real renderer. */}
      <EffectComposer multisampling={0}>
        <Bloom intensity={bloom} luminanceThreshold={0.56} luminanceSmoothing={0.46} mipmapBlur />
        <Vignette eskil={false} offset={0.18} darkness={0.76} />
      </EffectComposer>
    </Canvas>
  )
}
