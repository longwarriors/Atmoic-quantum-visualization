import { Bounds, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useState } from 'react'
import * as THREE from 'three'

import { fetchIsosurface, fetchPointCloud } from '../api/client'
import type { IsosurfacePayload, PointCloudData, SceneStatus } from '../api/types'
import { Atmosphere } from '../scene/Atmosphere'
import { ElectronCloud } from '../scene/ElectronCloud'
import { OrbitalSurface } from '../scene/OrbitalSurface'
import { useSceneStore } from '../state/useSceneStore'

interface OrbitalCanvasProps {
  onStatus: (status: SceneStatus) => void
}

export function OrbitalCanvas({ onStatus }: OrbitalCanvasProps) {
  const {
    orbital,
    representation,
    samples,
    seed,
    resolution,
    probabilityMass,
    pointSize,
    opacity,
    bloom,
    autoRotate,
    showGrid,
  } = useSceneStore()
  const [pointData, setPointData] = useState<PointCloudData | null>(null)
  const [surfaceData, setSurfaceData] = useState<IsosurfacePayload | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    onStatus({ loading: true })
    if (representation === 'point_cloud') {
      setSurfaceData(null)
      fetchPointCloud(orbital, samples, seed, controller.signal)
        .then((data) => {
          setPointData(data)
          onStatus({
            loading: false,
            pointCount: data.count,
            radialMass: data.radialMass,
            extentBohr: data.extentBohr,
          })
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            onStatus({ loading: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
    } else {
      setPointData(null)
      fetchIsosurface(orbital, resolution, probabilityMass, controller.signal)
        .then((data) => {
          setSurfaceData(data)
          onStatus({
            loading: false,
            triangleCount: data.faces.length,
            extentBohr: data.extent_bohr,
            densityLevel: data.density_level,
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
  ])

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
      <fog attach="fog" args={['#050a13', 28, 85]} />
      <Atmosphere showGrid={showGrid} />
      <Bounds fit clip observe margin={1.35} maxDuration={0.8}>
        {pointData ? <ElectronCloud data={pointData} pointSize={pointSize} opacity={opacity} /> : null}
        {surfaceData ? <OrbitalSurface data={surfaceData} opacity={opacity} /> : null}
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
