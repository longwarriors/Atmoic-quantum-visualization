import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  OrbitalMetadata,
  SceneStatus,
  SliceObservable,
  SuperpositionMetadata,
} from '../api/types'
import { Legend } from './Legend'

function eigenstateMetadata(representation: string, basis: 'real' | 'complex'): OrbitalMetadata {
  return {
    state: { n: 2, l: 1, m: 0, z: 1, basis },
    label: 'test eigenstate',
    energy_hartree: -0.125,
    length_unit: 'bohr',
    observable: 'probability_density',
    representation,
    normalization: 'unit norm',
    coordinate_convention: 'right-handed Cartesian',
    spherical_harmonic_convention: 'Condon-Shortley',
    geometry_semantics: 'test geometry',
    color_semantics: 'test color',
    references: [],
    warnings: [],
  }
}

function superpositionMetadata(representation: string): SuperpositionMetadata {
  return {
    terms: [],
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
    representation,
    normalization: 'unit norm',
    coordinate_convention: 'right-handed Cartesian',
    spherical_harmonic_convention: 'Condon-Shortley',
    geometry_semantics: 'test geometry',
    color_semantics: 'test color',
    references: [],
    warnings: [],
  }
}

const render = (status: SceneStatus): string =>
  renderToStaticMarkup(createElement(Legend, { status }))

describe('Legend names what is actually on screen', () => {
  it('explains a standing refusal instead of drawing a legend for nothing', () => {
    const reason = 'No route samples a time-dependent state as a point cloud.'
    const markup = render({ loading: false, unavailable: { kind: 'point_cloud', reason } })

    expect(markup).toContain(reason)
    expect(markup).toContain('point_cloud')
    // A phase wheel over an empty viewport names a colour nothing is painted in.
    expect(markup).not.toContain('phase-wheel')
    expect(markup).not.toContain('Waiting for asset metadata')
  })

  it('describes streamline colour as speed, not phase', () => {
    const markup = render({
      loading: false,
      maxSpeed: 0.0421,
      metadata: eigenstateMetadata('streamlines', 'complex'),
    })

    expect(markup).toContain('Probability flow speed')
    expect(markup).toContain('0.0421 a.u.')
    expect(markup).not.toContain('phase-wheel')
  })

  it('says max rather than inventing a number when no speed was reported', () => {
    const markup = render({
      loading: false,
      superposition: superpositionMetadata('streamlines'),
    })

    expect(markup).toContain('Probability flow speed')
    expect(markup).toContain('>max<')
  })

  it('shows a phase wheel for a complex state and two dots for a real one', () => {
    const complex = render({
      loading: false,
      metadata: eigenstateMetadata('point_cloud', 'complex'),
    })
    expect(complex).toContain('phase-wheel')
    expect(complex).toContain('|ψ|²d³r')

    const real = render({ loading: false, metadata: eigenstateMetadata('isosurface', 'real') })
    expect(real).toContain('real-legend')
    expect(real).not.toContain('phase-wheel')
    expect(real).toContain('level set')
  })

  it('reads the superposition metadata when there is no eigenstate metadata', () => {
    const markup = render({ loading: false, superposition: superpositionMetadata('isosurface') })
    expect(markup).toContain('phase-wheel')
    expect(markup).toContain('level set')
  })

  it('waits for metadata rather than naming a representation it has not been told', () => {
    expect(render({ loading: true })).toContain('Waiting for asset metadata')
  })
})

/**
 * A slice's metadata `observable` is COARSER than the field it carries: the
 * server maps both `wavefunction_real` and `wavefunction_imag` onto the single
 * `wavefunction` observable, and a phase slice's payload is the only thing that
 * says its texels are angles. The legend therefore reads
 * `status.sliceObservable`, which comes from the validated payload, and these
 * specs hold it to that by giving every fixture a metadata observable that
 * disagrees with the slice one.
 */
function sliceStatus(
  sliceObservable: SliceObservable | undefined,
  overrides: Partial<SceneStatus> = {},
): SceneStatus {
  return {
    loading: false,
    plane: 'xz',
    sliceObservable,
    sliceResolution: 129,
    sliceSpacingBohr: 0.125,
    sliceValueUnit: 'bohr^-3',
    sliceMaxAbsValue: 0.0421,
    // eigenstateMetadata always reports `probability_density`, so any legend
    // that dispatched on metadata would name a density here every time.
    metadata: eigenstateMetadata('slice', 'complex'),
    ...overrides,
  }
}

describe('Legend names a slice by the field the plane actually carries', () => {
  it('does not put a phase wheel over a density slice', () => {
    const markup = render(sliceStatus('probability_density'))

    // The wheel says "this colour is an angle". A density slice's colour is a
    // magnitude, and a wheel over it renames every texel.
    expect(markup).not.toContain('phase-wheel')
    expect(markup).not.toContain('level set')
    expect(markup).toContain('density-ramp')
    expect(markup).toContain('Probability density')
  })

  it('names the imaginary part from the slice observable, not the coarser metadata one', () => {
    const markup = render(sliceStatus('wavefunction_imag'))

    expect(markup).toContain('Im ψ')
    expect(markup).toContain('diverging-ramp')
    expect(markup).not.toContain('density-ramp')
    expect(markup).not.toContain('phase-wheel')

    const real = render(sliceStatus('wavefunction_real'))
    expect(real).toContain('Re ψ')
    expect(real).toContain('diverging-ramp')
  })

  it('calls masked texels phase-undefined rather than nodes', () => {
    const markup = render(
      sliceStatus('phase', { sliceValueUnit: 'radian', phaseMaskedFraction: 0.0625 }),
    )

    expect(markup).toContain('phase-wheel')
    expect(markup).toContain(
      'Transparent texels are masked: |ψ| below the threshold, ' +
        'where the phase is undefined — not nodes.',
    )
    expect(markup).toContain('6.25% of this plane is masked')
    // A node is a place where the amplitude is KNOWN to vanish -- the physically
    // interesting part of the picture. Naming the mask after it is the one
    // reading this sentence exists to forbid.
    expect(markup).not.toContain('nodal')
    expect(markup).not.toContain('node.')
  })

  it('labels the diverging ramp with the amplitude the colour is normalised to', () => {
    const markup = render(sliceStatus('wavefunction_real'))

    expect(markup).toContain('<span>−A</span><span>0</span><span>+A</span>')
    expect(markup).toContain('A = 0.0421 bohr^-3')
  })

  it('says the density ramp is linear in amplitude, not in density', () => {
    const markup = render(sliceStatus('probability_density'))

    expect(markup).toContain('<span>0</span><span>max</span>')
    expect(markup).toContain('brightness proportional to |ψ|/max|ψ| (square root of density)')
  })

  it('names the plane every slice was sampled on', () => {
    const markup = render(sliceStatus('phase', { plane: 'yz' }))

    expect(markup).toContain(
      'Sampled on the yz plane through the origin; nearest-sample colour, no interpolation.',
    )
  })

  it('refuses to name a colour scheme the slice did not report', () => {
    const markup = render(sliceStatus(undefined, { plane: undefined }))

    expect(markup).toContain('Plane section')
    expect(markup).toContain('reported no observable')
    expect(markup).not.toContain('phase-wheel')
    expect(markup).not.toContain('diverging-ramp')
    expect(markup).not.toContain('density-ramp')
    expect(markup).toContain('Sampled on the unreported plane through the origin')
  })

  it('shows an em dash instead of inventing a missing or non-finite number', () => {
    const notFinite = render(sliceStatus('wavefunction_real', { sliceMaxAbsValue: Number.NaN }))
    const absent = render(sliceStatus('wavefunction_real', { sliceMaxAbsValue: undefined }))
    const unitless = render(sliceStatus('wavefunction_real', { sliceValueUnit: undefined }))
    const masked = render(sliceStatus('phase', { phaseMaskedFraction: undefined }))

    expect(notFinite).toContain('A = —')
    expect(notFinite).not.toContain('NaN')
    expect(absent).toContain('A = —')
    // A slice that reported no unit gets the bare number, never the word
    // "undefined" pressed into service as one.
    expect(unitless).toContain('A = 0.0421,')
    expect(unitless).not.toContain('undefined')
    expect(masked).toContain('— of this plane is masked')
    expect(masked).not.toContain('NaN')
  })
})
