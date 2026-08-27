import type {
  CurrentFieldPayload,
  SceneStatus,
  SuperpositionIsosurfacePayload,
} from '../api/types'

/** Keep the Python scene contract attached while adapting snake_case payloads for the UI. */
export function statusFromSuperpositionIsosurface(
  data: SuperpositionIsosurfacePayload,
): SceneStatus {
  return {
    loading: false,
    triangleCount: data.faces.length,
    extentBohr: data.extent_bohr,
    densityLevel: data.density_level,
    capturedProbabilityMass: data.captured_probability_mass,
    finiteGridDensityIntegral: data.finite_grid_density_integral,
    gridResolution: data.grid_resolution,
    gridSpacingBohr: data.grid_spacing_bohr,
    finiteBoxTailMassUpperBound: data.finite_box_tail_mass_upper_bound,
    finiteBoxMassVariationUpperBound: data.finite_box_mass_variation_upper_bound,
    finiteGridPhaseVariationBound: data.finite_grid_phase_variation_bound,
    finiteGridAliasingVariationLowerBound: data.finite_grid_aliasing_variation_lower_bound,
    finiteGridMassErrorLowerBound: data.finite_grid_mass_error_lower_bound,
    finiteGridReportingTolerance: data.finite_grid_reporting_tolerance,
    finiteGridMassStatus: data.finite_grid_mass_status,
    timeAu: data.metadata.time_au,
    superposition: data.metadata,
    warnings: data.metadata.warnings,
  }
}

/** Adapt a stationary current payload without dropping its audit evidence. */
export function statusFromCurrentField(data: CurrentFieldPayload): SceneStatus {
  return {
    loading: false,
    lineCount: data.lines.length,
    maxSpeed: data.max_speed,
    continuityResidual: data.continuity_residual,
    continuityAbsoluteResidual: data.continuity_absolute_residual,
    continuityScale: data.continuity_scale,
    continuityScaleKind: data.continuity_scale_kind,
    continuityProbeCount: data.continuity_probe_count,
    extentBohr: data.extent_bohr,
    metadata: data.metadata,
    warnings: data.metadata.warnings,
  }
}
