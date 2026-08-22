import { Grid, Stars } from '@react-three/drei'

interface AtmosphereProps {
  showGrid: boolean
}

export function Atmosphere({ showGrid }: AtmosphereProps) {
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[7, 9, 8]} intensity={2.2} color="#dff8ff" />
      <pointLight position={[-8, -3, -5]} intensity={55} distance={28} color="#8b5cf6" />
      <pointLight position={[7, 2, -7]} intensity={42} distance={26} color="#22d3ee" />
      <Stars radius={80} depth={20} count={700} factor={1.15} saturation={0.1} fade speed={0.1} />
      {showGrid ? (
        <Grid
          position={[0, -5.5, 0]}
          args={[30, 30]}
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
