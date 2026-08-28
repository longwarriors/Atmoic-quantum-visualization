import {
  MAXIMUM_SLICE_RESOLUTION,
  MINIMUM_SLICE_RESOLUTION,
  PRINCIPAL_PLANES,
  SLICE_OBSERVABLES,
} from './sliceContract'
import type {
  BasisKind,
  OrbitalParameters,
  PrincipalPlane,
  RepresentationKind,
  SliceObservable,
} from './types'

/**
 * What this application can actually draw, cell by cell.
 *
 * The UI used to decide "can I render this?" in three unrelated places -- a
 * store predicate, a disabled attribute, a fetch branch -- and each of them
 * knew a different, smaller part of what src/quviz/api/routes.py accepts. The
 * store's streamline predicate, for instance, tested only `basis === 'complex'
 * && m !== 0` and cheerfully asked the server for n = 8, which the route
 * rejects at n > 6: the user got a red error where the honest answer was "this
 * state is outside the route's range".
 *
 * So the matrix lives here, once, transcribed from the route signatures, and
 * every consumer reads the same answer. Two refusals, deliberately distinct:
 *
 *   `unsupported`      the physics or the server says no. Asking harder will
 *                      not help; the cell is closed and we can say why.
 *   `not_implemented`  nothing says no. We simply never built it, and saying
 *                      "unsupported" there would be a false statement about
 *                      the physics.
 *
 * Bounds below are transcribed from routes.py -- the numbers are the route's,
 * not the control panel's, because the route is what answers the request.
 * `step` is the only UI-side value here: an increment for a slider, never a
 * constraint the server imposes.
 */
export type SceneKind = 'eigenstate' | 'superposition'

/** The tunable numbers a scene request carries, named as the UI names them. */
export type ParameterId =
  | 'samples'
  | 'seed'
  | 'resolution'
  | 'probabilityMass'
  | 'seedCount'
  | 'timeAu'
  | 'aMu'

/**
 * How long a request for this cell takes, as a cost class rather than a
 * measured budget: `fast` is one sampling pass returned as a binary blob;
 * `slow` evaluates a 49^3..81^3 grid or integrates streamlines, and for a
 * superposition it does that again for every instant of the clock.
 */
export type Latency = 'fast' | 'slow'

export interface ParameterBound {
  min: number
  max: number
  /** Slider increment. A UI convenience; the routes accept any value in range. */
  step?: number
}

export interface AvailableCapability {
  status: 'available'
  endpoint: string
  parameters: Partial<Record<ParameterId, ParameterBound>>
  latency: Latency
  /**
   * The principal planes this cell can be cut on, present only on the rows
   * whose route reads a `plane`. A row that declares none sends none: the
   * enumerated choices are part of what the cell can do, exactly as the
   * numeric bounds are, and a caller cannot spell a plane onto a request that
   * has no plane to speak of.
   */
  planes?: readonly PrincipalPlane[]
  /** The scalar fields this cell can return, on the same terms as `planes`. */
  observables?: readonly SliceObservable[]
}

/** The physics or the server forbids this cell, and the reason says which. */
export interface UnsupportedCapability {
  status: 'unsupported'
  reason: string
}

/** Nothing forbids this cell; it does not exist yet. */
export interface NotImplementedCapability {
  status: 'not_implemented'
  reason: string
}

export type Refusal = UnsupportedCapability | NotImplementedCapability
export type Capability = AvailableCapability | Refusal

export interface CapabilityInputs {
  mode: SceneKind
  orbital: OrbitalParameters
  representation: RepresentationKind
}

export interface SceneRequestInputs extends CapabilityInputs {
  samples: number
  seed: number
  resolution: number
  probabilityMass: number
  seedCount: number
  superpositionTerms: string
  /**
   * The superposition's own basis. Independent of `orbital.basis` on purpose:
   * they describe two different states, and coupling them silently changed the
   * rendered physics of one when the user adjusted the other.
   */
  superpositionBasis: BasisKind
  /** Reduced-mass ratio a_mu. Shipped explicitly so the server cannot default it. */
  aMu: number
  timeAu: number
  /**
   * The plane a slice is cut on, and the field it carries.
   *
   * Optional because only the two slice rows read them, and every other
   * consumer of this type builds its inputs without them. `planSceneRequest`
   * falls back to the routes' own defaults, and refuses any value the chosen
   * row does not declare.
   */
  plane?: PrincipalPlane
  sliceObservable?: SliceObservable
}

/**
 * A request that can actually be issued: an endpoint and the exact query
 * parameters for it, every one of them inside the bound the matrix declares.
 */
export interface ScenePlan {
  status: 'available'
  endpoint: string
  params: Record<string, string | number>
  latency: Latency
}

/**
 * The plan or the refusal -- and a refusal carries no endpoint and no params,
 * so a closed cell cannot produce a request even by accident. That is the
 * point of the union: the caller has to narrow on `status` before it can reach
 * a URL, which is what stops "unsupported" from turning into a 422.
 */
export type ScenePlanResult = ScenePlan | Refusal

const POINT_CLOUD_ENDPOINT = '/api/orbitals/point-cloud'
const ISOSURFACE_ENDPOINT = '/api/orbitals/isosurface'
const CURRENT_FIELD_ENDPOINT = '/api/orbitals/current-field'
const SUPERPOSITION_ISOSURFACE_ENDPOINT = '/api/superposition/isosurface'
const SUPERPOSITION_CURRENT_FIELD_ENDPOINT = '/api/superposition/current-field'
const SLICE_ENDPOINT = '/api/orbitals/slice'
const SUPERPOSITION_SLICE_ENDPOINT = '/api/superposition/slice'

/** routes.py: `probability_mass: float = Query(0.90, ge=0.50, le=0.99)`, both routes. */
const PROBABILITY_MASS_BOUND: ParameterBound = { min: 0.5, max: 0.99, step: 0.01 }
/**
 * routes.py: `time: float = Query(0.0, ge=-1_000.0, le=1_000.0)`, both
 * superposition routes. The step shares the `min`-based range grid with the
 * initial t = 0, the t = 8.4 visual anchor and every 0.6 a.u. playback frame.
 */
const TIME_BOUND: ParameterBound = { min: -1000, max: 1000, step: 0.2 }
/** routes.py: `resolution: int = Query(65, ge=49, le=81)`, both isosurface routes. */
const RESOLUTION_MAX = 81
const RESOLUTION_MIN = 49

/**
 * routes.py: `a_mu: float = Query(1.0, gt=0.0, le=20.0)` on all four routes
 * that read it.
 *
 * `min` is the one number here the server does not state, and it is a UI
 * choice rather than a transcription: the route's lower bound is OPEN (`gt`),
 * and an open bound is not a slider minimum -- zero is the one value in
 * `[0, 20]` the route refuses, and a_mu = 0 is a nucleus of infinite mass
 * expressed as a zero-length Bohr radius, which is not a state to render. 0.005
 * is the smallest step this bound admits and sits just below the muonic
 * hydrogen ratio (m_e/mu ~= 0.0054), so the physically interesting light-lepton
 * end of the range stays reachable. `max` and the openness at zero are the
 * route's; the floor is ours, and it never widens what the route accepts.
 */
const A_MU_BOUND: ParameterBound = { min: 0.005, max: 20, step: 0.005 }

/**
 * The finest grid an eigenstate of this n needs before its outer lobes stop
 * being cut by the sampling. A UI-side floor on top of the route's ge=49, and
 * an EIGENSTATE rule only: a superposition has no single n, so carrying it
 * over would refuse grids the superposition route accepts.
 */
function minimumSurfaceResolution(n: number): number {
  return Math.max(RESOLUTION_MIN, 16 * n + 17)
}

/**
 * The same 16n + 17 rule over the slice's own floor.
 *
 * `quviz.scene.slices.slice_resolution_floor` is `max(65, 16 * n + 17)`, and
 * unlike the isosurface's floor this one is the SERVER's: `build_slice` raises
 * below it and the refusal arrives as a 422. Expressed here the way the
 * isosurface row expresses its floor, over MINIMUM_SLICE_RESOLUTION instead of
 * RESOLUTION_MIN, because the two grids are different objects: a slice samples
 * `resolution**2` points and reports them, so samples are all it has to buy.
 */
function minimumSliceResolution(n: number): number {
  return Math.max(MINIMUM_SLICE_RESOLUTION, 16 * n + 17)
}

/**
 * The grid bound a slice row declares, given its floor.
 *
 * `step: 2` keeps a slider on the odd lattice the builder requires (the origin
 * has to be a sample), which every floor here starts on: 65 is odd and so is
 * 16n + 17.
 */
const sliceResolutionBound = (min: number): ParameterBound => ({
  min,
  max: MAXIMUM_SLICE_RESOLUTION,
  step: 2,
})

function eigenstateIsosurface(orbital: OrbitalParameters): Capability {
  // routes.py `isosurface`: n le=4, l le=3, m ge=-3 le=3.
  if (orbital.n > 4) {
    return {
      status: 'unsupported',
      reason:
        `${ISOSURFACE_ENDPOINT} 仅接受 n ≤ 4；更高 n 的 level set 尚未验证。` +
        `当前态 n = ${orbital.n}。`,
    }
  }
  if (orbital.l > 3) {
    return {
      status: 'unsupported',
      reason: `${ISOSURFACE_ENDPOINT} 仅接受 l ≤ 3；当前态 l = ${orbital.l}。`,
    }
  }
  if (Math.abs(orbital.m) > 3) {
    return {
      status: 'unsupported',
      reason: `${ISOSURFACE_ENDPOINT} 仅接受 |m| ≤ 3；当前态 m = ${orbital.m}。`,
    }
  }
  return {
    status: 'available',
    endpoint: ISOSURFACE_ENDPOINT,
    parameters: {
      resolution: {
        min: minimumSurfaceResolution(orbital.n),
        max: RESOLUTION_MAX,
        step: 2,
      },
      probabilityMass: PROBABILITY_MASS_BOUND,
    },
    latency: 'slow',
  }
}

function eigenstateStreamlines(orbital: OrbitalParameters): Capability {
  // Physics first: these two are true of the state, whatever the server would
  // do with the request.
  if (orbital.basis !== 'complex') {
    return {
      status: 'unsupported',
      reason:
        '实基定态 orbital 的 probability current 恒为 0，streamlines 只会得到空图。' +
        '请切换到 complex basis。',
    }
  }
  if (orbital.m === 0) {
    return {
      status: 'unsupported',
      reason:
        'm = 0 的定态 orbital 没有方位 phase gradient，因此 probability current 恒为 0。' +
        '请选择 m ≠ 0。',
    }
  }
  // Then the route's own range: n le=6, l le=5, m ge=-5 le=5. The old UI
  // predicate stopped at the two physics tests above and asked the server for
  // states it rejects.
  if (orbital.n > 6) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} 仅接受 n ≤ 6；当前态 n = ${orbital.n}。`,
    }
  }
  if (orbital.l > 5) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} 仅接受 l ≤ 5；当前态 l = ${orbital.l}。`,
    }
  }
  if (Math.abs(orbital.m) > 5) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} 仅接受 |m| ≤ 5；当前态 m = ${orbital.m}。`,
    }
  }
  return {
    status: 'available',
    endpoint: CURRENT_FIELD_ENDPOINT,
    // routes.py: `seed_count: int = Query(48, ge=1, le=256)`.
    parameters: { seedCount: { min: 1, max: 256, step: 1 } },
    latency: 'slow',
  }
}

/**
 * An eigenstate cut on a principal plane.
 *
 * Unconditional on the state, and that is a transcription rather than an
 * oversight: `/api/orbitals/slice` carries the same ceilings as
 * `/api/orbitals/point-cloud` (n le=12, l le=11, |m| le=11), both far above
 * anything the panel can ask for, so -- exactly like the point-cloud row --
 * there is no state in reach for this row to refuse. The narrower rows above
 * exist because the isosurface and current-field routes stop at n <= 4 and
 * n <= 6; this one does not.
 *
 * It is also the only eigenstate row that declares `aMu`: the slice is where
 * the reduced-mass length is legible, because it rescales both the derived
 * extent and the amplitude scale the phase mask is referenced to, and it is
 * the only eigenstate route that reads the parameter at all.
 */
function eigenstateSlice(orbital: OrbitalParameters): Capability {
  return {
    status: 'available',
    endpoint: SLICE_ENDPOINT,
    parameters: {
      resolution: sliceResolutionBound(minimumSliceResolution(orbital.n)),
      aMu: A_MU_BOUND,
    },
    planes: PRINCIPAL_PLANES,
    observables: SLICE_OBSERVABLES,
    // At the declared ceiling a slice evaluates 513^2 = 263_169 points, the
    // same order as the 65^3 isosurface grid, and the cost class is a property
    // of the cell rather than of the value the slider happens to hold.
    latency: 'slow',
  }
}

function eigenstateCapability(
  orbital: OrbitalParameters,
  representation: RepresentationKind,
): Capability {
  // Exhaustive by construction. This dispatch used to end in a bare
  // `return eigenstateStreamlines(orbital)`, which is not a default: it is the
  // streamline row answering for every representation nobody had written a row
  // for. A slice request came back `available` at
  // /api/orbitals/current-field -- right shape, wrong physics, wrong route --
  // and only a test asserting the endpoint could have seen it. The `never`
  // binding below turns that class of mistake into a compile error.
  switch (representation) {
    case 'point_cloud':
      return {
        status: 'available',
        endpoint: POINT_CLOUD_ENDPOINT,
        // routes.py: `samples` ge=1_000 le=120_000, `seed` ge=0 le=2_147_483_647.
        parameters: {
          samples: { min: 1000, max: 120000, step: 1000 },
          seed: { min: 0, max: 2147483647, step: 1 },
        },
        latency: 'fast',
      }
    case 'isosurface':
      return eigenstateIsosurface(orbital)
    case 'slice':
      return eigenstateSlice(orbital)
    case 'streamlines':
      return eigenstateStreamlines(orbital)
    default: {
      const _never: never = representation
      throw new Error(
        `No eigenstate row for representation ${JSON.stringify(_never)}. The matrix fails ` +
          'closed rather than answering with whichever row happens to be last.',
      )
    }
  }
}

function superpositionCapability(representation: RepresentationKind): Capability {
  switch (representation) {
    case 'point_cloud':
      return {
        status: 'not_implemented',
        reason:
          `尚无 route 将含时态采样为 point cloud：${POINT_CLOUD_ENDPOINT} ` +
          '只接收一个定态 (n, l, m)，无法表示 |Ψ(t)|²。这不是 physics 限制，而是尚未实现。',
      }
    case 'isosurface':
      return {
        status: 'available',
        endpoint: SUPERPOSITION_ISOSURFACE_ENDPOINT,
        parameters: {
          // The route's own range, unconditional: no single n, so no 16n + 17.
          resolution: { min: RESOLUTION_MIN, max: RESOLUTION_MAX, step: 2 },
          probabilityMass: PROBABILITY_MASS_BOUND,
          timeAu: TIME_BOUND,
          aMu: A_MU_BOUND,
        },
        latency: 'slow',
      }
    case 'slice':
      return {
        status: 'available',
        endpoint: SUPERPOSITION_SLICE_ENDPOINT,
        parameters: {
          // The route's own outer range. The builder's floor is 16n + 17 of the
          // LARGEST term, and this module does not parse `terms`, so applying
          // the panel's own n here would refuse grids the route accepts --
          // the same reason the superposition isosurface row carries no floor.
          // A grid too coarse for the highest shell comes back as a 422 that
          // names it.
          resolution: sliceResolutionBound(MINIMUM_SLICE_RESOLUTION),
          timeAu: TIME_BOUND,
          aMu: A_MU_BOUND,
        },
        planes: PRINCIPAL_PLANES,
        observables: SLICE_OBSERVABLES,
        latency: 'slow',
      }
    case 'streamlines':
      return {
        status: 'available',
        endpoint: SUPERPOSITION_CURRENT_FIELD_ENDPOINT,
        // routes.py: `seed_count: int = Query(24, ge=1, le=128)` -- half the
        // eigenstate route's ceiling, because every seed is re-integrated at
        // every instant of the clock.
        parameters: {
          seedCount: { min: 1, max: 128, step: 1 },
          timeAu: TIME_BOUND,
          aMu: A_MU_BOUND,
        },
        latency: 'slow',
      }
    default: {
      const _never: never = representation
      throw new Error(
        `No superposition row for representation ${JSON.stringify(_never)}. The matrix fails ` +
          'closed rather than answering with whichever row happens to be last.',
      )
    }
  }
}

/** What this state-kind x representation cell can do, and at what cost. */
export function capabilityFor({ mode, orbital, representation }: CapabilityInputs): Capability {
  return mode === 'superposition'
    ? superpositionCapability(representation)
    : eigenstateCapability(orbital, representation)
}

/** Query-parameter name for each tunable, as the routes spell it. */
const WIRE_NAME: Record<ParameterId, string> = {
  samples: 'samples',
  seed: 'seed',
  resolution: 'resolution',
  probabilityMass: 'probability_mass',
  seedCount: 'seed_count',
  timeAu: 'time',
  aMu: 'a_mu',
}

/** Query-parameter names for the enumerated choices the slice routes read. */
const PLANE_PARAM = 'plane'
const OBSERVABLE_PARAM = 'observable'

/** routes.py: `plane: PrincipalPlane = PrincipalPlane.XZ` on both slice routes. */
const DEFAULT_PLANE: PrincipalPlane = 'xz'
/** routes.py: `observable: SliceObservable = SliceObservable.PROBABILITY_DENSITY`. */
const DEFAULT_SLICE_OBSERVABLE: SliceObservable = 'probability_density'

/**
 * The requested choice if the row declares it, and the route's own default
 * otherwise.
 *
 * The enumerated counterpart of `clampParameter`: a value the capability does
 * not offer never leaves, so an out-of-range choice becomes the honest default
 * rather than a 422 the matrix promised could not happen.
 */
function declaredChoice<T>(declared: readonly T[], requested: T | undefined, fallback: T): T {
  return requested !== undefined && declared.includes(requested) ? requested : fallback
}

function parameterValue(inputs: SceneRequestInputs, id: ParameterId): number {
  return {
    samples: inputs.samples,
    seed: inputs.seed,
    resolution: inputs.resolution,
    probabilityMass: inputs.probabilityMass,
    seedCount: inputs.seedCount,
    timeAu: inputs.timeAu,
    aMu: inputs.aMu,
  }[id]
}

/**
 * A value the declared bound admits.
 *
 * An integer `step` marks a count the route parses as an int, so a slider that
 * hands us 20000.4 is rounded rather than sent to be rejected. A fractional
 * step (a mass, a clock) is a display increment only and never snaps the value.
 */
function clampParameter(bound: ParameterBound, value: number): number {
  const integral = bound.step !== undefined && Number.isInteger(bound.step)
  const candidate = integral ? Math.round(value) : value
  return Math.min(bound.max, Math.max(bound.min, candidate))
}

/**
 * The concrete request for these inputs, or the refusal that says why there
 * isn't one.
 *
 * The parameters sent are exactly the ones the capability declares -- there is
 * no second list here that could drift from the matrix -- and every one of them
 * is clamped into its declared bound before it leaves.
 *
 * Superposition requests spell out `basis` and `z` even when they equal the
 * route's defaults. Omitting them is what let the server quietly render a
 * different state from the one the panel was describing.
 *
 * `a_mu` used to be spelled into that same block by hand, which put it outside
 * the one mechanism that keeps a sent value inside a declared bound, and sent
 * it to two routes at a time when four read it. It is a declared parameter
 * now, on those four rows and nowhere else.
 */
export function planSceneRequest(inputs: SceneRequestInputs): ScenePlanResult {
  const capability = capabilityFor(inputs)
  if (capability.status !== 'available') {
    return capability
  }
  const { orbital } = inputs
  const params: Record<string, string | number> =
    inputs.mode === 'superposition'
      ? {
          terms: inputs.superpositionTerms,
          basis: inputs.superpositionBasis,
          z: orbital.z,
        }
      : {
          n: orbital.n,
          l: orbital.l,
          m: orbital.m,
          z: orbital.z,
          basis: orbital.basis,
        }
  for (const [id, bound] of Object.entries(capability.parameters) as [
    ParameterId,
    ParameterBound,
  ][]) {
    params[WIRE_NAME[id]] = clampParameter(bound, parameterValue(inputs, id))
  }
  if (capability.planes !== undefined) {
    params[PLANE_PARAM] = declaredChoice(capability.planes, inputs.plane, DEFAULT_PLANE)
  }
  if (capability.observables !== undefined) {
    params[OBSERVABLE_PARAM] = declaredChoice(
      capability.observables,
      inputs.sliceObservable,
      DEFAULT_SLICE_OBSERVABLE,
    )
  }
  return {
    status: 'available',
    endpoint: capability.endpoint,
    params,
    latency: capability.latency,
  }
}
