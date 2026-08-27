import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { OrbitalMetadata, SceneStatus, SuperpositionMetadata } from '../api/types'
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
