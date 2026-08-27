import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SceneStatus, SuperpositionMetadata } from '../api/types'
import { Inspector } from './Inspector'

function superpositionStatus(terms: SuperpositionMetadata['terms']): SceneStatus {
  return {
    loading: false,
    extentBohr: 10,
    superposition: {
      terms,
      label: 'test mixture',
      basis: 'complex',
      z: 1,
      a_mu: 1,
      reduced_mass_ratio: 1,
      time_au: 0,
      energy_expectation_hartree: -0.3125,
      is_stationary: false,
      length_unit: 'bohr',
      observable: 'probability_density',
      representation: 'isosurface',
      normalization: 'unit norm',
      coordinate_convention: 'right-handed Cartesian',
      spherical_harmonic_convention: 'Condon-Shortley',
      geometry_semantics: 'test geometry',
      color_semantics: 'test color',
      references: [],
      warnings: [],
    },
  }
}

describe('Inspector superposition coefficients', () => {
  it('preserves a negative real coefficient instead of displaying its magnitude', () => {
    const status = superpositionStatus([
      { n: 1, l: 0, m: 0, coefficient_real: 0.70710678, coefficient_imag: 0 },
      { n: 2, l: 1, m: 0, coefficient_real: -0.70710678, coefficient_imag: 0 },
    ])

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('0.707|1,0,0⟩  -  0.707|2,1,0⟩')
    expect(markup).not.toContain('0.707|1,0,0⟩  +  0.707|2,1,0⟩')
  })

  it('shows the algebraic phase of a genuinely complex coefficient', () => {
    const status = superpositionStatus([
      { n: 1, l: 0, m: 0, coefficient_real: -0.5, coefficient_imag: 0.5 },
      { n: 2, l: 1, m: 0, coefficient_real: 0.5, coefficient_imag: 0.5 },
    ])

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('(-0.500+0.500i)|1,0,0⟩  +  (0.500+0.500i)|2,1,0⟩')
  })

  it('does not display a retained tiny active coefficient as exact zero', () => {
    const status = superpositionStatus([
      { n: 1, l: 0, m: 0, coefficient_real: 1, coefficient_imag: 0 },
      { n: 2, l: 1, m: 0, coefficient_real: 1e-12, coefficient_imag: 0 },
    ])

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('1.00e-12|2,1,0⟩')
    expect(markup).not.toContain('0.000|2,1,0⟩')
  })
})

describe('Inspector scientific diagnostics', () => {
  it('reports the finite-grid status and its independently bounded mass error', () => {
    const status = Object.assign(
      superpositionStatus([
        { n: 1, l: 0, m: 0, coefficient_real: 0.70710678, coefficient_imag: 0 },
        { n: 2, l: 0, m: 0, coefficient_real: 0.70710678, coefficient_imag: 0 },
      ]),
      {
        finiteBoxTailMassUpperBound: 2.36e-5,
        finiteBoxMassVariationUpperBound: 9.52e-10,
        finiteGridPhaseVariationBound: 0.03915,
        finiteGridAliasingVariationLowerBound: 0.01957,
        finiteGridMassErrorLowerBound: 0.03912,
        finiteGridReportingTolerance: 0.002,
        finiteGridMassStatus: 'phase_dependent_quadrature_error' as const,
      },
    )

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('<dt>Grid mass status</dt>')
    expect(markup).toContain('phase-dependent quadrature error')
    expect(markup).toContain('<dt>Grid report threshold</dt><dd>2.000e-3</dd>')
    expect(markup).toContain('<dt>Grid mass error ≥</dt><dd>3.912e-2</dd>')
    expect(markup).toContain('<dt>Grid alias variation ≥</dt><dd>1.957e-2</dd>')
    expect(markup).toContain('<dt>Finite-box variation ≤</dt><dd>9.520e-10</dd>')
  })

  it('does not turn absent error evidence into an accuracy certificate', () => {
    const status = Object.assign(superpositionStatus([]), {
      finiteGridMassStatus: 'no_error_above_tolerance_proven' as const,
      finiteGridReportingTolerance: 0.002,
    })

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('no above-threshold error demonstrated (accuracy not certified)')
    expect(markup).not.toContain('no error above tolerance proven')
  })

  it('calls every energy-eigenstate support stationary without claiming degeneracy', () => {
    const status = superpositionStatus([
      { n: 1, l: 0, m: 0, coefficient_real: 1, coefficient_imag: 0 },
    ])
    status.superposition!.is_stationary = true

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('stationary density')
    expect(markup).not.toContain('degenerate')
  })

  it('labels the full time-dependent equation rather than only div j', () => {
    const status = Object.assign(superpositionStatus([]), {
      continuityResidual: 2.5e-5,
      continuityScaleKind: 'transition_coherence' as const,
    })

    const markup = renderToStaticMarkup(createElement(Inspector, { status }))

    expect(markup).toContain('<dt>Continuity residual</dt><dd>2.50e-5</dd>')
    expect(markup).toContain('<dt>Continuity scale</dt><dd>transition coherence</dd>')
    expect(markup).not.toContain('∇·j residual')
  })
})
