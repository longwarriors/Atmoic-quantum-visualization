export type BasisKind = 'real' | 'complex'
export type RepresentationKind = 'point_cloud' | 'isosurface' | 'streamlines'

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
  metadata: OrbitalMetadata
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
  geometry_semantics: string
  color_semantics: string
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
  finite_grid_density_integral: number
  grid_resolution: number
  grid_spacing_bohr: number
  integration_rule: string
  extent_bohr: number
}

export interface CurrentFieldPayload {
  metadata: OrbitalMetadata
  lines: number[][][]
  speed: number[][]
  seed_count: number
  max_speed: number
  arc_step_bohr: number
  seed_density_floor: number
  extent_bohr: number
  continuity_residual: number
  integration_rule: string
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
  capturedProbabilityMass?: number
  finiteGridDensityIntegral?: number
  gridResolution?: number
  gridSpacingBohr?: number
  lineCount?: number
  maxSpeed?: number
  continuityResidual?: number
  metadata?: OrbitalMetadata
  warnings?: string[]
}
