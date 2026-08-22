export type BasisKind = 'real' | 'complex'
export type RepresentationKind = 'point_cloud' | 'isosurface'

export interface OrbitalParameters {
  n: number
  l: number
  m: number
  z: number
  basis: BasisKind
}

export interface PointCloudData {
  count: number
  stride: number
  positions: Float32Array
  intensity: Float32Array
  phase: Float32Array
  radialMass: number
  extentBohr: number
}

export interface QuantumStateSpec {
  n: number
  l: number
  m: number
  z: number
  basis: BasisKind
}

export interface OrbitalMetadata {
  state: QuantumStateSpec
  label: string
  energy_hartree: number
  length_unit: string
  observable: string
  representation: string
  normalization: string
  coordinate_convention: string
  spherical_harmonic_convention: string
  references: string[]
  warnings: string[]
}

export interface IsosurfacePayload {
  metadata: OrbitalMetadata
  vertices: number[][]
  normals: number[][]
  faces: number[][]
  phase: number[]
  density_level: number
  requested_probability_mass: number
  captured_probability_mass: number
  grid_resolution: number
  extent_bohr: number
}

export interface OrbitalPreset extends OrbitalParameters {
  id: string
  label: string
}

export interface SceneStatus {
  loading: boolean
  error?: string
  pointCount?: number
  triangleCount?: number
  radialMass?: number
  extentBohr?: number
  densityLevel?: number
  warnings?: string[]
}
