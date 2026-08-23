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

export interface IsosurfacePayload extends SurfaceGeometry {
  metadata: OrbitalMetadata
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

export interface SuperpositionTermSpec {
  n: number
  l: number
  m: number
  coefficient_real: number
  coefficient_imag: number
}

export interface SuperpositionMetadata {
  terms: SuperpositionTermSpec[]
  label: string
  basis: BasisKind
  time_au: number
  energy_expectation_hartree: number
  is_stationary: boolean
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

/** Geometry fields shared by the stationary and time-dependent isosurfaces. */
export interface SurfaceGeometry {
  vertices: number[][]
  normals: number[][]
  faces: number[][]
  phase: number[]
}

export interface SuperpositionIsosurfacePayload extends SurfaceGeometry {
  metadata: SuperpositionMetadata
  density_level: number
  requested_probability_mass: number
  captured_probability_mass: number
  finite_grid_density_integral: number
  grid_resolution: number
  grid_spacing_bohr: number
  integration_rule: string
  extent_bohr: number
}

export interface SuperpositionPreset {
  id: string
  label: string
  terms: string
  period_au: number
  note: string
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
  timeAu?: number
  superposition?: SuperpositionMetadata
  metadata?: OrbitalMetadata
  warnings?: string[]
}
