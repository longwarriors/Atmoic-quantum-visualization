import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { OrbitalMetadata, SceneStatus, SuperpositionMetadata } from '../api/types'
import { Inspector } from './Inspector'

function eigenstateMetadata(energyHartree: number): OrbitalMetadata {
  return {
    state: { n: 2, l: 1, m: 0, z: 1, basis: 'complex' },
    label: 'test eigenstate',
    energy_hartree: energyHartree,
    length_unit: 'bohr',
    observable: 'probability_density',
    representation: 'point_cloud',
    normalization: 'unit norm',
    coordinate_convention: 'right-handed Cartesian',
    spherical_harmonic_convention: 'Condon-Shortley',
    geometry_semantics: 'test geometry',
    color_semantics: 'test color',
    references: [],
    warnings: [],
  }
}

function eigenstateStatus(energyHartree: number): SceneStatus {
  return { loading: false, extentBohr: 12, metadata: eigenstateMetadata(energyHartree) }
}

function render(status: SceneStatus): string {
  return renderToStaticMarkup(createElement(Inspector, { status }))
}

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
    expect(markup).toContain('<dt>Continuity scale kind</dt><dd>transition coherence</dd>')
    expect(markup).not.toContain('∇·j residual')
  })
})

describe('Inspector non-finite numbers', () => {
  it('renders a placeholder instead of a non-finite coefficient', () => {
    const notANumber = render(
      superpositionStatus([{ n: 2, l: 1, m: 0, coefficient_real: Number.NaN, coefficient_imag: 0 }]),
    )
    const notFinite = render(
      superpositionStatus([
        { n: 2, l: 1, m: 0, coefficient_real: 0.5, coefficient_imag: Number.POSITIVE_INFINITY },
      ]),
    )

    expect(notANumber).toContain('—|2,1,0⟩')
    expect(notANumber).not.toContain('NaN')
    expect(notANumber).not.toContain('Infinity')
    expect(notFinite).toContain('(0.500+—i)|2,1,0⟩')
    expect(notFinite).not.toContain('NaN')
    expect(notFinite).not.toContain('Infinity')
  })

  it('renders a placeholder instead of a non-finite eigenstate energy', () => {
    const notANumber = render(eigenstateStatus(Number.NaN))
    const notFinite = render(eigenstateStatus(Number.NEGATIVE_INFINITY))

    expect(notANumber).toContain('<span class="energy-pill">—</span>')
    expect(notANumber).not.toContain('NaN')
    expect(notANumber).not.toContain('Infinity')
    expect(notFinite).toContain('<span class="energy-pill">—</span>')
    expect(notFinite).not.toContain('NaN')
    expect(notFinite).not.toContain('Infinity')
  })

  it('renders a placeholder instead of a non-finite continuity residual', () => {
    const notFinite = render(
      Object.assign(superpositionStatus([]), {
        continuityResidual: Number.POSITIVE_INFINITY,
        continuityAbsoluteResidual: Number.NaN,
      }),
    )

    expect(notFinite).toContain('<dt>Continuity residual</dt><dd>—</dd>')
    expect(notFinite).toContain('<dt>Continuity |residual|</dt><dd>—</dd>')
    expect(notFinite).not.toContain('NaN')
    expect(notFinite).not.toContain('Infinity')
  })
})

describe('Inspector reports every measured diagnostic', () => {
  it('shows the continuity numerator, denominator and probe counts beside the ratio', () => {
    const markup = render(
      Object.assign(superpositionStatus([]), {
        continuityResidual: 2.0e-6,
        continuityAbsoluteResidual: 3.0e-9,
        continuityScale: 1.5e-3,
        continuityScaleKind: 'transition_coherence' as const,
        continuityProbeCount: 8,
        continuityPhaseCount: 5,
      }),
    )

    expect(markup).toContain('<dt>Continuity residual</dt><dd>2.00e-6</dd>')
    expect(markup).toContain('<dt>Continuity |residual|</dt><dd>3.000e-9</dd>')
    expect(markup).toContain('<dt>Continuity scale</dt><dd>1.500e-3</dd>')
    expect(markup).toContain('<dt>Continuity probes</dt><dd>8</dd>')
    expect(markup).toContain('<dt>Continuity phase samples</dt><dd>5</dd>')
  })

  it('shows the finite-box tail mass and the finite-grid phase variation bounds', () => {
    const markup = render(
      Object.assign(superpositionStatus([]), {
        finiteBoxTailMassUpperBound: 2.36e-5,
        finiteGridPhaseVariationBound: 3.915e-2,
      }),
    )

    expect(markup).toContain('<dt>Finite-box tail mass ≤</dt><dd>2.360e-5</dd>')
    expect(markup).toContain('<dt>Grid phase variation ≤</dt><dd>3.915e-2</dd>')
  })

  it('reports every measured number of a loaded eigenstate scene', () => {
    const status: SceneStatus = {
      ...eigenstateStatus(-0.125),
      pointCount: 900,
      triangleCount: 512,
      lineCount: 6,
      radialMass: 0.987654321,
      capturedProbabilityMass: 0.9,
      finiteGridDensityIntegral: 0.999875,
      gridResolution: 129,
      gridSpacingBohr: 0.15625,
      timeAu: 12.5,
      maxSpeed: 4.2e-3,
      densityLevel: 1.5e-4,
      error: 'stream ended early',
      warnings: ['grid is coarse'],
    }
    status.metadata!.references = ['NIST-hydrogen']

    const markup = render(status)

    expect(markup).toContain('<span class="energy-pill">-0.125000 Ha</span>')
    expect(markup).toContain('900 pts')
    expect(markup).toContain('512 tris')
    expect(markup).toContain('6 lines')
    expect(markup).toContain('<dt>Radial mass</dt><dd>98.76543%</dd>')
    expect(markup).toContain('<dt>Superlevel mass</dt><dd>90.000%</dd>')
    expect(markup).toContain('<dt>Finite-grid ∫ρdV</dt><dd>0.999875</dd>')
    expect(markup).toContain('<dt>Grid</dt><dd>129³ · Δ=0.156 bohr</dd>')
    expect(markup).toContain('<dt>Time</dt><dd>12.50 a.u.</dd>')
    expect(markup).toContain('<dt>Streamlines</dt><dd>6</dd>')
    expect(markup).toContain('<dt>Max |j|/ρ</dt><dd>4.200e-3 a.u.</dd>')
    expect(markup).toContain('<dt>Density level</dt><dd>1.500e-4</dd>')
    expect(markup).toContain('<code>NIST-hydrogen</code>')
    expect(markup).toContain('stream ended early')
    expect(markup).toContain('grid is coarse')
  })

  it('admits that nothing has loaded instead of showing a blank contract', () => {
    const idle = render({ loading: false })
    const busy = render({ loading: true })

    expect(idle).toContain('<h2>No asset</h2>')
    expect(idle).toContain('Awaiting verified metadata')
    expect(idle).toContain('<span class="energy-pill">—</span>')
    expect(idle).not.toContain('NaN')
    expect(busy).toContain('<h2>Computing…</h2>')
  })

  it('keeps the sign of a leading negative term and of a negative imaginary part', () => {
    const markup = render(
      superpositionStatus([
        { n: 1, l: 0, m: 0, coefficient_real: -0.5, coefficient_imag: 0 },
        { n: 2, l: 1, m: -1, coefficient_real: 0, coefficient_imag: -0.5 },
        { n: 3, l: 0, m: 0, coefficient_real: 0, coefficient_imag: 0 },
      ]),
    )

    expect(markup).toContain(
      '-0.500|1,0,0⟩  +  (0.000-0.500i)|2,1,-1⟩  +  0.000|3,0,0⟩',
    )
    expect(markup).not.toContain('-0.000')
  })

  it('shows the charge and reduced-mass scales the superposition was built with', () => {
    const status = superpositionStatus([])
    status.superposition!.z = 2
    status.superposition!.a_mu = 1.25
    status.superposition!.reduced_mass_ratio = 0.8

    const markup = render(status)

    expect(markup).toContain('<dt>Nuclear charge Z</dt><dd>2.000</dd>')
    expect(markup).toContain('<dt>Reduced-Bohr scale a_μ</dt><dd>1.250</dd>')
    expect(markup).toContain('<dt>Reduced mass ratio</dt><dd>0.800</dd>')
  })
})
