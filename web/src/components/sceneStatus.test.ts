import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { SliceContractError, type AnySlicePayload } from '../api/sliceContract'
import type {
  CurrentFieldPayload,
  OrbitalMetadata,
  SuperpositionIsosurfacePayload,
  SuperpositionMetadata,
} from '../api/types'
import {
  observableLabel,
  representationLabel,
  statusFromCurrentField,
  statusFromSlice,
  statusFromSuperpositionIsosurface,
} from './sceneStatus'

const superpositionMetadata: SuperpositionMetadata = {
  terms: [{ n: 1, l: 0, m: 0, coefficient_real: 1, coefficient_imag: 0 }],
  label: '1|1,0,0>',
  basis: 'complex',
  z: 1,
  a_mu: 1,
  reduced_mass_ratio: 1,
  time_au: 2.5,
  energy_expectation_hartree: -0.5,
  is_stationary: true,
  length_unit: 'bohr',
  observable: 'probability_density',
  representation: 'isosurface',
  normalization: 'unit norm',
  coordinate_convention: 'Cartesian',
  spherical_harmonic_convention: 'Condon-Shortley',
  geometry_semantics: 'surface',
  color_semantics: 'phase',
  references: [],
  warnings: ['surface warning'],
}

const orbitalMetadata: OrbitalMetadata = {
  state: { n: 2, l: 1, m: 1, z: 1, a_mu: 1, basis: 'complex' },
  label: '|2,1,1>',
  energy_hartree: -0.125,
  length_unit: 'bohr',
  observable: 'probability_current',
  representation: 'streamlines',
  normalization: 'unit norm',
  coordinate_convention: 'Cartesian',
  spherical_harmonic_convention: 'Condon-Shortley',
  geometry_semantics: 'lines',
  color_semantics: 'speed',
  references: [],
  warnings: ['current warning'],
}

describe('scene status UI labels', () => {
  it('localizes known wire values without rewriting unknown contract values', () => {
    expect(representationLabel('point_cloud')).toBe('电子云')
    expect(representationLabel('streamlines')).toBe('概率流线')
    expect(representationLabel('future_representation')).toBe('future_representation')
    expect(representationLabel(undefined)).toBe('—')

    expect(observableLabel('probability_density')).toBe('概率密度 |ψ|²')
    expect(observableLabel('probability_current')).toBe('概率流 j')
    expect(observableLabel('future_observable')).toBe('future_observable')
    expect(observableLabel(undefined)).toBe('—')
  })
})

describe('scene payload status adapters', () => {
  it('forwards every finite-box and render-grid diagnostic', () => {
    const payload: SuperpositionIsosurfacePayload = {
      metadata: superpositionMetadata,
      vertices: [],
      normals: [],
      faces: [[0, 1, 2]],
      phase: [],
      density_level: 0.01,
      requested_probability_mass: 0.9,
      captured_probability_mass: 0.91,
      finite_grid_density_integral: 0.95,
      grid_resolution: 49,
      grid_spacing_bohr: 0.8,
      integration_rule: 'tensor_product_simpson',
      extent_bohr: 19.8,
      finite_box_tail_mass_upper_bound: 2.3e-5,
      finite_box_mass_variation_upper_bound: 9.5e-10,
      finite_grid_phase_variation_bound: 0.039,
      finite_grid_aliasing_variation_lower_bound: 0.019,
      finite_grid_mass_error_lower_bound: 0.048,
      finite_grid_reporting_tolerance: 0.002,
      finite_grid_mass_status: 'phase_dependent_quadrature_error',
    }

    expect(statusFromSuperpositionIsosurface(payload)).toMatchObject({
      finiteBoxTailMassUpperBound: 2.3e-5,
      finiteBoxMassVariationUpperBound: 9.5e-10,
      finiteGridPhaseVariationBound: 0.039,
      finiteGridAliasingVariationLowerBound: 0.019,
      finiteGridMassErrorLowerBound: 0.048,
      finiteGridReportingTolerance: 0.002,
      finiteGridMassStatus: 'phase_dependent_quadrature_error',
      timeAu: 2.5,
      superposition: superpositionMetadata,
      warnings: ['surface warning'],
    })
  })

  it('forwards every continuity diagnostic', () => {
    const payload: CurrentFieldPayload = {
      metadata: orbitalMetadata,
      lines: [[[0, 0, 0]]],
      speed: [[0.1]],
      seed_count: 1,
      max_speed: 0.1,
      arc_step_bohr: 0.2,
      seed_density_floor: 1e-6,
      extent_bohr: 8,
      continuity_residual: 2e-6,
      continuity_absolute_residual: 3e-9,
      continuity_scale: 0.0015,
      continuity_scale_kind: 'stationary_current',
      continuity_probe_count: 8,
      integration_rule: 'rk4_arc_length',
    }

    expect(statusFromCurrentField(payload)).toMatchObject({
      lineCount: 1,
      maxSpeed: 0.1,
      continuityResidual: 2e-6,
      continuityAbsoluteResidual: 3e-9,
      continuityScale: 0.0015,
      continuityScaleKind: 'stationary_current',
      continuityProbeCount: 8,
      extentBohr: 8,
      metadata: orbitalMetadata,
      warnings: ['current warning'],
    })
  })
})

/* ------------------------------------------------------------------ slices */

/**
 * The committed slice golden: the 1s `xy` phase section at resolution 65,
 * every sample unmasked and every phase exactly `0.0`.
 *
 * Re-parsed per case because every case below mutates it, and a case that saw
 * another's edit would be asserting about a payload nobody wrote.
 */
const SLICE_GOLDEN_TEXT = readFileSync(
  fileURLToPath(new URL('../../../tests/fixtures/slice_golden.json', import.meta.url)),
  'utf-8',
)

type MutableSlice = Record<string, unknown>

const freshSlice = (): MutableSlice => JSON.parse(SLICE_GOLDEN_TEXT) as MutableSlice

/** A payload built by hand is not a validated one; `statusFromSlice` takes it as it is. */
const asSlice = (payload: MutableSlice): AnySlicePayload => payload as unknown as AnySlicePayload

/**
 * The golden as a `probability_density` section: no mask, and none of the five
 * mask-rule terms, because only a phase slice carries them.
 */
function densitySlice(): MutableSlice {
  const payload = freshSlice()
  payload.slice_observable = 'probability_density'
  payload.value_unit = 'bohr^-3'
  payload.valid_mask = null
  payload.phase_mask_relative_amplitude = null
  payload.phase_mask_amplitude_scale = null
  payload.phase_mask_amplitude_threshold = null
  payload.phase_mask_numeric_floor = null
  payload.phase_masked_fraction = null
  return payload
}

describe('statusFromSlice', () => {
  it('reports the plane, the field, the grid and every term of the mask rule', () => {
    const status = statusFromSlice(asSlice(freshSlice()))

    expect(status).toMatchObject({
      loading: false,
      plane: 'xy',
      sliceObservable: 'phase',
      sliceResolution: 65,
      sliceValueUnit: 'radian',
      maskedValueSentinel: 0,
      phaseMaskRelativeAmplitude: 1e-6,
      phaseMaskAmplitudeScale: 1,
      phaseMaskAmplitudeThreshold: 1e-6,
      phaseMaskedFraction: 0,
    })
    expect(status.phaseMaskNumericFloor).toBeCloseTo(8.017616203627489e-15, 20)
    expect(status.sliceSpacingBohr).toBeCloseTo(0.22850905073819594, 15)
    expect(status.extentBohr).toBeCloseTo(7.31228962362227, 12)
    // The eigenstate arm: the state itself, not a superposition.
    expect(status.metadata?.state.n).toBe(1)
    expect(status.superposition).toBeUndefined()
    expect(status.timeAu).toBeUndefined()
    expect(status.warnings).toEqual([])
  })

  it('reports the largest defined |value| on the plane', () => {
    // Nothing in the payload carries this, and a renderer that normalises
    // colour needs it: the golden's phases are all 0.0, so the number has to
    // come from the samples rather than from a reported field.
    const payload = freshSlice()
    const values = payload.values as number[]
    values[0] = -3
    values[10] = 2

    expect(statusFromSlice(asSlice(payload)).sliceMaxAbsValue).toBeCloseTo(3, 12)
  })

  /**
   * The recomputation is the authority, and this is the case that says so: a
   * slice with no mask has nothing masked, so its fraction is ZERO. Reading
   * the raw `phase_masked_fraction` here would report `undefined` -- "we do
   * not know" -- about a slice whose masked fraction is known exactly.
   */
  it('reports zero masked for a slice that carries no mask at all', () => {
    const status = statusFromSlice(asSlice(densitySlice()))

    expect(status.phaseMaskedFraction).toBe(0)
    expect(status.sliceObservable).toBe('probability_density')
    expect(status.sliceValueUnit).toBe('bohr^-3')
    // The four thresholds belong to the mask rule; a slice with no mask
    // applied none, and reporting numbers it did not use would be a fiction.
    expect(status.phaseMaskRelativeAmplitude).toBeUndefined()
    expect(status.phaseMaskAmplitudeScale).toBeUndefined()
    expect(status.phaseMaskAmplitudeThreshold).toBeUndefined()
    expect(status.phaseMaskNumericFloor).toBeUndefined()
  })

  it('counts the mask rather than trusting the fraction the payload reports', () => {
    const payload = freshSlice()
    ;(payload.valid_mask as boolean[])[7] = false
    payload.phase_masked_fraction = 1 / 65 ** 2

    expect(statusFromSlice(asSlice(payload)).phaseMaskedFraction).toBeCloseTo(1 / 4225, 15)
  })

  it('refuses a payload whose reported fraction disagrees with its own mask', () => {
    // A number that disagrees with the data it summarises is worse than none,
    // because it is the number someone will quote.
    const payload = freshSlice()
    ;(payload.valid_mask as boolean[])[7] = false

    let thrown: unknown
    try {
      statusFromSlice(asSlice(payload))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SliceContractError)
    expect((thrown as SliceContractError).field).toBe('phase_masked_fraction')
  })

  it('reads metadata that omits its warnings as carrying none', () => {
    // `warnings` is optional on the wire -- the server omits an empty list --
    // and required on the type the UI reads. Absent means none, which is a
    // fact about the payload rather than a gap to leave undefined.
    const payload = freshSlice()
    const metadata = { ...(payload.metadata as Record<string, unknown>) }
    delete metadata.warnings
    payload.metadata = metadata

    const status = statusFromSlice(asSlice(payload))

    expect(status.warnings).toEqual([])
    expect(status.metadata?.warnings).toEqual([])
  })

  it('reports a superposition slice through the superposition arm, with its time', () => {
    const payload = freshSlice()
    payload.metadata = superpositionMetadata

    const status = statusFromSlice(asSlice(payload))

    expect(status.superposition).toEqual(superpositionMetadata)
    expect(status.timeAu).toBe(2.5)
    expect(status.metadata).toBeUndefined()
    expect(status.warnings).toEqual(['surface warning'])
  })
})
