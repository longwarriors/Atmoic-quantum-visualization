import { describe, expect, it } from 'vitest'

import type { SceneIdentityInputs } from './sceneRequest'
import {
  createFetchCoordinator,
  nextTimeAu,
  sceneIdentityKey,
  selectSceneRequestInputs,
} from './sceneRequest'

const baseInputs: SceneIdentityInputs = {
  mode: 'superposition',
  superpositionTerms: '1,0,0,0.7071067811865476;2,1,0,0.7071067811865476',
  orbital: { n: 2, l: 1, m: 0, z: 1, basis: 'real' },
  representation: 'isosurface',
  samples: 28000,
  seed: 7,
  resolution: 65,
  probabilityMass: 0.9,
  seedCount: 48,
  aMu: 1,
}

/**
 * What the canvas actually holds: the identity inputs plus the animation clock.
 * The whole point of the key is that the clock is not part of it, so the tests
 * hand `sceneIdentityKey` an object that carries `timeAu` -- a structural
 * supertype TypeScript accepts through a variable -- and pin that the extra
 * field cannot reach the key.
 */
interface StoreSnapshot extends SceneIdentityInputs {
  timeAu: number
}

const snapshot = (patch: Partial<StoreSnapshot> = {}): StoreSnapshot => ({
  ...baseInputs,
  timeAu: 0,
  ...patch,
})

describe('selectSceneRequestInputs', () => {
  const source = {
    ...snapshot(),
    superpositionBasis: 'complex' as const,
    superpositionSliceResolutionFloor: 65,
    superpositionZ: 4,
    plane: 'xz' as const,
    sliceObservable: 'probability_density' as const,
  }

  it('substitutes the superposition charge in the one shared request view', () => {
    const selected = selectSceneRequestInputs(source)

    expect(selected.orbital).toEqual({ ...source.orbital, z: 4 })
    expect(selected.superpositionBasis).toBe('complex')
    expect(selected.timeAu).toBe(0)
  })

  it('leaves the eigenstate charge untouched', () => {
    const selected = selectSceneRequestInputs({ ...source, mode: 'eigenstate' })

    expect(selected.orbital.z).toBe(source.orbital.z)
  })
})

describe('sceneIdentityKey', () => {
  it('is the same string for the same inputs', () => {
    expect(sceneIdentityKey(snapshot())).toBe(sceneIdentityKey(snapshot()))
  })

  it('does not change when only the animation clock moves', () => {
    // The bug this module exists to prevent: if time were part of the scene's
    // identity, every playback frame would count as a new scene and blank the
    // viewport.
    const atZero = sceneIdentityKey(snapshot({ timeAu: 0 }))
    for (const timeAu of [0.6, 1.2, 12.6, 39]) {
      expect(sceneIdentityKey(snapshot({ timeAu })), `t=${timeAu}`).toBe(atZero)
    }
  })

  it('changes when any fetch-relevant input changes', () => {
    const mutations: Partial<StoreSnapshot>[] = [
      { mode: 'eigenstate' },
      { superpositionTerms: '1,0,0,1.0' },
      { orbital: { ...baseInputs.orbital, n: 3 } },
      { orbital: { ...baseInputs.orbital, l: 0 } },
      { orbital: { ...baseInputs.orbital, m: 1 } },
      { orbital: { ...baseInputs.orbital, z: 2 } },
      { orbital: { ...baseInputs.orbital, basis: 'complex' } },
      { representation: 'point_cloud' },
      { representation: 'streamlines' },
      { samples: 30000 },
      { seed: 8 },
      { resolution: 73 },
      { probabilityMass: 0.91 },
      { seedCount: 56 },
    ]
    const keys = [sceneIdentityKey(snapshot()), ...mutations.map((patch) => sceneIdentityKey(snapshot(patch)))]
    expect(new Set(keys).size, `colliding keys: ${keys.join('\n')}`).toBe(keys.length)
  })

  /**
   * The three inputs a slice adds to the scene's identity.
   *
   * Every one of them changes the picture the server returns, and none of them
   * used to reach the key: `plane` and `sliceObservable` were introduced with
   * the slice rows, and `aMu` lived as an appendage inside `assetIdentityKey`
   * where the eigenstate slice -- the one non-superposition route that reads
   * `a_mu` -- could not see it. A key blind to any of the three keeps the old
   * section on screen after the user asks for a different one, which is the
   * failure mode that is hardest to notice: the picture is a perfectly good
   * picture of the wrong thing.
   */
  it('distinguishes slices that differ only in plane, only in observable, or only in a_mu', () => {
    const slice = snapshot({
      representation: 'slice',
      plane: 'xz',
      sliceObservable: 'phase',
      aMu: 1,
    })
    const keys = [
      sceneIdentityKey(slice),
      sceneIdentityKey({ ...slice, plane: 'yz' }),
      sceneIdentityKey({ ...slice, plane: 'xy' }),
      sceneIdentityKey({ ...slice, sliceObservable: 'probability_density' }),
      sceneIdentityKey({ ...slice, sliceObservable: 'wavefunction_real' }),
      // The muonic ratio: a different Bohr length, so a different extent and a
      // different amplitude scale for the phase mask -- a different object.
      sceneIdentityKey({ ...slice, aMu: 0.0054 }),
    ]
    expect(new Set(keys).size, `colliding keys:\n${keys.join('\n')}`).toBe(keys.length)
  })

  it('spells an absent plane and observable as "none", distinct from any real choice', () => {
    // A non-slice scene carries neither, and "absent" must not read as one of
    // the values a slice can hold.
    const absent = sceneIdentityKey(snapshot())
    expect(absent).toContain('plane=none')
    expect(absent).toContain('sliceObservable=none')
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      expect(sceneIdentityKey(snapshot({ plane })), plane).not.toBe(absent)
    }
    expect(sceneIdentityKey(snapshot({ sliceObservable: 'phase' }))).not.toBe(absent)
  })

  it('separates its fields, so one field cannot spell another', () => {
    // A join without separators collides here: `4` + `8x` reads the same as
    // `48` + `x`.
    const left = sceneIdentityKey(snapshot({ seedCount: 4, superpositionTerms: '8x' }))
    const right = sceneIdentityKey(snapshot({ seedCount: 48, superpositionTerms: 'x' }))
    expect(left).not.toBe(right)
  })
})

describe('nextTimeAu', () => {
  const STEP = 0.6
  const FRAMES = 66

  it('advances by one step with exact decimals', () => {
    expect(nextTimeAu(0)).toBe(0.6)
    expect(nextTimeAu(0.6)).toBe(1.2)
    // 1.2 + 0.6 is 1.7999999999999998 in binary floating point; a naive
    // accumulator drifts off the grid here on the third frame.
    expect(nextTimeAu(1.2)).toBe(1.8)
  })

  it('visits exactly 66 frames and nothing else, however long it runs', () => {
    const expected = Array.from({ length: FRAMES }, (_, frame) => Number((frame * STEP).toFixed(3)))
    const seen = new Set<number>()
    let time = 0
    for (let step = 0; step < 500; step += 1) {
      seen.add(time)
      time = nextTimeAu(time)
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(expected)
  })

  it('returns to a bit-identical value after a full lap, from every frame', () => {
    let time = 0
    for (let frame = 0; frame < FRAMES; frame += 1) {
      let lap = time
      for (let step = 0; step < FRAMES; step += 1) {
        lap = nextTimeAu(lap)
      }
      expect(lap, `frame ${frame}`).toBe(time)
      time = nextTimeAu(time)
    }
  })

  it('wraps from the last frame back to zero', () => {
    expect(nextTimeAu(39)).toBe(0)
  })

  it('snaps a time set off the frame grid back onto it', () => {
    // The slider steps by 0.2, so the user can hand playback a time that is
    // not a multiple of 0.6.
    expect(nextTimeAu(12.4)).toBe(13.2)
    expect(nextTimeAu(-0.6)).toBe(0)
  })

  it('does not drift the way the modulo-40 step did', () => {
    // Negative control against the stepping this replaces: 40 is not a whole
    // number of 0.6 steps, so `(t + 0.6) % 40` walks 200 distinct times before
    // it repeats and never revisits the same frame twice in a lap.
    const legacyStep = (time: number): number => Number(((time + 0.6) % 40).toFixed(3))
    const legacySeen = new Set<number>()
    let legacyTime = 0
    for (let step = 0; step < 500; step += 1) {
      legacySeen.add(legacyTime)
      legacyTime = legacyStep(legacyTime)
    }
    expect(legacySeen.size).toBe(200)

    const seen = new Set<number>()
    let time = 0
    for (let step = 0; step < 500; step += 1) {
      seen.add(time)
      time = nextTimeAu(time)
    }
    expect(seen.size).toBe(FRAMES)
  })

  it('closes exactly on a catalogue beat period instead of jumping at 39.6 a.u.', () => {
    const period = (2 * Math.PI) / 0.375
    const frames = Math.ceil(period / STEP)
    const seen = new Set<number>()
    let time = 0

    for (let frame = 0; frame < frames; frame += 1) {
      seen.add(time)
      time = nextTimeAu(time, period)
    }

    expect(frames).toBe(28)
    expect(seen.size).toBe(frames)
    expect(time).toBe(0)
  })

  it.each([12.1, (2 * Math.PI) / 0.375])(
    'snaps every frame of period %s to the visible 0.2-a.u. lattice',
    (period) => {
      const frames = Math.ceil(period / STEP)
      let time = 0
      for (let frame = 0; frame < frames; frame += 1) {
        expect(time / 0.2).toBeCloseTo(Math.round(time / 0.2), 12)
        expect(String(time)).toMatch(/^\d+(?:\.\d)?$/)
        time = nextTimeAu(time, period)
      }
      expect(time).toBe(0)
    },
  )

  it('keeps a degenerate preset stationary and fails closed for a bad period', () => {
    expect(nextTimeAu(12, 0)).toBe(0)
    expect(nextTimeAu(12, Number.NaN)).toBe(0)
    expect(nextTimeAu(Number.NaN, 12)).toBe(0)
  })
})

describe('fetch coordinator', () => {
  const key = sceneIdentityKey(baseInputs)
  const otherKey = sceneIdentityKey({ ...baseInputs, resolution: 73 })

  it('clears the scene and fetches when the scene identity changes', () => {
    const coordinator = createFetchCoordinator()
    expect(coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })).toEqual({
      startFetch: true,
      clearScene: true,
      abortPrevious: true,
    })
  })

  it('clears the scene again on a later identity change', () => {
    // Negative control: an implementation that only cleared on the first load
    // would leave an n=2 mesh on screen while n=3 is fetched.
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.onResponse(0)
    expect(coordinator.onInputsChanged({ identityKey: otherKey, timeAu: 0 })).toEqual({
      startFetch: true,
      clearScene: true,
      abortPrevious: true,
    })
  })

  it('fetches a new time without clearing anything when nothing is in flight', () => {
    // Negative control for the flicker itself: clearing here is the bug.
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.onResponse(0)
    expect(coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })).toEqual({
      startFetch: true,
      clearScene: false,
      abortPrevious: false,
    })
  })

  it('never aborts an in-flight request for a time change', () => {
    // Negative control for the starvation case: aborting on every tick is how
    // a round trip slower than the tick interval renders nothing at all.
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    for (const timeAu of [0.6, 1.2, 1.8]) {
      expect(coordinator.onInputsChanged({ identityKey: key, timeAu }), `t=${timeAu}`).toEqual({
        startFetch: false,
        clearScene: false,
        abortPrevious: false,
      })
    }
  })

  it('remembers only the newest queued time', () => {
    // Negative control: keeping the FIRST queued time would replay stale
    // frames and fall further behind the clock with every tick.
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })
    coordinator.onInputsChanged({ identityKey: key, timeAu: 1.2 })
    coordinator.onInputsChanged({ identityKey: key, timeAu: 1.8 })
    expect(coordinator.onResponse(0)).toEqual({ refetchTime: 1.8 })
    // The caller starts that refetch, so the next tick queues behind it rather
    // than opening a second request.
    expect(coordinator.onInputsChanged({ identityKey: key, timeAu: 2.4 })).toEqual({
      startFetch: false,
      clearScene: false,
      abortPrevious: false,
    })
  })

  it('reports nothing to refetch when no time is queued', () => {
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    expect(coordinator.onResponse(0)).toEqual({ refetchTime: null })
  })

  it('does not refetch a time that just arrived', () => {
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })
    coordinator.onResponse(0)
    // The render for 0.6 is now in flight; React re-runs the effect for the
    // same time it already queued.
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })
    expect(coordinator.onResponse(0.6)).toEqual({ refetchTime: null })
  })

  it('drops a queued time when the identity changes under it', () => {
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })
    coordinator.onInputsChanged({ identityKey: otherKey, timeAu: 0 })
    expect(coordinator.onResponse(0)).toEqual({ refetchTime: null })
  })

  it('keeps playing after a failed request', () => {
    // A request that errors must release the in-flight slot, or the next tick
    // queues forever and playback stops for good.
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })
    expect(coordinator.onError(0)).toEqual({ refetchTime: 0.6 })
    // The refetch for 0.6 is in flight, so the next tick queues behind it.
    expect(coordinator.onInputsChanged({ identityKey: key, timeAu: 1.2 })).toEqual({
      startFetch: false,
      clearScene: false,
      abortPrevious: false,
    })
    expect(coordinator.onResponse(0.6)).toEqual({ refetchTime: 1.2 })
  })

  it('accepts the next time normally after an error with nothing queued', () => {
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    expect(coordinator.onError(0)).toEqual({ refetchTime: null })
    expect(coordinator.onInputsChanged({ identityKey: key, timeAu: 0.6 })).toEqual({
      startFetch: true,
      clearScene: false,
      abortPrevious: false,
    })
  })

  it('treats the scene as new again after a reset', () => {
    // The canvas resets on unmount; React StrictMode unmounts and remounts
    // once in development, and the remount has to fetch again.
    const coordinator = createFetchCoordinator()
    coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    coordinator.reset()
    expect(coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })).toEqual({
      startFetch: true,
      clearScene: true,
      abortPrevious: true,
    })
  })

  it('keeps the last frame on screen and keeps rendering when the round trip is slower than the clock', () => {
    // The whole bug in one simulation: 30 playback ticks at a latency of two
    // ticks per response.
    const coordinator = createFetchCoordinator()
    const fetched: number[] = []
    let inFlightTime: number | null = null
    let cleared = 0
    let rendered = 0
    const startFetch = (timeAu: number): void => {
      fetched.push(timeAu)
      inFlightTime = timeAu
    }

    const first = coordinator.onInputsChanged({ identityKey: key, timeAu: 0 })
    if (first.clearScene) cleared += 1
    if (first.startFetch) startFetch(0)

    let time = 0
    for (let tick = 0; tick < 30; tick += 1) {
      time = nextTimeAu(time)
      const decision = coordinator.onInputsChanged({ identityKey: key, timeAu: time })
      if (decision.clearScene) cleared += 1
      expect(decision.abortPrevious, `tick ${tick}`).toBe(false)
      if (decision.startFetch) startFetch(time)

      if (tick % 2 === 1 && inFlightTime !== null) {
        const landed = inFlightTime
        inFlightTime = null
        rendered += 1
        const { refetchTime } = coordinator.onResponse(landed)
        if (refetchTime !== null) startFetch(refetchTime)
      }
    }

    expect(cleared, 'the viewport blanked during playback').toBe(1)
    expect(rendered, 'playback starved: frames were requested but none arrived').toBe(15)
    expect(fetched).toEqual([...fetched].sort((a, b) => a - b))
    expect(new Set(fetched).size).toBe(fetched.length)
  })
})
