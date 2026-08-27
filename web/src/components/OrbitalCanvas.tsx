import { Bounds, OrbitControls, useBounds } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import {
  fetchCurrentField,
  fetchIsosurface,
  fetchPointCloud,
  fetchSuperpositionIsosurface,
} from '../api/client'
import type {
  CurrentFieldPayload,
  IsosurfacePayload,
  PointCloudData,
  SceneStatus,
  SuperpositionIsosurfacePayload,
} from '../api/types'
import { Atmosphere } from '../scene/Atmosphere'
import { CurrentStreamlines } from '../scene/CurrentStreamlines'
import { ElectronCloud } from '../scene/ElectronCloud'
import { OrbitalSurface } from '../scene/OrbitalSurface'
import { useSceneStore } from '../state/useSceneStore'
import { createFetchCoordinator, sceneIdentityKey } from './sceneRequest'
import { statusFromCurrentField, statusFromSuperpositionIsosurface } from './sceneStatus'

interface OrbitalCanvasProps {
  onStatus: (status: SceneStatus) => void
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
function FitOnAssetChange({
  asset,
  fitKey,
  children,
}: {
  asset: object | null
  fitKey: string | null
  children: ReactNode
}) {
  const bounds = useBounds()
  const { camera } = useThree()

  const state =
    'metadata' in (asset ?? {}) && 'state' in (asset as { metadata: object }).metadata
      ? (asset as PointCloudData | IsosurfacePayload | CurrentFieldPayload).metadata.state
      : undefined

  useLayoutEffect(() => {
    // Null until the first asset of this scene has arrived: there is nothing to
    // frame before that.
    if (fitKey === null) return undefined
    const distance = Math.max(camera.position.length(), 10)
    let direction = new THREE.Vector3(1, 0.45, 1)
    if (state?.basis === 'real' && state.l === 1) {
      direction = state.m === 1 ? new THREE.Vector3(0, 0.35, 1) : new THREE.Vector3(1, 0.35, 0)
    } else if (state?.basis === 'real' && state.l === 2) {
      direction = [2, -2].includes(state.m)
        ? new THREE.Vector3(0, 0.35, 1)
        : new THREE.Vector3(1, 0.35, 0)
    }
    camera.position.copy(direction.normalize().multiplyScalar(distance))
    camera.lookAt(0, 0, 0)
    const frame = window.requestAnimationFrame(() => bounds.refresh().clip().fit())
    return () => window.cancelAnimationFrame(frame)
  }, [bounds, camera, fitKey, state?.basis, state?.l, state?.m])

  return children
}

function RendererSettings({
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
    if (fogStrength <= 0) {
      scene.fog = null
      return undefined
    }
    const scale = Math.max(extent ?? 8, 4)
    const near = scale * (3.0 - 1.5 * fogStrength)
    const far = scale * (8.0 - 4.0 * fogStrength)
    scene.fog = new THREE.Fog('#050a13', near, far)
    return () => {
      scene.fog = null
    }
  }, [extent, fogStrength, scene])

  return null
}

export function OrbitalCanvas({ onStatus }: OrbitalCanvasProps) {
  const {
    mode,
    superpositionTerms,
    timeAu,
    orbital,
    representation,
    samples,
    seed,
    resolution,
    probabilityMass,
    seedCount,
    pointSize,
    opacity,
    bloom,
    exposure,
    fogStrength,
    autoRotate,
    showGrid,
  } = useSceneStore()
  const [pointData, setPointData] = useState<PointCloudData | null>(null)
  const [surfaceData, setSurfaceData] = useState<IsosurfacePayload | null>(null)
  const [currentData, setCurrentData] = useState<CurrentFieldPayload | null>(null)
  const [superpositionData, setSuperpositionData] =
    useState<SuperpositionIsosurfacePayload | null>(null)
  const [renderedKey, setRenderedKey] = useState<string | null>(null)

  // Which physical object is on screen, as one string. Everything the fetches
  // below read is folded into it EXCEPT the time, which is why a time step can
  // leave the last frame up while the next one loads.
  const identityKey = sceneIdentityKey({
    mode,
    superpositionTerms,
    orbital,
    representation,
    samples,
    seed,
    resolution,
    probabilityMass,
    seedCount,
  })

  const [coordinator] = useState(createFetchCoordinator)
  const controllerRef = useRef<AbortController | null>(null)
  const identityRef = useRef<string | null>(null)

  // Unmount, and nothing else. The abort used to live in the fetch effect's
  // cleanup, which re-runs on every tick: each time step cancelled the request
  // the previous step had started, so a round trip slower than the clock
  // rendered nothing at all. Identity changes still abort, explicitly, below.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      // StrictMode unmounts and remounts once in development; the remount has
      // to treat the scene as new and fetch again.
      coordinator.reset()
    }
  }, [coordinator])

  // `identityKey` is a total function of every other fetch input, so it stands
  // for all of them here -- and it compares by value, where `orbital` is a
  // fresh object on every store write.
  useEffect(() => {
    identityRef.current = identityKey
    const decision = coordinator.onInputsChanged({ identityKey, timeAu })

    if (decision.abortPrevious) {
      controllerRef.current?.abort()
      controllerRef.current = null
    }
    if (decision.clearScene) {
      // Only a different physical object clears the viewport. A later moment of
      // the same one does not: the frame on screen stays true until its
      // successor arrives.
      onStatus({ loading: true })
      setRenderedKey(null)
      setPointData(null)
      setSurfaceData(null)
      setCurrentData(null)
      setSuperpositionData(null)
    }
    if (!decision.startFetch) return

    const requestKey = identityKey

    const startFetch = (time: number): void => {
      const controller = new AbortController()
      controllerRef.current = controller

      /** Accept a response only while it still describes the scene on screen. */
      const accept = (apply: () => void): void => {
        if (controller.signal.aborted || identityRef.current !== requestKey) return
        apply()
        setRenderedKey(requestKey)
        const { refetchTime } = coordinator.onResponse(time)
        if (refetchTime !== null) startFetch(refetchTime)
      }
      const fail = (error: unknown): void => {
        if (controller.signal.aborted || identityRef.current !== requestKey) return
        onStatus({ loading: false, error: error instanceof Error ? error.message : String(error) })
        const { refetchTime } = coordinator.onError(time)
        if (refetchTime !== null) startFetch(refetchTime)
      }

      if (mode === 'superposition') {
        // A superposition is a different physical object, not a display option,
        // so it is its own request rather than a re-render of the eigenstate.
        fetchSuperpositionIsosurface(superpositionTerms, time, 65, controller.signal)
          .then((data) =>
            accept(() => {
              setSuperpositionData(data)
              onStatus(statusFromSuperpositionIsosurface(data))
            }),
          )
          .catch(fail)
      } else if (representation === 'point_cloud') {
        fetchPointCloud(orbital, samples, seed, controller.signal)
          .then((data) =>
            accept(() => {
              setPointData(data)
              onStatus({
                loading: false,
                pointCount: data.count,
                radialMass: data.radialMass,
                extentBohr: data.extentBohr,
                metadata: data.metadata,
                warnings: data.metadata.warnings,
              })
            }),
          )
          .catch(fail)
      } else if (representation === 'streamlines') {
        fetchCurrentField(orbital, seedCount, controller.signal)
          .then((data) =>
            accept(() => {
              setCurrentData(data)
              onStatus(statusFromCurrentField(data))
            }),
          )
          .catch(fail)
      } else {
        fetchIsosurface(orbital, resolution, probabilityMass, controller.signal)
          .then((data) =>
            accept(() => {
              setSurfaceData(data)
              onStatus({
                loading: false,
                triangleCount: data.faces.length,
                extentBohr: data.extent_bohr,
                densityLevel: data.density_level,
                capturedProbabilityMass: data.captured_probability_mass,
                finiteGridDensityIntegral: data.finite_grid_density_integral,
                gridResolution: data.grid_resolution,
                gridSpacingBohr: data.grid_spacing_bohr,
                metadata: data.metadata,
                warnings: data.metadata.warnings,
              })
            }),
          )
          .catch(fail)
      }
    }

    startFetch(timeAu)
  }, [coordinator, identityKey, onStatus, timeAu])

  const extent =
    pointData?.extentBohr ??
    surfaceData?.extent_bohr ??
    currentData?.extent_bohr ??
    superpositionData?.extent_bohr

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
      <RendererSettings exposure={exposure} fogStrength={fogStrength} extent={extent} />
      <Atmosphere showGrid={showGrid} extent={extent} />
      <Bounds fit clip observe margin={1.35} maxDuration={0.8}>
        <FitOnAssetChange
          asset={pointData ?? surfaceData ?? currentData ?? superpositionData}
          fitKey={renderedKey}
        >
          {pointData ? <ElectronCloud data={pointData} pointSize={pointSize} opacity={opacity} /> : null}
          {surfaceData ? <OrbitalSurface data={surfaceData} opacity={opacity} /> : null}
          {currentData ? <CurrentStreamlines data={currentData} opacity={opacity} /> : null}
          {superpositionData ? <OrbitalSurface data={superpositionData} opacity={opacity} /> : null}
        </FitOnAssetChange>
      </Bounds>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        minDistance={2}
        maxDistance={90}
        autoRotate={autoRotate}
        autoRotateSpeed={0.34}
      />
      <EffectComposer multisampling={0}>
        <Bloom intensity={bloom} luminanceThreshold={0.56} luminanceSmoothing={0.46} mipmapBlur />
        <Vignette eskil={false} offset={0.18} darkness={0.76} />
      </EffectComposer>
    </Canvas>
  )
}
