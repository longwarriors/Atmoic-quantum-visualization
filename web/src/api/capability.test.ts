import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

import { executeSceneRequest } from '../components/useSceneAsset'
import {
  CAPABILITY_ROUTE_CONSTRAINTS,
  type Capability,
  type SceneKind,
  type SceneRequestInputs,
  capabilityFor,
  planSceneRequest,
} from './capability'
import type { OrbitalParameters, RepresentationKind } from './types'

/**
 * The seven fetchers `executeSceneRequest` dispatches to, stubbed.
 *
 * The subset guard below asks one question -- "does every representation the
 * panel offers reach a fetcher?" -- and the honest way to ask it is to run the
 * dispatcher, because its coverage lives in a `switch` over endpoint strings
 * that nothing can enumerate from the outside. Stubbing the transport keeps
 * that a question about the dispatch table and not about the network.
 */
vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  const stub = async (): Promise<never> => ({}) as never
  return {
    ...actual,
    fetchPointCloud: stub,
    fetchIsosurface: stub,
    fetchCurrentField: stub,
    fetchSlice: stub,
    fetchSuperpositionIsosurface: stub,
    fetchSuperpositionSlice: stub,
    fetchSuperpositionCurrentField: stub,
  }
})

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
    // The eigenstate route allows 96 seeds; this one allows 40 (routes.py).
    expect(capability.parameters.seedCount).toEqual({ min: 1, max: 40, step: 1 })
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
    expect(capability.reason).toContain('n ≤ 6')
    expect(capability.reason).toContain('/api/orbitals/current-field')
  })

  it('refuses l = 6 and |m| = 6 by their own route bounds', () => {
    const highL = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 6, l: 6, m: 1, basis: 'complex' }),
      representation: 'streamlines',
    })
    if (highL.status === 'available') throw new Error('unreachable')
    expect(highL.reason).toContain('l ≤ 5')

    const highM = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 6, l: 5, m: -6, basis: 'complex' }),
      representation: 'streamlines',
    })
    if (highM.status === 'available') throw new Error('unreachable')
    expect(highM.reason).toContain('|m| ≤ 5')
  })

  it('refuses a real basis and m = 0 on physics, not on a server bound', () => {
    const real = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 3, l: 2, m: 2, basis: 'real' }),
      representation: 'streamlines',
    })
    expect(real.status).toBe('unsupported')
    if (real.status === 'available') throw new Error('unreachable')
    expect(real.reason).toContain('probability current 恒为 0')

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
    expect(capability.parameters.seedCount).toEqual({ min: 1, max: 96, step: 1 })
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
    expect(capability.reason).toContain('n ≤ 4')
  })

  it.each([3, 4])('refuses %ss because every public grid exceeds the topology cap', (n) => {
    const capability = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n, l: 0, m: 0 }),
      representation: 'isosurface',
    })
    expect(capability.status).toBe('unsupported')
    if (capability.status === 'available') throw new Error('unreachable')
    expect(capability.reason).toContain(`${n}s`)
    expect(capability.reason).toContain('全部公开 resolution')
    expect(capability.reason).toContain('切片')
  })

  it('refuses l > 3 and |m| > 3 even if some caller hands it n <= 4', () => {
    const highL = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 4, l: 4, m: 0 }),
      representation: 'isosurface',
    })
    if (highL.status === 'available') throw new Error('unreachable')
    expect(highL.reason).toContain('l ≤ 3')

    const highM = capabilityFor({
      mode: 'eigenstate',
      orbital: orbital({ n: 4, l: 3, m: -4 }),
      representation: 'isosurface',
    })
    if (highM.status === 'available') throw new Error('unreachable')
    expect(highM.reason).toContain('|m| ≤ 3')
  })
})

describe('server numerical validation metadata', () => {
  it.each([
    ['eigenstate', 'isosurface'],
    ['eigenstate', 'slice'],
    ['superposition', 'isosurface'],
    ['superposition', 'slice'],
  ] as const)('%s / %s stays requestable but declares its numerical gate', (mode, representation) => {
    const capability = available(capabilityFor({ mode, orbital: orbital(), representation }))
    expect(capability.serverValidation?.reason).toContain('服务端')
    expect(capability.serverValidation?.reason).toContain('fail-closed')
  })

  it.each([
    ['eigenstate', 'point_cloud'],
    ['eigenstate', 'streamlines'],
    ['superposition', 'streamlines'],
  ] as const)('%s / %s makes no numerical-validation promise', (mode, representation) => {
    const state =
      representation === 'streamlines' && mode === 'eigenstate'
        ? orbital({ n: 2, l: 1, m: 1, basis: 'complex' })
        : orbital()
    const capability = available(
      capabilityFor({
        mode,
        orbital: state,
        representation,
      }),
    )
    expect(capability.serverValidation).toBeUndefined()
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
    expect(capability.parameters.timeAu).toEqual({ min: -1000, max: 1000, step: 0.2 })
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
  it.each(['eigenstate', 'superposition'] as const)(
    'clamps %s charge through the OpenAPI-checked fixed constraint',
    (mode) => {
      const representation = mode === 'superposition' ? 'isosurface' : 'point_cloud'
      const low = planSceneRequest(inputs({ mode, representation, orbital: orbital({ z: -2 }) }))
      const high = planSceneRequest(inputs({ mode, representation, orbital: orbital({ z: 200 }) }))
      if (low.status !== 'available' || high.status !== 'available') {
        throw new Error('unreachable')
      }
      expect(low.params.z).toBe(0.1)
      expect(high.params.z).toBe(20)
    },
  )

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

  it('clamps the superposition seed count to 40 and the clock to the route window', () => {
    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: 'streamlines',
        seedCount: 250,
        timeAu: 5000,
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.seed_count).toBe(40)
    expect(plan.params.time).toBe(1000)
  })

  it('preserves clock values that lie on the slider grid', () => {
    for (const timeAu of [0, 8.4]) {
      const plan = planSceneRequest(
        inputs({ mode: 'superposition', representation: 'slice', timeAu }),
      )
      if (plan.status !== 'available') throw new Error('unreachable')
      expect(plan.params.time).toBe(timeAu)
    }
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

describe('capabilityFor: eigenstate x slice', () => {
  it('names the slice route, not the row that happened to be last', () => {
    // The matrix used to end each mode's dispatch with a bare `return
    // <streamlines>` fallback, so a representation nobody had written a row
    // for was handed the current-field capability -- endpoint, bounds and all.
    // This orbital is deliberately one the streamline row ACCEPTS (complex,
    // m != 0, inside n <= 6), so the fallback would answer `available` with
    // /api/orbitals/current-field and no test asserting merely "available"
    // would notice.
    const capability = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 3, l: 2, m: 1, basis: 'complex' }),
        representation: 'slice',
      }),
    )
    expect(capability.endpoint).toBe('/api/orbitals/slice')
  })

  it('transcribes the slice resolution window with the floor n forces', () => {
    // The route's outer window is 65..513; state-specific numerical floors are
    // layered on top. These two non-s states exercise the shell-count branch.
    const low = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 2, l: 1, m: 0 }),
        representation: 'slice',
      }),
    )
    expect(low.parameters.resolution).toEqual({ min: 65, max: 513, step: 2 })

    const high = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n: 8, l: 7, m: 0 }),
        representation: 'slice',
      }),
    )
    // 16 * 8 + 17 = 145; l=7 has no narrower radial-node requirement.
    expect(high.parameters.resolution).toEqual({ min: 145, max: 513, step: 2 })
  })

  it.each([
    [4, 97],
    [5, 141],
    [6, 193],
    [7, 251],
    [8, 319],
  ] as const)('derives the state-specific %ss floor as %s', (n, floor) => {
    const capability = available(
      capabilityFor({
        mode: 'eigenstate',
        orbital: orbital({ n, l: 0, m: 0 }),
        representation: 'slice',
      }),
    )

    expect(capability.parameters.resolution).toEqual({ min: floor, max: 513, step: 2 })
  })

  it('declares a_mu, the one eigenstate route that reads it', () => {
    const capability = available(
      capabilityFor({ mode: 'eigenstate', orbital: orbital(), representation: 'slice' }),
    )
    expect(capability.parameters.aMu).toEqual({ min: 0.005, max: 20, step: 0.005 })
  })

  it('is available for every state the panel can reach, as the point cloud is', () => {
    // /api/orbitals/slice and /api/orbitals/point-cloud carry identical state
    // ceilings (n le=12, l le=11, |m| le=11), both above the panel's own n <= 8
    // clamp, so neither row refuses on the state.
    for (const state of [
      orbital({ n: 1, l: 0, m: 0 }),
      orbital({ n: 8, l: 7, m: -7, basis: 'complex' }),
    ]) {
      const capability = capabilityFor({
        mode: 'eigenstate',
        orbital: state,
        representation: 'slice',
      })
      expect(capability.status, JSON.stringify(state)).toBe('available')
    }
  })

  it('carries the planes and observables the slice routes accept', () => {
    const capability = available(
      capabilityFor({ mode: 'eigenstate', orbital: orbital(), representation: 'slice' }),
    )
    expect(capability.planes).toEqual(['xy', 'xz', 'yz'])
    expect(capability.observables).toEqual([
      'probability_density',
      'wavefunction_real',
      'wavefunction_imag',
      'phase',
    ])
  })
})

describe('capabilityFor: superposition x slice', () => {
  it('names the superposition slice endpoint and declares time and a_mu', () => {
    const capability = available(
      capabilityFor({ mode: 'superposition', orbital: orbital(), representation: 'slice' }),
    )
    expect(capability.endpoint).toBe('/api/superposition/slice')
    expect(capability.parameters.timeAu).toEqual({ min: -1000, max: 1000, step: 0.2 })
    expect(capability.parameters.aMu).toEqual({ min: 0.005, max: 20, step: 0.005 })
    expect(capability.planes).toEqual(['xy', 'xz', 'yz'])
    expect(capability.observables).toEqual([
      'probability_density',
      'wavefunction_real',
      'wavefunction_imag',
      'phase',
    ])
  })

  it('falls back to 65..513 when a non-catalogue caller supplies no published floor', () => {
    // The matrix never parses terms or reimplements radial numerics. A caller
    // outside the curated catalogue still gets the route's outer range, with
    // serverValidation explaining that a builder 422 remains possible.
    for (const n of [1, 4, 8]) {
      const capability = available(
        capabilityFor({
          mode: 'superposition',
          orbital: orbital({ n, l: 0, m: 0 }),
          representation: 'slice',
        }),
      )
      expect(capability.parameters.resolution).toEqual({ min: 65, max: 513, step: 2 })
    }
  })

  it('uses the builder floor published for the selected catalogue mixture', () => {
    const capability = available(
      capabilityFor({
        mode: 'superposition',
        orbital: orbital(),
        representation: 'slice',
        superpositionSliceResolutionFloor: 103,
      }),
    )
    expect(capability.parameters.resolution).toEqual({ min: 103, max: 513, step: 2 })

    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: 'slice',
        superpositionTerms: '1,0,0,0.7071067811865476;3,2,0,0.7071067811865476',
        superpositionSliceResolutionFloor: 103,
        resolution: 65,
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.resolution).toBe(103)
  })
})

describe('capabilityFor: a_mu is declared only where the route reads it', () => {
  // routes.py reads `a_mu` on four routes: both superposition scene routes and
  // both slice routes. Declaring it anywhere else would send a query parameter
  // the route ignores; declaring it nowhere is what let it be spelled into the
  // superposition params by hand, outside the bound the matrix states.
  it.each([
    ['eigenstate', 'slice', true],
    ['superposition', 'slice', true],
    ['superposition', 'isosurface', true],
    ['superposition', 'streamlines', true],
    ['eigenstate', 'point_cloud', false],
    ['eigenstate', 'isosurface', false],
    ['eigenstate', 'streamlines', false],
  ] as const)('%s x %s declares a_mu: %s', (mode, representation, declared) => {
    const capability = available(
      capabilityFor({
        mode,
        orbital: orbital({ n: 3, l: 2, m: 1, basis: 'complex' }),
        representation,
      }),
    )
    expect(capability.parameters.aMu !== undefined).toBe(declared)
  })

  it('is inside its bound in every plan that sends it, and absent from the rest', () => {
    const clamped = planSceneRequest(
      inputs({ mode: 'superposition', representation: 'isosurface', aMu: 0 }),
    )
    if (clamped.status !== 'available') throw new Error('unreachable')
    // The route's lower bound is OPEN (gt=0.0), so 0 is not a value it accepts.
    expect(clamped.params.a_mu).toBe(0.005)

    const eigenstate = planSceneRequest(inputs({ representation: 'isosurface', aMu: 3 }))
    if (eigenstate.status !== 'available') throw new Error('unreachable')
    expect('a_mu' in eigenstate.params).toBe(false)
  })
})

describe('planSceneRequest: slice', () => {
  it('sends the state, the grid, a_mu, the plane and the observable', () => {
    const plan = planSceneRequest(
      inputs({
        representation: 'slice',
        orbital: orbital({ n: 3, l: 1, m: -1, z: 2, basis: 'complex' }),
        resolution: 129,
        aMu: 0.5,
        plane: 'yz',
        sliceObservable: 'phase',
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.endpoint).toBe('/api/orbitals/slice')
    expect(plan.params).toEqual({
      n: 3,
      l: 1,
      m: -1,
      z: 2,
      basis: 'complex',
      resolution: 129,
      a_mu: 0.5,
      plane: 'yz',
      observable: 'phase',
    })
  })

  it('sends the superposition slice its terms, clock and plane', () => {
    const plan = planSceneRequest(
      inputs({
        mode: 'superposition',
        representation: 'slice',
        superpositionBasis: 'complex',
        timeAu: 1.2,
        plane: 'xy',
        sliceObservable: 'wavefunction_real',
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.endpoint).toBe('/api/superposition/slice')
    expect(plan.params.terms).toBe('1,0,0,0.7071067811865476;2,1,0,0.7071067811865476')
    expect(plan.params.time).toBe(1.2)
    expect(plan.params.plane).toBe('xy')
    expect(plan.params.observable).toBe('wavefunction_real')
    expect(plan.params.a_mu).toBe(1)
  })

  it("falls back to the routes' own defaults when the caller states neither", () => {
    // routes.py: `plane: PrincipalPlane = PrincipalPlane.XZ`,
    // `observable: SliceObservable = SliceObservable.PROBABILITY_DENSITY`.
    const plan = planSceneRequest(inputs({ representation: 'slice' }))
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.plane).toBe('xz')
    expect(plan.params.observable).toBe('probability_density')
  })

  it('refuses a plane or observable the row does not declare', () => {
    // Same discipline as clampParameter: a value outside what the capability
    // states never leaves, so the request cannot become a 422 the matrix
    // promised it would not.
    const plan = planSceneRequest(
      inputs({
        representation: 'slice',
        plane: 'zz' as never,
        sliceObservable: 'current_density' as never,
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.plane).toBe('xz')
    expect(plan.params.observable).toBe('probability_density')
  })

  it('clamps the slice grid up to the floor n forces', () => {
    const plan = planSceneRequest(
      inputs({ representation: 'slice', orbital: orbital({ n: 8, l: 7, m: 0 }), resolution: 65 }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.resolution).toBe(145)
  })

  it.each([
    [4, 97],
    [5, 141],
    [6, 193],
    [7, 251],
    [8, 319],
  ] as const)('never plans the first %ss request below %s', (n, floor) => {
    const plan = planSceneRequest(
      inputs({
        representation: 'slice',
        orbital: orbital({ n, l: 0, m: 0 }),
        resolution: 65,
      }),
    )
    if (plan.status !== 'available') throw new Error('unreachable')
    expect(plan.params.resolution).toBe(floor)
  })

  it('never spells a plane onto a row that declares none', () => {
    for (const representation of ['point_cloud', 'isosurface'] as const) {
      const plan = planSceneRequest(inputs({ representation }))
      if (plan.status !== 'available') throw new Error('unreachable')
      expect('plane' in plan.params, representation).toBe(false)
      expect('observable' in plan.params, representation).toBe(false)
    }
  })
})

interface OpenApiParameter {
  in: string
  name: string
  schema: {
    minimum?: number
    exclusiveMinimum?: number
    maximum?: number
  }
}

interface OpenApiDocument {
  paths: Record<string, { get?: { parameters?: OpenApiParameter[] } }>
}

const OPENAPI_FIXTURE = fileURLToPath(
  new URL('../../../tests/fixtures/openapi.json', import.meta.url),
)

function queryParameter(
  document: OpenApiDocument,
  endpoint: string,
  wireName: string,
): OpenApiParameter {
  const parameter = document.paths[endpoint]?.get?.parameters?.find(
    (candidate) => candidate.in === 'query' && candidate.name === wireName,
  )
  if (parameter === undefined) {
    throw new Error(`${endpoint} has no OpenAPI query parameter ${wireName}`)
  }
  return parameter
}

describe('capability route constraints cannot drift from OpenAPI', () => {
  const document = JSON.parse(readFileSync(OPENAPI_FIXTURE, 'utf-8')) as OpenApiDocument

  it('mechanically matches every numeric capability bound to its route schema', () => {
    for (const route of Object.values(CAPABILITY_ROUTE_CONSTRAINTS)) {
      for (const constraint of [
        ...Object.values(route.parameters),
        ...Object.values(route.fixedParameters),
      ]) {
        const parameter = queryParameter(document, route.endpoint, constraint.wireName)
        expect(parameter.schema.maximum, `${route.endpoint} ${constraint.wireName} max`).toBe(
          constraint.uiBound.max,
        )
        if ('serverExclusiveMinimum' in constraint) {
          expect(
            parameter.schema.exclusiveMinimum,
            `${route.endpoint} ${constraint.wireName} exclusive min`,
          ).toBe(constraint.serverExclusiveMinimum)
        } else {
          expect(parameter.schema.minimum, `${route.endpoint} ${constraint.wireName} min`).toBe(
            constraint.uiBound.min,
          )
        }
      }
    }
  })

  it('mechanically matches every eigenstate route ceiling used by capability refusals', () => {
    for (const route of Object.values(CAPABILITY_ROUTE_CONSTRAINTS)) {
      if (!('state' in route)) continue
      const state = route.state
      expect(queryParameter(document, route.endpoint, 'n').schema.maximum).toBe(state.nMax)
      expect(queryParameter(document, route.endpoint, 'l').schema.maximum).toBe(state.lMax)
      const m = queryParameter(document, route.endpoint, 'm').schema
      expect(m.minimum).toBe(-state.absoluteMMax)
      expect(m.maximum).toBe(state.absoluteMMax)
    }
  })
})

/**
 * Every member of RepresentationKind, as a value the compiler checks.
 *
 * A fifth member added to the union without a row in the matrix makes THIS
 * OBJECT LITERAL fail to compile ("property is missing"), and `tsc -p
 * tsconfig.test.json --noEmit` runs before vitest in the `test` chain, so the
 * failure lands before a single test executes. That is the point: the runtime
 * loops below can only iterate members somebody remembered to list, so the
 * list itself has to be the compiler's problem.
 */
const ALL_REPRESENTATIONS: Record<RepresentationKind, true> = {
  point_cloud: true,
  isosurface: true,
  slice: true,
  streamlines: true,
}

const EVERY_REPRESENTATION = Object.keys(ALL_REPRESENTATIONS) as RepresentationKind[]
const EVERY_MODE: SceneKind[] = ['eigenstate', 'superposition']

const CONTROL_PANEL = fileURLToPath(new URL('../components/ControlPanel.tsx', import.meta.url))

/**
 * The `id` of each entry in ControlPanel.tsx's REPRESENTATIONS list.
 *
 * Read from the source rather than imported, because that array is
 * module-private and this file must not be the reason it becomes part of the
 * component's API. Parsed rather than grepped, so a reformatting cannot make
 * the guard quietly find nothing: a missing array literal throws here instead
 * of yielding an empty list that every assertion below would pass against.
 */
function controlPanelRepresentationIds(): string[] {
  const parsed = ts.createSourceFile(
    CONTROL_PANEL,
    readFileSync(CONTROL_PANEL, 'utf-8'),
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  )
  const ids: string[] = []
  let found = false
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'REPRESENTATIONS') {
        continue
      }
      const initializer = declaration.initializer
      if (initializer === undefined || !ts.isArrayLiteralExpression(initializer)) continue
      found = true
      for (const element of initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue
        for (const property of element.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'id' &&
            ts.isStringLiteralLike(property.initializer)
          ) {
            ids.push(property.initializer.text)
          }
        }
      }
    }
  }
  if (!found) {
    throw new Error(
      `${CONTROL_PANEL}: no \`const REPRESENTATIONS = [ ... ]\` array literal found. ` +
        'This guard reads that list from the source; re-point it rather than deleting it.',
    )
  }
  return ids
}

describe('the matrix answers for every representation there is', () => {
  it.each(
    EVERY_MODE.flatMap((mode) =>
      EVERY_REPRESENTATION.map((representation) => [mode, representation] as const),
    ),
  )('%s x %s is a discriminated answer, not a throw', (mode, representation) => {
    const capability = capabilityFor({
      mode,
      orbital: orbital({ n: 3, l: 2, m: 1, basis: 'complex' }),
      representation,
    })
    expect(['available', 'unsupported', 'not_implemented']).toContain(capability.status)
    if (capability.status === 'available') {
      // The available branch carries a request; the refusals carry a sentence.
      expect(capability.endpoint).toMatch(/^\/api\//)
      expect('reason' in capability).toBe(false)
    } else {
      expect(capability.reason.length).toBeGreaterThan(0)
      expect('endpoint' in capability).toBe(false)
    }
  })

  it('throws on a representation it has no row for, instead of serving the last one', () => {
    // The exhaustive `switch`'s `default` arm. Reachable only from a caller
    // that has left the union behind, which is exactly when the old bare
    // fallback silently answered with the streamline row.
    for (const mode of EVERY_MODE) {
      expect(() =>
        capabilityFor({
          mode,
          orbital: orbital(),
          representation: 'hologram' as RepresentationKind,
        }),
      ).toThrow(/hologram/)
    }
  })
})

describe('the panel offers no representation the dispatcher cannot fetch', () => {
  const panelIds = controlPanelRepresentationIds()

  it('offers exactly the four representations that have a renderer today', () => {
    // The slice row spent one PR in the matrix with no button, because a button
    // for a scene nothing can draw is worse than no button. The renderer landed,
    // so the button did: this list is the pin that keeps the two in step, and
    // adding a fifth representation means editing it in the PR that draws it.
    expect(panelIds).toEqual(['point_cloud', 'isosurface', 'slice', 'streamlines'])
  })

  it.each(panelIds.flatMap((id) => EVERY_MODE.map((mode) => [mode, id] as const)))(
    'reaches a fetcher for %s x %s',
    async (mode, id) => {
      const representation = id as RepresentationKind
      expect(EVERY_REPRESENTATION, id).toContain(representation)
      const plan = planSceneRequest(
        inputs({
          mode,
          representation,
          orbital: orbital({ n: 3, l: 2, m: 1, basis: 'complex' }),
        }),
      )
      if (plan.status !== 'available') {
        // A refused cell is the panel's disabled button with a stated reason,
        // not a hole in the dispatch table. Asserted rather than returned
        // silently, so this case still measures something.
        expect(plan.reason.length, `${mode} x ${id}`).toBeGreaterThan(0)
        return
      }
      const asset = await executeSceneRequest(
        plan,
        inputs({ mode, representation }),
        new AbortController().signal,
      )
      expect(asset.kind.length, `${mode} x ${id}`).toBeGreaterThan(0)
    },
  )

  it('would notice a missing fetcher (positive control)', async () => {
    await expect(
      executeSceneRequest(
        { status: 'available', endpoint: '/api/orbitals/hologram', params: {}, latency: 'fast' },
        inputs(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('No client fetcher serves /api/orbitals/hologram.')
  })
})
