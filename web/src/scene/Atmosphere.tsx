import { Grid, Stars } from '@react-three/drei'

interface AtmosphereProps {
  showGrid: boolean
  extent?: number
}

export function Atmosphere({ showGrid, extent = 8 }: AtmosphereProps) {
  const gridExtent = Math.max(extent, 4)
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[7, 9, 8]} intensity={1.6} color="#dff8ff" />
      <pointLight position={[-8, -3, -5]} intensity={8} distance={28} color="#8b5cf6" />
      <pointLight position={[7, 2, -7]} intensity={6} distance={26} color="#22d3ee" />
      <Stars radius={80} depth={20} count={420} factor={0.9} saturation={0.05} fade speed={0.08} />
      {showGrid ? (
        <Grid
          position={[0, -1.05 * gridExtent, 0]}
          args={[Math.min(2.4 * gridExtent, 100), Math.min(2.4 * gridExtent, 100)]}
          cellSize={1}
          cellThickness={0.45}
          cellColor="#284258"
          sectionSize={5}
          sectionThickness={0.7}
          sectionColor="#365f73"
          fadeDistance={24}
          fadeStrength={1.6}
          infiniteGrid
        />
      ) : null}
    </>
  )
}
