import { beforeEach, describe, expect, it } from 'vitest'

import { planSceneRequest } from '../api/capability'
import { selectSceneRequestInputs } from '../components/sceneRequest'
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
    useSceneStore.setState({ superpositionStreamlineSeedCountMax: 40 })
    read().setMode('superposition')
    read().setRepresentation('streamlines')

    read().setRepresentation('point_cloud')

    expect(read().representation).toBe('streamlines')
  })

  it('honours a representation the superposition routes do serve', () => {
    useSceneStore.setState({ superpositionStreamlineSeedCountMax: 40 })
    read().setMode('superposition')

    read().setRepresentation('streamlines')

    expect(read().representation).toBe('streamlines')
  })

  it('clamps seed count to the selected current-field route', () => {
    useSceneStore.setState({
      seedCount: 96,
      superpositionStreamlineSeedCountMax: 40,
    })

    read().setMode('superposition')
    read().setRepresentation('streamlines')

    expect(read().seedCount).toBe(40)
  })

  it('starts fail-closed instead of inventing the route ceiling before catalogue metadata arrives', () => {
    expect(read().superpositionStreamlineSeedCountMax).toBeUndefined()

    read().setMode('superposition')
    read().setRepresentation('streamlines')

    expect(read().representation).toBe('isosurface')
    expect(planSceneRequest(selectSceneRequestInputs(read()))).toMatchObject({
      status: 'available',
      endpoint: '/api/superposition/isosurface',
    })
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

  it('preserves nuclear charge when a catalogue preset omits z', () => {
    useSceneStore.setState({ orbital: { n: 1, l: 0, m: 0, z: 3, basis: 'real' } })

    read().applyPreset({ n: 3, l: 2, m: 1, basis: 'complex' })

    expect(read().orbital).toEqual({ n: 3, l: 2, m: 1, z: 3, basis: 'complex' })
  })
})

describe('superposition state fields', () => {
  it('defaults the superposition basis to complex, independent of the orbital basis', () => {
    expect(read().superpositionBasis).toBe('complex')
    expect(read().orbital.basis).toBe('real')
  })

  it('defaults z and a_mu to 1', () => {
    expect(read().superpositionZ).toBe(1)
    expect(read().aMu).toBe(1)
  })

  it('updates the superposition basis, z and a_mu through their setters', () => {
    read().setSuperpositionBasis('real')
    read().setSuperpositionZ(2.5)
    read().setAMu(0.999456)

    expect(read().superpositionBasis).toBe('real')
    expect(read().superpositionZ).toBe(2.5)
    expect(read().aMu).toBe(0.999456)
  })

  it('keeps a_mu across a mode change, because both modes now send it', () => {
    // a_mu stopped being a superposition-only field when the eigenstate slice
    // route grew it: the eigenstate slice rescales its extent and its amplitude
    // reference by the same reduced-mass length. A name that still said
    // "superposition" would be the store claiming otherwise.
    read().setAMu(0.0054)

    read().setMode('eigenstate')

    expect(read().aMu).toBe(0.0054)
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
    // Representation named on purpose: the floor being tested is the EIGENSTATE
    // ISOSURFACE row's, and reading it off whichever representation happened to
    // be standing is how the store came to apply that row's ceiling to
    // everything else.
    useSceneStore.setState({ representation: 'isosurface', resolution: 49 })

    read().setOrbital({ n: 3 })

    expect(read().resolution).toBe(65)
  })
})

/**
 * The grid is clamped into the bound the CURRENT cell declares, not into the
 * eigenstate isosurface's 49..81.
 *
 * The store used to spell `Math.min(81, ...)` in both places that touch the
 * resolution, which is the isosurface route's ceiling written down a second
 * time and applied to every row. A slice runs to 513, so a user who asked for a
 * 129-sample section had it silently cut to 81 -- and the panel's own slider,
 * which reads the matrix, offered a value the store would not keep.
 */
describe('resolution follows the bound of the representation actually shown', () => {
  it('clamps a 129-sample slice to the 81-sample isosurface ceiling on representation change', () => {
    useSceneStore.setState({ representation: 'slice', resolution: 129 })

    read().setRepresentation('isosurface')

    expect(read().representation).toBe('isosurface')
    expect(read().resolution).toBe(81)
  })

  it('raises an isosurface grid to the slice floor on representation change', () => {
    useSceneStore.setState({ representation: 'isosurface', resolution: 49 })

    read().setRepresentation('slice')

    expect(read().representation).toBe('slice')
    expect(read().resolution).toBe(65)
  })

  it('clamps resolution when a mode change resolves to a different row', () => {
    useSceneStore.setState({ mode: 'eigenstate', representation: 'point_cloud', resolution: 129 })

    read().setMode('superposition')

    expect(read().representation).toBe('isosurface')
    expect(read().resolution).toBe(81)
  })

  it('keeps a 129-sample slice grid instead of snapping it to the isosurface ceiling', () => {
    useSceneStore.setState({ representation: 'slice', resolution: 129 })

    read().setOrbital({ n: 2 })

    expect(read().representation).toBe('slice')
    expect(read().resolution).toBe(129)
  })

  it('keeps that slice grid through applyPreset too', () => {
    useSceneStore.setState({ representation: 'slice', resolution: 129 })

    read().applyPreset({ n: 2, l: 1, m: 0, z: 1, basis: 'real' })

    expect(read().resolution).toBe(129)
  })

  it('lifts a slice grid to the 16n + 17 floor the new n needs', () => {
    useSceneStore.setState({ representation: 'slice', resolution: 65 })

    read().setOrbital({ n: 5 })

    expect(read().resolution).toBe(97)
  })

  it.each([
    [4, 97],
    [5, 141],
    [6, 193],
    [7, 251],
    [8, 319],
  ] as const)('clamps the first %ss slice request to its physical floor %s', (n, floor) => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'point_cloud',
      resolution: 65,
      orbital: { n: 1, l: 0, m: 0, z: 1, basis: 'real' },
    })

    read().setOrbital({ n, l: 0, m: 0 })
    read().setRepresentation('slice')

    expect(read().resolution).toBe(floor)
    const plan = planSceneRequest(selectSceneRequestInputs(read()))
    expect(plan).toMatchObject({ status: 'available', params: { resolution: floor } })
  })

  it('raises the same-n slice when l changes from p to the more demanding s state', () => {
    useSceneStore.setState({
      mode: 'eigenstate',
      representation: 'slice',
      resolution: 145,
      orbital: { n: 8, l: 1, m: 0, z: 1, basis: 'real' },
    })

    read().setOrbital({ l: 0 })

    expect(read().resolution).toBe(319)
  })

  it('caps a slice grid at the slice route ceiling', () => {
    useSceneStore.setState({ representation: 'slice', resolution: 900 })

    read().setOrbital({ n: 2 })

    expect(read().resolution).toBe(513)
  })

  it('leaves the grid alone for a row that declares no resolution at all', () => {
    // The point-cloud route reads `samples` and `seed`, never a grid. Lifting
    // its resolution to a surface floor was the store editing a number the cell
    // does not have.
    useSceneStore.setState({ representation: 'point_cloud', resolution: 49 })

    read().setOrbital({ n: 4 })

    expect(read().resolution).toBe(49)
  })

  it('clamps against the representation the store resolves to, not the one asked for', () => {
    // n = 5 demotes the isosurface to the point cloud, and the isosurface bound
    // it just left (min 97, max 81) is not a bound at all.
    useSceneStore.setState({ representation: 'isosurface', resolution: 65 })

    read().setOrbital({ n: 5 })

    expect(read().representation).toBe('point_cloud')
    expect(read().resolution).toBe(65)
  })

  it('uses the superposition isosurface range, which carries no 16n + 17 floor', () => {
    useSceneStore.setState({ representation: 'isosurface', resolution: 49 })
    read().setMode('superposition')

    read().setOrbital({ n: 4 })

    expect(read().resolution).toBe(49)
  })

  it('atomically lifts the first catalogue mixture slice request to its published floor', () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'slice',
      resolution: 65,
      superpositionSliceResolutionFloor: 65,
    })

    read().setSuperposition(
      '1,0,0,0.7071067811865476;3,2,0,0.7071067811865476',
      '1s + 3d_z²',
      103,
      24,
    )

    expect(read().resolution).toBe(103)
    expect(read().superpositionSliceResolutionFloor).toBe(103)
    const plan = planSceneRequest(selectSceneRequestInputs(read()))
    expect(plan).toMatchObject({ status: 'available', params: { resolution: 103 } })
  })
})

describe('slice plane and observable', () => {
  it("defaults to the slice routes' own defaults", () => {
    // routes.py: `plane: PrincipalPlane = PrincipalPlane.XZ` and
    // `observable: SliceObservable = SliceObservable.PROBABILITY_DENSITY`.
    expect(read().plane).toBe('xz')
    expect(read().sliceObservable).toBe('probability_density')
  })

  it('writes the plane and the observable through their setters', () => {
    read().setPlane('yz')
    read().setSliceObservable('phase')

    expect(read().plane).toBe('yz')
    expect(read().sliceObservable).toBe('phase')
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
    read().setPlaying(true)

    read().setSuperposition('1,0,0,1', '1s', 65, 40)

    expect(read().superpositionTerms).toBe('1,0,0,1')
    expect(read().superpositionLabel).toBe('1s')
    expect(read().timeAu).toBe(0)
    expect(read().playing).toBe(false)
  })

  it('syncs catalogue capability metadata only for the mixture still selected', () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'slice',
      resolution: 65,
      superpositionSliceResolutionFloor: 65,
    })
    const terms = read().superpositionTerms

    read().syncSuperpositionCapabilities(terms, 103, 24)
    expect(read().superpositionSliceResolutionFloor).toBe(103)
    expect(read().superpositionStreamlineSeedCountMax).toBe(24)
    expect(read().resolution).toBe(103)

    read().syncSuperpositionCapabilities(
      'a mixture selected after this fetch began',
      201,
      7,
    )
    expect(read().superpositionSliceResolutionFloor).toBe(103)
    expect(read().superpositionStreamlineSeedCountMax).toBe(24)
    expect(read().resolution).toBe(103)
  })

  it('atomically clamps the first streamline request to the selected catalogue ceiling', () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 40,
      superpositionStreamlineSeedCountMax: 40,
    })

    read().setSuperposition(
      '1,0,0,0.7071067811865476;3,2,0,0.7071067811865476',
      '1s + 3d_z²',
      103,
      24,
    )

    expect(read().superpositionStreamlineSeedCountMax).toBe(24)
    expect(read().seedCount).toBe(24)
    expect(planSceneRequest(selectSceneRequestInputs(read()))).toMatchObject({
      status: 'available',
      params: { seed_count: 24 },
    })
  })

  it('atomically clamps a late catalogue sync before it can plan an unsafe request', () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 40,
      superpositionStreamlineSeedCountMax: 40,
    })
    const terms = read().superpositionTerms

    read().syncSuperpositionCapabilities(terms, 65, 17)

    expect(read().superpositionStreamlineSeedCountMax).toBe(17)
    expect(read().seedCount).toBe(17)
    expect(planSceneRequest(selectSceneRequestInputs(read()))).toMatchObject({
      status: 'available',
      params: { seed_count: 17 },
    })
  })

  it('atomically leaves streamlines when a catalogue ceiling cannot prove a safe request', () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 24,
      superpositionStreamlineSeedCountMax: 24,
    })
    const terms = read().superpositionTerms

    read().syncSuperpositionCapabilities(terms, 65, 0)

    expect(read().superpositionStreamlineSeedCountMax).toBe(0)
    expect(read().representation).toBe('isosurface')
    expect(planSceneRequest(selectSceneRequestInputs(read()))).toMatchObject({
      status: 'available',
      endpoint: '/api/superposition/isosurface',
    })
  })

  it('atomically invalidates a stale catalogue ceiling and leaves streamlines', () => {
    useSceneStore.setState({
      mode: 'superposition',
      representation: 'streamlines',
      seedCount: 24,
      superpositionStreamlineSeedCountMax: 24,
    })

    read().invalidateSuperpositionStreamlineCapability()

    expect(read().superpositionStreamlineSeedCountMax).toBeUndefined()
    expect(read().representation).toBe('isosurface')
    expect(planSceneRequest(selectSceneRequestInputs(read()))).toMatchObject({
      status: 'available',
      endpoint: '/api/superposition/isosurface',
    })
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
