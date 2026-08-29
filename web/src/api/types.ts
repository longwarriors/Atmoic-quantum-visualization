import type { components } from './schema.gen'

export type BasisKind = 'real' | 'complex'
export type RepresentationKind = 'point_cloud' | 'isosurface' | 'slice' | 'streamlines'
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
  /** Reduced-mass Bohr-scale ratio carried by every server state record. */
  a_mu: number
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

/**
 * Geometry fields shared by the stationary and the time-dependent current
 * fields, the counterpart of `SurfaceGeometry` for streamlines.
 *
 * `lines[i]` is one streamline as a list of `[x, y, z]` vertices evenly
 * spaced in arc length; `speed[i]` carries |j|/rho at each of those vertices,
 * so `speed[i].length === lines[i].length`. `max_speed` is the maximum over
 * every vertex, which is the only number a renderer needs to normalise
 * colour. A component typed on this accepts `CurrentFieldPayload` and
 * `SuperpositionCurrentPayload` alike; both carry these three fields with
 * identical shapes (`list[list[list[float]]]`, `list[list[float]]`, `float`
 * in `quviz.scene.models`).
 */
export interface StreamlineGeometry {
  lines: number[][][]
  speed: number[][]
  max_speed: number
}

export interface CurrentFieldPayload extends StreamlineGeometry {
  metadata: OrbitalMetadata
  seed_count: number
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

/** Server-published preset and its builder-derived capability metadata. */
export type SuperpositionPreset = components['schemas']['SuperpositionCatalogEntry']

/**
 * One entry returned by `/api/orbitals/catalog`.
 *
 * Current catalogues carry `z` explicitly. Keep it optional at the client
 * boundary so an older compatible server can still supply the quantum numbers
 * and basis without making the UI fabricate a charge value.
 */
export interface OrbitalPreset extends Omit<OrbitalParameters, 'z'> {
  id: string
  label: string
  z?: number
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
  /**
   * What a slice is a slice OF: the plane it was cut on and the scalar field
   * it carries.
   *
   * Neither is derivable from anything else in this status, and both change
   * the picture completely, so a status that omitted them would leave the
   * Inspector describing a section without saying which section it is.
   */
  plane?: PrincipalPlane
  sliceObservable?: SliceObservable
  /**
   * The slice's own sample grid, deliberately NOT `gridResolution` /
   * `gridSpacingBohr`: those describe the isosurface's 3-D marching grid, and
   * a 2-D section that reused them would be reported as a volume it is not.
   * `resolution**2` samples are what a slice buys.
   */
  sliceResolution?: number
  sliceSpacingBohr?: number
  /** The unit of `values`: `radian` for a phase section, `bohr^-3` for a density. */
  sliceValueUnit?: string
  /**
   * The largest `|value|` over the samples whose value is defined.
   *
   * Recomputed from the samples because the payload carries no such field --
   * `max_amplitude_on_plane` is the amplitude |psi| the mask is referenced to,
   * a different quantity from the maximum of whichever scalar field was
   * requested -- and a renderer normalising colour needs the latter.
   */
  sliceMaxAbsValue?: number
  /**
   * The six numbers of the mask rule.
   *
   * The first five are the terms a phase slice reports and every other
   * observable omits: the relative amplitude, the amplitude scale it is taken
   * against, the resulting threshold, the numeric floor below which the phase
   * is noise, and the fraction actually masked. The sixth,
   * `maskedValueSentinel`, is the finite value a masked sample carries -- shown
   * because it is a legal value of the field it sits in (`0.0` reads as
   * "positive real"), so a user comparing numbers has to know which `0` means
   * "undefined here".
   *
   * `phaseMaskedFraction` is always the count recomputed from the mask, never
   * the number the payload reports: a diagnostic that disagrees with the data
   * it summarises is worse than none.
   */
  phaseMaskRelativeAmplitude?: number
  phaseMaskAmplitudeScale?: number
  phaseMaskAmplitudeThreshold?: number
  phaseMaskNumericFloor?: number
  phaseMaskedFraction?: number
  maskedValueSentinel?: number
  timeAu?: number
  /**
   * A refetch is in flight while a previously fetched frame is still on
   * screen. Distinct from `loading`, which means there is nothing to show:
   * while `refreshing` is true every number in this status describes the
   * *old* frame, and the UI must say so rather than presenting stale
   * diagnostics as current.
   */
  refreshing?: boolean
  /**
   * The time, in atomic units, of the frame actually rendered -- which lags
   * `timeAu` (the requested time) whenever a refetch is in flight or the
   * latest request failed. Reporting only `timeAu` labels a stale frame with
   * a time it does not show.
   */
  renderedTimeAu?: number
  /**
   * Why the requested representation produced nothing, when that is a
   * standing limitation rather than a transient error: `kind` names the
   * representation, `reason` is shown to the user. A disabled control with a
   * stated reason, never a silently hidden one.
   */
  unavailable?: { kind: string; reason: string }
  superposition?: SuperpositionMetadata
  metadata?: OrbitalMetadata
  warnings?: string[]
}

/**
 * The slice contract, RE-EXPORTED from the generated schema -- never
 * transcribed.
 *
 * Every other type in this file is hand-written, which is a standing hazard:
 * a hand-written mirror of a server model drifts, and the drift is silent
 * because `tsc` happily certifies the front-end against the mirror. The slice
 * payloads are new enough to have a generated source of truth
 * (`src/api/schema.gen.ts`, regenerated from `tests/fixtures/openapi.json` and
 * checked for drift by `src/api/schema.gen.test.ts`), so they take it: an
 * alias to `components['schemas'][...]` cannot say something the API does not.
 * A field added, removed or retyped on the Python side lands here the moment
 * the fixture is regenerated, and `src/api/sliceContract.ts` -- which reads
 * these types -- stops compiling instead of quietly reading a field that is
 * no longer sent.
 *
 * The aliases exist at all so that consumers import a slice type from the same
 * module every other scene type comes from, rather than reaching into a
 * generated file's index signature at each call site.
 */
export type SlicePayload = components['schemas']['SlicePayload']
export type SuperpositionSlicePayload = components['schemas']['SuperpositionSlicePayload']
export type PrincipalPlane = components['schemas']['PrincipalPlane']
export type SliceObservable = components['schemas']['SliceObservable']
