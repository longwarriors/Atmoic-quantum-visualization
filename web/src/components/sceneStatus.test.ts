import { describe, expect, it } from 'vitest'

import type {
  CurrentFieldPayload,
  OrbitalMetadata,
  SuperpositionIsosurfacePayload,
  SuperpositionMetadata,
} from '../api/types'
import { statusFromCurrentField, statusFromSuperpositionIsosurface } from './sceneStatus'

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
  state: { n: 2, l: 1, m: 1, z: 1, basis: 'complex' },
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
