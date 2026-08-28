import {
  sliceMaskedFraction,
  sliceValueAt,
  type AnySlicePayload,
} from '../api/sliceContract'
import type {
  CurrentFieldPayload,
  RepresentationKind,
  SceneStatus,
  SuperpositionIsosurfacePayload,
} from '../api/types'

/** Human-facing labels; wire values stay untouched in requests and metadata. */
export const REPRESENTATION_LABELS: Readonly<Record<RepresentationKind, string>> = {
  point_cloud: '电子云',
  isosurface: '等密度面',
  slice: '平面切片',
  streamlines: '概率流线',
}

export function representationLabel(value: string | undefined): string {
  if (value === undefined) return '—'
  return value in REPRESENTATION_LABELS
    ? REPRESENTATION_LABELS[value as RepresentationKind]
    : value
}

const OBSERVABLE_LABELS: Readonly<Record<string, string>> = {
  probability_density: '概率密度 |ψ|²',
  probability_current: '概率流 j',
  wavefunction: '波函数 ψ',
  phase: 'phase · arg ψ',
}

export function observableLabel(value: string | undefined): string {
  if (value === undefined) return '—'
  return OBSERVABLE_LABELS[value] ?? value
}

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

/** A reported optional number, or `undefined` where the payload sends none. */
function reported(value: number | null | undefined): number | undefined {
  return value ?? undefined
}

/**
 * The largest defined `|value|` on the plane.
 *
 * Read through `sliceValueAt`, which is the only row-major accessor the
 * contract module exposes and the only thing that knows a masked sample reads
 * as `null` rather than as its sentinel. Indexing `values` here instead would
 * work today -- the sentinel is `0.0` and `|0|` loses every maximum -- and stop
 * working the moment the sentinel is anything else, which is exactly the class
 * of silent breakage the accessor exists to prevent.
 */
function maxAbsValue(payload: AnySlicePayload): number {
  const { resolution } = payload
  let largest = 0
  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < resolution; col += 1) {
      const value = sliceValueAt(payload, row, col)
      if (value !== null && Math.abs(value) > largest) {
        largest = Math.abs(value)
      }
    }
  }
  return largest
}

/**
 * Every number the Inspector shows about a plane section, from either slice
 * payload.
 *
 * One adapter for both because they differ only in metadata, which is the one
 * thing dispatched on here: an eigenstate slice fills `metadata`, a
 * superposition slice fills `superposition` and the time it is a section of.
 *
 * `phaseMaskedFraction` comes from `sliceMaskedFraction`, which COUNTS the
 * mask and cross-checks the payload's own `phase_masked_fraction` against that
 * count -- so this function throws on a payload whose diagnostic disagrees
 * with its data, rather than forwarding the number a user would go on to
 * quote. The forwarded fraction is the recomputation in every case, including
 * the unmasked one: a slice carrying no mask has masked nothing, and `0` is a
 * fact where the raw field's `null` would read as "unknown".
 */
export function statusFromSlice(payload: AnySlicePayload): SceneStatus {
  const status: SceneStatus = {
    loading: false,
    plane: payload.plane,
    sliceObservable: payload.slice_observable,
    sliceResolution: payload.resolution,
    sliceSpacingBohr: payload.spacing_bohr,
    sliceValueUnit: payload.value_unit,
    sliceMaxAbsValue: maxAbsValue(payload),
    extentBohr: payload.extent_bohr,
    maskedValueSentinel: payload.masked_value_sentinel,
    phaseMaskRelativeAmplitude: reported(payload.phase_mask_relative_amplitude),
    phaseMaskAmplitudeScale: reported(payload.phase_mask_amplitude_scale),
    phaseMaskAmplitudeThreshold: reported(payload.phase_mask_amplitude_threshold),
    phaseMaskNumericFloor: reported(payload.phase_mask_numeric_floor),
    phaseMaskedFraction: sliceMaskedFraction(payload),
  }
  const { metadata } = payload
  // `warnings` is optional on the generated metadata (the server omits an
  // empty list) and required on the hand-written type the UI reads; an absent
  // list means no warnings, which is a fact, so it is spelled as one.
  const warnings = metadata.warnings ?? []
  if ('state' in metadata) {
    return { ...status, metadata: { ...metadata, warnings }, warnings }
  }
  return {
    ...status,
    timeAu: metadata.time_au,
    superposition: { ...metadata, warnings },
    warnings,
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
