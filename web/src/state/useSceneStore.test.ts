import { beforeEach, describe, expect, it } from 'vitest'

import { useSceneStore } from './useSceneStore'

const INITIAL = useSceneStore.getState()

beforeEach(() => {
  useSceneStore.setState(INITIAL, true)
})

const read = () => useSceneStore.getState()

describe('representation availability', () => {
  it('resolves point_cloud to isosurface when the mode becomes superposition', () => {
    useSceneStore.setState({ representation: 'point_cloud' })

    read().setMode('superposition')

    // No route samples a time-dependent state as a point cloud, so leaving
    // 'point_cloud' in place is what made the canvas short-circuit.
    expect(read().representation).toBe('isosurface')
  })

  it('refuses a point_cloud request while in superposition mode', () => {
    read().setMode('superposition')

    read().setRepresentation('point_cloud')

    expect(read().representation).toBe('isosurface')
  })

  it('keeps an already-available representation instead of falling to the mode default', () => {
    read().setMode('superposition')
    read().setRepresentation('streamlines')

    read().setRepresentation('point_cloud')

    expect(read().representation).toBe('streamlines')
  })

  it('honours a representation the superposition routes do serve', () => {
    read().setMode('superposition')

    read().setRepresentation('streamlines')

    expect(read().representation).toBe('streamlines')
  })

  it('returns to point_cloud when the mode becomes eigenstate again', () => {
    read().setMode('superposition')
    read().setRepresentation('isosurface')
    read().setOrbital({ n: 6 })

    read().setMode('eigenstate')

    // n = 6 is past the eigenstate isosurface route's n <= 4.
    expect(read().representation).toBe('point_cloud')
  })

  it('refuses eigenstate streamlines past the current-field route n <= 6', () => {
    read().setOrbital({ n: 8, l: 1, m: 1, basis: 'complex' })

    read().setRepresentation('streamlines')

    // The old store predicate tested only basis and m, and asked the server
    // for n = 8, which /api/orbitals/current-field rejects.
    expect(read().representation).toBe('point_cloud')
  })

  it('serves eigenstate streamlines inside the route range', () => {
    read().setOrbital({ n: 3, l: 1, m: 1, basis: 'complex' })

    read().setRepresentation('streamlines')

    expect(read().representation).toBe('streamlines')
  })

  it('refuses streamlines for a real orbital, which carries no probability current', () => {
    read().setOrbital({ n: 3, l: 1, m: 1, basis: 'real' })

    read().setRepresentation('streamlines')

    expect(read().representation).toBe('point_cloud')
  })

  it('demotes a standing isosurface when the orbital moves past n = 4', () => {
    read().setRepresentation('isosurface')
    expect(read().representation).toBe('isosurface')

    read().setOrbital({ n: 5 })

    expect(read().representation).toBe('point_cloud')
  })

  it('demotes a standing isosurface when a preset moves past n = 4', () => {
    read().setRepresentation('isosurface')

    read().applyPreset({ n: 6, l: 0, m: 0, z: 1, basis: 'real' })

    expect(read().representation).toBe('point_cloud')
  })

  it('keeps an isosurface a preset still supports, and lifts the grid to match n', () => {
    read().setRepresentation('isosurface')

    read().applyPreset({ n: 4, l: 3, m: 2, z: 1.5, basis: 'complex' })

    expect(read().representation).toBe('isosurface')
    expect(read().orbital).toEqual({ n: 4, l: 3, m: 2, z: 1.5, basis: 'complex' })
    expect(read().resolution).toBe(81)
  })
})

describe('superposition state fields', () => {
  it('defaults the superposition basis to complex, independent of the orbital basis', () => {
    expect(read().superpositionBasis).toBe('complex')
    expect(read().orbital.basis).toBe('real')
  })

  it('defaults z and a_mu to 1', () => {
    expect(read().superpositionZ).toBe(1)
    expect(read().superpositionAMu).toBe(1)
  })

  it('updates the superposition basis, z and a_mu through their setters', () => {
    read().setSuperpositionBasis('real')
    read().setSuperpositionZ(2.5)
    read().setSuperpositionAMu(0.999456)

    expect(read().superpositionBasis).toBe('real')
    expect(read().superpositionZ).toBe(2.5)
    expect(read().superpositionAMu).toBe(0.999456)
  })

  it('leaves the orbital basis alone when the superposition basis changes', () => {
    read().setOrbital({ basis: 'complex' })

    read().setSuperpositionBasis('real')

    expect(read().orbital.basis).toBe('complex')
  })
})

describe('orbital normalisation', () => {
  it('clamps n, l, m and z into their legal ranges', () => {
    read().setOrbital({ n: 99, l: 99, m: 99, z: 99 })
    expect(read().orbital).toEqual({ n: 8, l: 7, m: 7, z: 20, basis: 'real' })

    read().setOrbital({ n: -3, l: -3, m: -99, z: 0 })
    expect(read().orbital).toMatchObject({ n: 1, l: 0, z: 0.1, basis: 'real' })
    // `m` clamps to the l = 0 window; -0 and 0 are the same magnetic number.
    expect(read().orbital.m === 0).toBe(true)
  })

  it('keeps the untouched fields of the orbital on a partial patch', () => {
    read().setOrbital({ n: 3, l: 2, m: -1, z: 1.2, basis: 'complex' })

    read().setOrbital({ m: 0 })

    expect(read().orbital).toEqual({ n: 3, l: 2, m: 0, z: 1.2, basis: 'complex' })
  })

  it('raises the grid resolution to the floor the new n needs', () => {
    useSceneStore.setState({ resolution: 49 })

    read().setOrbital({ n: 3 })

    expect(read().resolution).toBe(65)
  })
})

describe('scene setters', () => {
  it('stops playback when the mode changes', () => {
    read().setPlaying(true)

    read().setMode('superposition')

    expect(read().mode).toBe('superposition')
    expect(read().playing).toBe(false)
  })

  it('rewinds the clock when the superposition terms change', () => {
    read().setTimeAu(12)

    read().setSuperposition('1,0,0,1', '1s')

    expect(read().superpositionTerms).toBe('1,0,0,1')
    expect(read().superpositionLabel).toBe('1s')
    expect(read().timeAu).toBe(0)
  })

  it('writes every remaining scalar through its setter', () => {
    const s = read()
    s.setTimeAu(3.5)
    s.setPlaying(true)
    s.setSamples(41000)
    s.setSeed(11)
    s.setResolution(75)
    s.setProbabilityMass(0.75)
    s.setSeedCount(96)
    s.setPointSize(4)
    s.setOpacity(0.5)
    s.setBloom(0.3)
    s.setExposure(1.4)
    s.setFogStrength(0.4)
    s.setAutoRotate(true)
    s.setShowGrid(false)

    expect(read()).toMatchObject({
      timeAu: 3.5,
      playing: true,
      samples: 41000,
      seed: 11,
      resolution: 75,
      probabilityMass: 0.75,
      seedCount: 96,
      pointSize: 4,
      opacity: 0.5,
      bloom: 0.3,
      exposure: 1.4,
      fogStrength: 0.4,
      autoRotate: true,
      showGrid: false,
    })
  })
})
