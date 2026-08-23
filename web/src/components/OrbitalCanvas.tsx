import { Bounds, OrbitControls, useBounds } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import * as THREE from 'three'

import { fetchCurrentField, fetchIsosurface, fetchPointCloud } from '../api/client'
import type {
  CurrentFieldPayload,
  IsosurfacePayload,
  PointCloudData,
  SceneStatus,
} from '../api/types'
import { Atmosphere } from '../scene/Atmosphere'
import { CurrentStreamlines } from '../scene/CurrentStreamlines'
import { ElectronCloud } from '../scene/ElectronCloud'
import { OrbitalSurface } from '../scene/OrbitalSurface'
import { useSceneStore } from '../state/useSceneStore'

interface OrbitalCanvasProps {
  onStatus: (status: SceneStatus) => void
}

function FitOnAssetChange({ asset, children }: { asset: object | null; children: ReactNode }) {
  const bounds = useBounds()
  const { camera } = useThree()

  const state =
    'metadata' in (asset ?? {})
      ? (asset as PointCloudData | IsosurfacePayload | CurrentFieldPayload).metadata.state
      : undefined

  useLayoutEffect(() => {
    if (!asset) return undefined
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
  }, [asset, bounds, camera, state?.basis, state?.l, state?.m])

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

  useEffect(() => {
    const controller = new AbortController()
    onStatus({ loading: true })
    setPointData(null)
    setSurfaceData(null)
    setCurrentData(null)
    if (representation === 'point_cloud') {
      fetchPointCloud(orbital, samples, seed, controller.signal)
        .then((data) => {
          setPointData(data)
          onStatus({
            loading: false,
            pointCount: data.count,
            radialMass: data.radialMass,
            extentBohr: data.extentBohr,
            metadata: data.metadata,
            warnings: data.metadata.warnings,
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            onStatus({ loading: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
    } else if (representation === 'streamlines') {
      fetchCurrentField(orbital, seedCount, controller.signal)
        .then((data) => {
          setCurrentData(data)
          onStatus({
            loading: false,
            lineCount: data.lines.length,
            maxSpeed: data.max_speed,
            continuityResidual: data.continuity_residual,
            extentBohr: data.extent_bohr,
            metadata: data.metadata,
            warnings: data.metadata.warnings,
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            onStatus({ loading: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
    } else {
      fetchIsosurface(orbital, resolution, probabilityMass, controller.signal)
        .then((data) => {
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
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            onStatus({ loading: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
    }
    return () => controller.abort()
  }, [
    onStatus,
    orbital,
    probabilityMass,
    representation,
    resolution,
    samples,
    seed,
    seedCount,
  ])

  const extent = pointData?.extentBohr ?? surfaceData?.extent_bohr ?? currentData?.extent_bohr

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
        <FitOnAssetChange asset={pointData ?? surfaceData ?? currentData}>
          {pointData ? <ElectronCloud data={pointData} pointSize={pointSize} opacity={opacity} /> : null}
          {surfaceData ? <OrbitalSurface data={surfaceData} opacity={opacity} /> : null}
          {currentData ? <CurrentStreamlines data={currentData} opacity={opacity} /> : null}
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
