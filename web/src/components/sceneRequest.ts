import type {
  BasisKind,
  OrbitalParameters,
  PrincipalPlane,
  RepresentationKind,
  SliceObservable,
} from '../api/types'
import { TIME_GRID_STEP_AU, type SceneRequestInputs } from '../api/capability'
import type { SceneMode } from '../state/useSceneStore'

/**
 * Exactly the store fields that can change a scene request.
 *
 * Both the control panel and the canvas consume this shape through
 * `selectSceneRequestInputs`. Keeping the mode-dependent charge substitution
 * here prevents those two views from planning two different superpositions.
 */
export interface SceneInputSource {
  mode: SceneMode
  orbital: OrbitalParameters
  representation: RepresentationKind
  samples: number
  seed: number
  resolution: number
  probabilityMass: number
  seedCount: number
  superpositionTerms: string
  superpositionSliceResolutionFloor: number
  superpositionBasis: BasisKind
  superpositionZ: number
  aMu: number
  timeAu: number
  plane: PrincipalPlane
  sliceObservable: SliceObservable
}

/** The one store-to-request translation used by every request-aware view. */
export function selectSceneRequestInputs(state: SceneInputSource): SceneRequestInputs {
  return {
    mode: state.mode,
    orbital:
      state.mode === 'superposition'
        ? { ...state.orbital, z: state.superpositionZ }
        : state.orbital,
    representation: state.representation,
    samples: state.samples,
    seed: state.seed,
    resolution: state.resolution,
    probabilityMass: state.probabilityMass,
    seedCount: state.seedCount,
    superpositionTerms: state.superpositionTerms,
    superpositionSliceResolutionFloor: state.superpositionSliceResolutionFloor,
    superpositionBasis: state.superpositionBasis,
    aMu: state.aMu,
    timeAu: state.timeAu,
    plane: state.plane,
    sliceObservable: state.sliceObservable,
  }
}

/**
 * Everything the canvas sends to the server EXCEPT the animation clock.
 *
 * The split is the whole point. Changing one of these asks for a different
 * physical object, so whatever is on screen has become untrue and must go.
 * Changing the time asks for a later moment of the SAME object, and the frame
 * already on screen stays true enough to look at until the next one arrives.
 */
export interface SceneIdentityInputs {
  mode: SceneMode
  superpositionTerms: string
  orbital: OrbitalParameters
  representation: RepresentationKind
  samples: number
  seed: number
  resolution: number
  probabilityMass: number
  seedCount: number
  /**
   * The reduced-mass ratio a_mu, part of the core identity rather than a
   * superposition-only appendage.
   *
   * It used to be spelled onto the key by `assetIdentityKey` alongside the
   * superposition's basis, on the assumption that only the superposition routes
   * read it. `/api/orbitals/slice` reads it too -- it is the one eigenstate
   * route that does -- and a_mu rescales both the derived extent and the
   * amplitude scale the phase mask is referenced to, so two eigenstate slices
   * differing only in a_mu are two different pictures.
   */
  aMu: number
  /**
   * The plane a slice is cut on and the field it carries, absent on every
   * scene that is not a slice.
   *
   * Optional because only the two slice rows have them; encoded as `none` when
   * absent so that "this scene has no plane" is a value of its own rather than
   * a gap that reads as whichever plane was asked for last.
   */
  plane?: PrincipalPlane
  sliceObservable?: SliceObservable
}

export interface FetchDecision {
  /** Issue a request for the time that came with these inputs. */
  startFetch: boolean
  /** Drop the rendered assets: they no longer describe the requested state. */
  clearScene: boolean
  /** Cancel the request in flight; its answer is about a state nobody asked for. */
  abortPrevious: boolean
}

export interface ResponseDecision {
  /** A time that arrived while the request was in flight, or null. */
  refetchTime: number | null
}

export interface FetchCoordinator {
  onInputsChanged(inputs: { identityKey: string; timeAu: number }): FetchDecision
  onResponse(forTime: number): ResponseDecision
  onError(forTime: number): ResponseDecision
  reset(): void
}

/**
 * A stable string over the scene's identity, with the clock deliberately left
 * out: `sceneIdentityKey(x) === sceneIdentityKey(y)` means x and y are two
 * moments of one object.
 *
 * Fields are separated rather than concatenated, and the one free-form field
 * (the superposition terms) goes last, so no value can spell out another
 * field's and collide with it.
 *
 * The two optional fields are spelled `plane=none` / `sliceObservable=none`
 * when absent rather than omitted: an omitted field would make the key of a
 * scene that has no plane a PREFIX-compatible neighbour of one that does, and
 * "absent" is a state the key has to be able to say.
 */
export function sceneIdentityKey(inputs: SceneIdentityInputs): string {
  const { orbital } = inputs
  return [
    `mode=${inputs.mode}`,
    `representation=${inputs.representation}`,
    `n=${orbital.n}`,
    `l=${orbital.l}`,
    `m=${orbital.m}`,
    `z=${orbital.z}`,
    `basis=${orbital.basis}`,
    `aMu=${inputs.aMu}`,
    `samples=${inputs.samples}`,
    `seed=${inputs.seed}`,
    `resolution=${inputs.resolution}`,
    `mass=${inputs.probabilityMass}`,
    `seedCount=${inputs.seedCount}`,
    `plane=${inputs.plane ?? 'none'}`,
    `sliceObservable=${inputs.sliceObservable ?? 'none'}`,
    `terms=${inputs.superpositionTerms}`,
  ].join('|')
}

/** Target atomic-unit spacing; a physical period is divided into whole frames. */
const TARGET_TIME_STEP_AU = 0.6
/** Backward-compatible fallback for callers that do not own a catalogue period. */
const DEFAULT_PLAYBACK_PERIOD_AU = 39.6

/**
 * The next playback time, as a frame index rather than an accumulated sum.
 *
 * Adding 0.6 to a float and taking it modulo 40 does two damaging things: 40 is
 * not a whole number of steps, so the loop walks 200 distinct times before it
 * repeats, and the sum drifts off the grid (1.2 + 0.6 is 1.7999999999999998).
 * Every distinct time is a cache-missing request for a frame nobody will see
 * again. Counting frames instead means a lap revisits bit-identical values, so
 * playback asks for the same 66 frames forever.
 */
export function nextTimeAu(time: number, periodAu = DEFAULT_PLAYBACK_PERIOD_AU): number {
  if (!Number.isFinite(time) || !Number.isFinite(periodAu) || periodAu <= 0) return 0
  const frames = Math.max(1, Math.ceil(periodAu / TARGET_TIME_STEP_AU))
  const normalized = ((time % periodAu) + periodAu) % periodAu
  const frame = Math.round((normalized * frames) / periodAu) % frames
  const next = (frame + 1) % frames

  // The ideal phase samples are evenly spaced across the exact physical
  // period. Snap each one to the same 0.2-a.u. lattice the time slider shows;
  // otherwise a catalogue period such as 16.755... produces long binary
  // decimals, range-step mismatches and cache keys the UI cannot reproduce.
  // Rounding each absolute frame independently distributes the small timing
  // error instead of accumulating it, and the integer frame still guarantees
  // a bit-identical wrap to zero.
  const idealTime = (next * periodAu) / frames
  const ticks = Math.round(idealTime / TIME_GRID_STEP_AU)
  return Number((ticks * TIME_GRID_STEP_AU).toFixed(12))
}

/**
 * Latest-wins request scheduling for the canvas.
 *
 * It answers two questions the fetch effect used to answer wrongly. "Has the
 * scene become untrue?" -- only when its identity changed, so a time step no
 * longer blanks the viewport. And "what do we do with a time step that lands
 * mid-request?" -- remember it and run it when the answer comes back, rather
 * than aborting the request that is already most of the way there. Aborting was
 * what made playback render nothing at all once a round trip outlasted the
 * tick interval: every tick killed the request the previous tick had started.
 *
 * Only the newest queued time is kept. Playback is a clock, not a queue of
 * work: an intermediate frame that is already stale by the time the network
 * frees up is not worth showing.
 */
export function createFetchCoordinator(): FetchCoordinator {
  let identityKey: string | null = null
  let inFlight = false
  let queuedTimeAu: number | null = null

  const release = (forTime: number): ResponseDecision => {
    inFlight = false
    const queued = queuedTimeAu
    queuedTimeAu = null
    if (queued === null || queued === forTime) {
      return { refetchTime: null }
    }
    inFlight = true
    return { refetchTime: queued }
  }

  return {
    onInputsChanged({ identityKey: key, timeAu }) {
      if (key !== identityKey) {
        identityKey = key
        queuedTimeAu = null
        inFlight = true
        return { startFetch: true, clearScene: true, abortPrevious: true }
      }
      if (inFlight) {
        queuedTimeAu = timeAu
        return { startFetch: false, clearScene: false, abortPrevious: false }
      }
      inFlight = true
      return { startFetch: true, clearScene: false, abortPrevious: false }
    },
    onResponse: release,
    // An error has to free the slot too, or one failed request stops playback
    // for good: every later tick would queue behind a request that will never
    // answer.
    onError: release,
    reset() {
      identityKey = null
      inFlight = false
      queuedTimeAu = null
    },
  }
}
