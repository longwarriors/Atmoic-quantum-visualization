import { describe, expect, it } from 'vitest'

import {
  type Capability,
  type SceneRequestInputs,
  capabilityFor,
  planSceneRequest,
} from './capability'
import type { OrbitalParameters, RepresentationKind } from './types'

const orbital = (patch: Partial<OrbitalParameters> = {}): OrbitalParameters => ({
  n: 2,
  l: 1,
  m: 0,
  z: 1,
  basis: 'real',
  ...patch,
})

const inputs = (patch: Partial<SceneRequestInputs> = {}): SceneRequestInputs => ({
  mode: 'eigenstate',
  representation: 'point_cloud',
  orbital: orbital(),
  samples: 28000,
  seed: 7,
  resolution: 65,
  probabilityMass: 0.9,
  seedCount: 48,
  superpositionTerms: '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476',
  superpositionBasis: 'complex',
  aMu: 1,
  timeAu: 0,
  ...patch,
})

/** Narrow to the available branch, failing loudly instead of silently skipping. */
function available(capability: Capability) {
  expect(capability.status, JSON.stringify(capability)).toBe('available')
  if (capability.status !== 'available') {
    throw new Error('unreachable: asserted available above')
  }
  return capability
}

describe('capabilityFor: superposition x point_cloud', () => {
  it('is not_implemented, not unsupported, and says why', () => {
    const capability = capabilityFor({
      mode: 'superposition',
      orbital: orbital(),
      representation: 'point_cloud',
    })
    // We never built it; nothing about the physics or the server forbids it.
    // The two refusals are different promises and must not be collapsed.
    expect(capability.status).toBe('not_implemented')
    if (capability.status === 'available') throw new Error('unreachable')
    expect(capability.reason).toContain('point cloud')
    expect(capability.reason).toContain('/api/orbitals/point-cloud')
  })

  it('cannot produce a request plan', () => {
    const plan = planSceneRequest(
      inputs({ mode: 'superposition', representation: 'point_cloud' }),
    )
    expect(plan.status).toBe('not_implemented')
    expect('endpoint' in plan).toBe(false)
    expect('params' in plan).toBe(false)
  })
})

describe('capabilityFor: superposition x streamlines', () => {
  it('names the superposition current-field endpoint, not the eigenstate one', () => {
    const capability = available(
      capabilityFor({
        mode: 'superposition',
        orbital: orbital(),
        representation: 'streamlines',
      }),
    )
    expect(capability.endpoint).toBe('/api/superposition/current-field')
    // The eigenstate route allows 256 seeds; this one allows 128 (routes.py).
    expect(capability.parameters.seedCount).toEqual({ min: 1, max: 128, step: 1 })
    expect(capability.latency).toBe('slow')
  })
})

describe('capabilityFor: eigenstate x streamlines', () => {
  it('refuses n = 7 by naming the route bound the old UI predicate missed', () => {
    const capability = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 7, l: 1, m: 1, basis: 'complex' }),
      representation: 'streamlines',
    })
    expect(capability.status).toBe('unsupported')
    if (capability.status === 'available') throw new Error('unreachable')
    expect(capability.reason).toContain('n <= 6')
    expect(capability.reason).toContain('/api/orbitals/current-field')
  })

  it('refuses l = 6 and |m| = 6 by their own route bounds', () => {
    const highL = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 6, l: 6, m: 1, basis: 'complex' }),
      representation: 'streamlines',
    })
    if (highL.status === 'available') throw new Error('unreachable')
    expect(highL.reason).toContain('l <= 5')

    const highM = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 6, l: 5, m: -6, basis: 'complex' }),
      representation: 'streamlines',
    })
    if (highM.status === 'available') throw new Error('unreachable')
    expect(highM.reason).toContain('|m| <= 5')
  })

  it('refuses a real basis and m = 0 on physics, not on a server bound', () => {
    const real = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 3, l: 2, m: 2, basis: 'real' }),
      representation: 'streamlines',
    })
    expect(real.status).toBe('unsupported')
    if (real.status === 'available') throw new Error('unreachable')
    expect(real.reason).toContain('zero probability current')

    const zeroM = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 3, l: 2, m: 0, basis: 'complex' }),
      representation: 'streamlines',
    })
    if (zeroM.status === 'available') throw new Error('unreachable')
    expect(zeroM.reason).toContain('m = 0')
  })

  it('is available inside every route bound', () => {
    const capability = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 6, l: 5, m: 5, basis: 'complex' }),
        representation: 'streamlines',
      }),
    )
    expect(capability.endpoint).toBe('/api/orbitals/current-field')
    expect(capability.parameters.seedCount).toEqual({ min: 1, max: 256, step: 1 })
  })
})

describe('capabilityFor: eigenstate x isosurface', () => {
  it('transcribes the route bounds, with the resolution floor that n forces', () => {
    const capability = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 3, l: 2, m: 0 }),
        representation: 'isosurface',
      }),
    )
    expect(capability.endpoint).toBe('/api/orbitals/isosurface')
    // max(49, 16n + 17) = 65 at n = 3, and the route caps at 81.
    expect(capability.parameters.resolution).toEqual({ min: 65, max: 81, step: 2 })
    expect(capability.parameters.probabilityMass).toEqual({ min: 0.5, max: 0.99, step: 0.01 })
    expect(capability.latency).toBe('slow')
  })

  it('floors the resolution at 49 for the small n where 16n + 17 is smaller', () => {
    const capability = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 1, l: 0, m: 0 }),
        representation: 'isosurface',
      }),
    )
    expect(capability.parameters.resolution).toEqual({ min: 49, max: 81, step: 2 })
  })

  it('refuses n = 5 by the route bound', () => {
    const capability = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 5, l: 1, m: 0 }),
      representation: 'isosurface',
    })
    expect(capability.status).toBe('unsupported')
    if (capability.status === 'available') throw new Error('unreachable')
    expect(capability.reason).toContain('n <= 4')
  })

  it('refuses l > 3 and |m| > 3 even if some caller hands it n <= 4', () => {
    const highL = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 4, l: 4, m: 0 }),
      representation: 'isosurface',
    })
    if (highL.status === 'available') throw new Error('unreachable')
    expect(highL.reason).toContain('l <= 3')

    const highM = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 4, l: 3, m: -4 }),
      representation: 'isosurface',
    })
    if (highM.status === 'available') throw new Error('unreachable')
    expect(highM.reason).toContain('|m| <= 3')
  })
})

describe('capabilityFor: eigenstate x point_cloud', () => {
  it('transcribes the sampler bounds and is the one fast cell', () => {
    const capability = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 8, l: 7, m: 7, basis: 'complex' }),
        representation: 'point_cloud',
      }),
    )
    expect(capability.endpoint).toBe('/api/orbitals/point-cloud')
    expect(capability.parameters.samples).toEqual({ min: 1000, max: 120000, step: 1000 })
    expect(capability.parameters.seed).toEqual({ min: 0, max: 2147483647, step: 1 })
    expect(capability.latency).toBe('fast')
  })
})

describe('capabilityFor: superposition x isosurface', () => {
  it('allows the whole 49..81 range, because 16n + 17 is an eigenstate rule', () => {
    // A superposition has no single n, so the per-n resolution floor the
    // eigenstate store applies is meaningless here; the route asks only for
    // ge=49, le=81. Carrying the eigenstate floor over would refuse grids the
    // server accepts.
    for (const n of [1, 4, 8]) {
      const capability = available(
        capabilityFor({
          mode: 'superposition',
          orbital: orbital({ n, l: 0, m: 0 }),
          representation: 'isosurface',
        }),
      )
      expect(capability.parameters.resolution).toEqual({ min: 49, max: 81, step: 2 })
    }
  })

  it('names the superposition isosurface endpoint and the route time window', () => {
    const capability = available(
      capabilityFor({
        mode: 'superposition',
        orbital: orbital(),
        representation: 'isosurface',
      }),
    )
    expect(capability.endpoint).toBe('/api/superposition/isosurface')
    expect(capability.parameters.timeAu).toEqual({ min: -1000, max: 1000, step: 0.6 })
    expect(capability.latency).toBe('slow')
  })
})

describe('planSceneRequest: superposition sends every field the route reads', () => {
  it.each([
    ['isosurface', '/api/superposition/isosurface'],
    ['streamlines', '/api/superposition/current-field'],
  ] as const)('spells basis, z and a_mu explicitly for %s', (representation, endpoint) => {
    // The old client sent terms/time/resolution only, so the server silently
    // applied its own defaults for basis, z and a_mu while the UI displayed
    // the user's values. The picture and the caption disagreed.
    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: representation as RepresentationKind,
        orbital: orbital({ z: 2.5 }),
        superpositionBasis: 'real',
        aMu: 1,
        timeAu: 1.2,
      }),
    )
    expect(plan.status).toBe('available')
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.endpoint).toBe(endpoint)
    expect(plan.params.basis).toBe('real')
    expect(plan.params.z).toBe(2.5)
    expect(plan.params.a_mu).toBe(1)
    expect(plan.params.terms).toBe('1,0,0,0.7071067811865476;2,1,0,0.7071067811865476')
    expect(plan.params.time).toBe(1.2)
  })

  it('uses the independent superposition basis, not the eigenstate one', () => {
    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: 'isosurface',
        orbital: orbital({ basis: 'real' }),
        superpositionBasis: 'complex',
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.basis).toBe('complex')
  })
})

describe('planSceneRequest: eigenstate', () => {
  it('sends the state and the sampler parameters', () => {
    const plan = planSceneRequest(
      inputs({ orbital: orbital({ n: 3, l: 1, m: -1, z: 2, basis: 'complex' }) }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.endpoint).toBe('/api/orbitals/point-cloud')
    expect(plan.params).toEqual({
      n: 3,
      l: 1,
      m: -1,
      z: 2,
      basis: 'complex',
      samples: 28000,
      seed: 7,
    })
    expect(plan.latency).toBe('fast')
  })

  it('sends probability_mass and resolution for an isosurface, and nothing else', () => {
    const plan = planSceneRequest(inputs({ representation: 'isosurface' }))
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(Object.keys(plan.params).sort()).toEqual([
      'basis',
      'l',
      'm',
      'n',
      'probability_mass',
      'resolution',
      'z',
    ])
    expect(plan.params.probability_mass).toBe(0.9)
  })

  it('sends seed_count for streamlines', () => {
    const plan = planSceneRequest(
      inputs({
        representation: 'streamlines',
        orbital: orbital({ n: 3, l: 2, m: 2, basis: 'complex' }),
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.endpoint).toBe('/api/orbitals/current-field')
    expect(plan.params.seed_count).toBe(48)
  })

  it('refuses without a plan when the cell is unsupported', () => {
    const plan = planSceneRequest(
      inputs({ representation: 'isosurface', orbital: orbital({ n: 6, l: 1, m: 0 }) }),
    )
    expect(plan.status).toBe('unsupported')
    expect('endpoint' in plan).toBe(false)
  })
})

describe('planSceneRequest: every value it sends is inside the declared bound', () => {
  it('clamps the eigenstate sampler parameters', () => {
    const low = planSceneRequest(inputs({ samples: 12, seed: -5 }))
    if (low.status !== 'available') throw new Error('unreachable')
    expect(low.params.samples).toBe(1000)
    expect(low.params.seed).toBe(0)

    const high = planSceneRequest(inputs({ samples: 10 ** 9, seed: 10 ** 12 }))
    if (high.status !== 'available') throw new Error('unreachable')
    expect(high.params.samples).toBe(120000)
    expect(high.params.seed).toBe(2147483647)
  })

  it('rounds a fractional count the route would reject as a non-integer', () => {
    const plan = planSceneRequest(inputs({ samples: 20000.4 }))
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.samples).toBe(20000)
  })

  it('clamps the isosurface grid up to the floor n forces', () => {
    const plan = planSceneRequest(
      inputs({ representation: 'isosurface', orbital: orbital({ n: 4, l: 3, m: 0 }), resolution: 49 }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.resolution).toBe(81)
  })

  it('clamps probability mass into 0.50..0.99', () => {
    const plan = planSceneRequest(inputs({ representation: 'isosurface', probabilityMass: 1 }))
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.probability_mass).toBe(0.99)
  })

  it('clamps the superposition seed count to 128 and the clock to the route window', () => {
    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: 'streamlines',
        seedCount: 250,
        timeAu: 5000,
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.seed_count).toBe(128)
    expect(plan.params.time).toBe(1000)
  })

  it('leaves a superposition grid the eigenstate floor would have raised', () => {
    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: 'isosurface',
        orbital: orbital({ n: 4, l: 3, m: 0 }),
        resolution: 49,
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.resolution).toBe(49)
  })
})
