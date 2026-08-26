export type BasisKind = 'real' | 'complex'
export type RepresentationKind = 'point_cloud' | 'isosurface' | 'streamlines'
export type ContinuityScaleKind =
  | 'transition_coherence'
  | 'stationary_current'
  | 'analytic_zero_current'
export type FiniteGridMassStatus =
  | 'no_error_above_tolerance_proven'
  | 'phase_dependent_quadrature_error'
  | 'time_invariant_quadrature_error'
  | 'quadrature_error_at_reported_time'

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
  continuity_absolute_residual: number
  continuity_scale: number
  continuity_scale_kind: Exclude<ContinuityScaleKind, 'transition_coherence'>
  continuity_probe_count: number
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
  z: number
  a_mu: number
  reduced_mass_ratio: number
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
  finite_box_tail_mass_upper_bound: number
  finite_box_mass_variation_upper_bound: number
  finite_grid_phase_variation_bound: number
  finite_grid_aliasing_variation_lower_bound: number
  finite_grid_mass_error_lower_bound: number
  finite_grid_reporting_tolerance: number
  finite_grid_mass_status: FiniteGridMassStatus
}

export interface SuperpositionCurrentPayload
  extends Omit<CurrentFieldPayload, 'metadata' | 'continuity_scale_kind'> {
  metadata: SuperpositionMetadata
  continuity_scale_kind: ContinuityScaleKind
  continuity_phase_count: number
  density_rate_scale: number
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
  continuityAbsoluteResidual?: number
  continuityScale?: number
  continuityScaleKind?: ContinuityScaleKind
  continuityProbeCount?: number
  continuityPhaseCount?: number
  finiteBoxTailMassUpperBound?: number
  finiteBoxMassVariationUpperBound?: number
  finiteGridPhaseVariationBound?: number
  finiteGridAliasingVariationLowerBound?: number
  finiteGridMassErrorLowerBound?: number
  finiteGridReportingTolerance?: number
  finiteGridMassStatus?: FiniteGridMassStatus
  timeAu?: number
  superposition?: SuperpositionMetadata
  metadata?: OrbitalMetadata
  warnings?: string[]
}
