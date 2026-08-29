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
   * This route accepts the request, but only the server's numerical builder
   * can decide whether the requested finite grid is honest for this state.
   *
   * Presence is deliberately different from a refusal: callers may issue the
   * request, and a fail-closed 422 remains a valid, user-visible outcome.
   */
  serverValidation?: {
    reason: string
  }
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
  /** Builder-derived floor supplied by the selected superposition catalogue entry. */
  superpositionSliceResolutionFloor?: number
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

export interface RouteParameterConstraint {
  /** Query-string spelling in the OpenAPI document. */
  wireName: string
  /** Range presented by the UI; `step` is client-side, never a server bound. */
  uiBound: ParameterBound
  /** Present only when the server uses an open lower bound such as `gt=0`. */
  serverExclusiveMinimum?: number
}

interface RouteStateConstraint {
  nMax: number
  lMax: number
  absoluteMMax: number
}

interface RouteConstraint {
  endpoint: string
  parameters: Partial<Record<ParameterId, RouteParameterConstraint>>
  /** Sent on every request for this route, but not rendered as a generic slider. */
  fixedParameters: Record<string, RouteParameterConstraint>
  state?: RouteStateConstraint
}

/** Client lattice for the continuous server-side `time` parameter. */
export const TIME_GRID_STEP_AU = 0.2

const A_MU_CONSTRAINT: RouteParameterConstraint = {
  wireName: 'a_mu',
  uiBound: { min: 0.005, max: 20, step: 0.005 },
  serverExclusiveMinimum: 0,
}
export const Z_CONSTRAINT: RouteParameterConstraint = {
  wireName: 'z',
  uiBound: { min: 0.1, max: 20, step: 0.1 },
  serverExclusiveMinimum: 0,
}
const TIME_CONSTRAINT: RouteParameterConstraint = {
  wireName: 'time',
  uiBound: { min: -1000, max: 1000, step: TIME_GRID_STEP_AU },
}
const ISOSURFACE_RESOLUTION_CONSTRAINT: RouteParameterConstraint = {
  wireName: 'resolution',
  uiBound: { min: 49, max: 81, step: 2 },
}
const SLICE_RESOLUTION_CONSTRAINT: RouteParameterConstraint = {
  wireName: 'resolution',
  uiBound: { min: MINIMUM_SLICE_RESOLUTION, max: MAXIMUM_SLICE_RESOLUTION, step: 2 },
}
const PROBABILITY_MASS_CONSTRAINT: RouteParameterConstraint = {
  wireName: 'probability_mass',
  uiBound: { min: 0.5, max: 0.99, step: 0.01 },
}

/**
 * The numeric route contract in one machine-checkable table.
 *
 * `capabilityFor` derives every public bound below from this table, and the
 * OpenAPI drift test compares every entry with the committed schema. Store
 * clamping then reads `capabilityFor`, leaving a single route-range authority
 * from schema gate to slider to query planner.
 */
export const CAPABILITY_ROUTE_CONSTRAINTS = {
  pointCloud: {
    endpoint: '/api/orbitals/point-cloud',
    state: { nMax: 12, lMax: 11, absoluteMMax: 11 },
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: {
      samples: { wireName: 'samples', uiBound: { min: 1000, max: 120000, step: 1000 } },
      seed: { wireName: 'seed', uiBound: { min: 0, max: 2147483647, step: 1 } },
    },
  },
  eigenstateIsosurface: {
    endpoint: '/api/orbitals/isosurface',
    state: { nMax: 4, lMax: 3, absoluteMMax: 3 },
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: {
      resolution: ISOSURFACE_RESOLUTION_CONSTRAINT,
      probabilityMass: PROBABILITY_MASS_CONSTRAINT,
    },
  },
  eigenstateCurrent: {
    endpoint: '/api/orbitals/current-field',
    state: { nMax: 6, lMax: 5, absoluteMMax: 5 },
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: {
      seedCount: { wireName: 'seed_count', uiBound: { min: 1, max: 96, step: 1 } },
    },
  },
  eigenstateSlice: {
    endpoint: '/api/orbitals/slice',
    state: { nMax: 12, lMax: 11, absoluteMMax: 11 },
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: { resolution: SLICE_RESOLUTION_CONSTRAINT, aMu: A_MU_CONSTRAINT },
  },
  superpositionIsosurface: {
    endpoint: '/api/superposition/isosurface',
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: {
      resolution: ISOSURFACE_RESOLUTION_CONSTRAINT,
      probabilityMass: PROBABILITY_MASS_CONSTRAINT,
      timeAu: TIME_CONSTRAINT,
      aMu: A_MU_CONSTRAINT,
    },
  },
  superpositionCurrent: {
    endpoint: '/api/superposition/current-field',
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: {
      seedCount: { wireName: 'seed_count', uiBound: { min: 1, max: 40, step: 1 } },
      timeAu: TIME_CONSTRAINT,
      aMu: A_MU_CONSTRAINT,
    },
  },
  superpositionSlice: {
    endpoint: '/api/superposition/slice',
    fixedParameters: { z: Z_CONSTRAINT },
    parameters: {
      resolution: SLICE_RESOLUTION_CONSTRAINT,
      timeAu: TIME_CONSTRAINT,
      aMu: A_MU_CONSTRAINT,
    },
  },
} as const satisfies Record<string, RouteConstraint>

const POINT_CLOUD_ENDPOINT = CAPABILITY_ROUTE_CONSTRAINTS.pointCloud.endpoint
const ISOSURFACE_ENDPOINT = CAPABILITY_ROUTE_CONSTRAINTS.eigenstateIsosurface.endpoint
const CURRENT_FIELD_ENDPOINT = CAPABILITY_ROUTE_CONSTRAINTS.eigenstateCurrent.endpoint
const SUPERPOSITION_ISOSURFACE_ENDPOINT =
  CAPABILITY_ROUTE_CONSTRAINTS.superpositionIsosurface.endpoint
const SUPERPOSITION_CURRENT_FIELD_ENDPOINT =
  CAPABILITY_ROUTE_CONSTRAINTS.superpositionCurrent.endpoint
const SLICE_ENDPOINT = CAPABILITY_ROUTE_CONSTRAINTS.eigenstateSlice.endpoint
const SUPERPOSITION_SLICE_ENDPOINT = CAPABILITY_ROUTE_CONSTRAINTS.superpositionSlice.endpoint

const PROBABILITY_MASS_BOUND = PROBABILITY_MASS_CONSTRAINT.uiBound
/**
 * The server accepts every finite `time` inside -1000..1000. `step=0.2` is a
 * client lattice shared by the slider and playback, not a FastAPI constraint.
 */
const TIME_BOUND = TIME_CONSTRAINT.uiBound
const RESOLUTION_MIN = ISOSURFACE_RESOLUTION_CONSTRAINT.uiBound.min

const ISOSURFACE_SERVER_VALIDATION = {
  reason:
    '等值面的有限网格可生成性与已实现的数值诊断需由服务端按当前态、概率质量和网格验证；公开参数范围不是物理正确性证书，失败时会 fail-closed 并返回原因。',
} as const

const SLICE_SERVER_VALIDATION = {
  reason:
    '切片分辨率需由服务端结合当前各项的径向节点、紧致尺度和 extent 做数值验证；即使参数位于公开范围内，也可能 fail-closed 并返回原因。',
} as const

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
const A_MU_BOUND = A_MU_CONSTRAINT.uiBound

/**
 * The finest grid an eigenstate of this n needs before its outer lobes stop
 * being cut by the sampling. A UI-side floor on top of the route's ge=49, and
 * an EIGENSTATE rule only: a superposition has no single n, so carrying it
 * over would refuse grids the superposition route accepts.
 */
function minimumSurfaceResolution(n: number): number {
  return Math.max(RESOLUTION_MIN, 16 * n + 17)
}

export const EIGENSTATE_S_SLICE_FLOORS = {
  4: 97,
  5: 141,
  6: 193,
  7: 251,
  8: 319,
} as const

/**
 * State-specific slice floor for every eigenstate the panel can reach.
 *
 * Python derives the physical floor from its padded 0.9999 radial-mass extent,
 * exact associated-Laguerre nodes and the requirement of at least 1.5 grid
 * intervals across the smallest radial feature. Reimplementing either solver
 * in the browser would create a second numerical authority, so this table pins
 * only the five resulting exceptions to the shell-count rule. A Python gate
 * derives the values afresh from the production builder and compares them with
 * this exported table; the TypeScript tests then carry each value through the
 * capability, request planner and real store. Both relevant lengths scale as
 * a_mu/Z, so the floors are independent of charge and reduced mass. For l>0
 * and n<=8 the shell-count floor dominates; only 4s..8s need an exception.
 */
function minimumSliceResolution(orbital: OrbitalParameters): number {
  const shellFloor = Math.max(MINIMUM_SLICE_RESOLUTION, 16 * orbital.n + 17)
  if (orbital.l !== 0) return shellFloor

  const physicalFloor =
    EIGENSTATE_S_SLICE_FLOORS[orbital.n as keyof typeof EIGENSTATE_S_SLICE_FLOORS]
  return physicalFloor === undefined ? shellFloor : Math.max(shellFloor, physicalFloor)
}

/**
 * The grid bound a slice row declares, given its floor.
 *
 * `step: 2` keeps a slider on the odd lattice the builder requires (the origin
 * has to be a sample), and every shell/state-specific floor above is odd.
 */
const sliceResolutionBound = (min: number): ParameterBound => ({
  min,
  max: SLICE_RESOLUTION_CONSTRAINT.uiBound.max,
  step: SLICE_RESOLUTION_CONSTRAINT.uiBound.step,
})

function catalogSliceResolutionFloor(value: number | undefined): number {
  if (
    value === undefined ||
    !Number.isInteger(value) ||
    value < MINIMUM_SLICE_RESOLUTION ||
    value > MAXIMUM_SLICE_RESOLUTION ||
    value % 2 === 0
  ) {
    return MINIMUM_SLICE_RESOLUTION
  }
  return value
}

function eigenstateIsosurface(orbital: OrbitalParameters): Capability {
  const stateLimit = CAPABILITY_ROUTE_CONSTRAINTS.eigenstateIsosurface.state
  // routes.py `isosurface`: n le=4, l le=3, m ge=-3 le=3.
  if (orbital.n > stateLimit.nMax) {
    return {
      status: 'unsupported',
      reason:
        `${ISOSURFACE_ENDPOINT} 仅接受 n ≤ ${stateLimit.nMax}；更高 n 的 level set 尚未验证。` +
        `当前态 n = ${orbital.n}。`,
    }
  }
  if (orbital.l > stateLimit.lMax) {
    return {
      status: 'unsupported',
      reason: `${ISOSURFACE_ENDPOINT} 仅接受 l ≤ ${stateLimit.lMax}；当前态 l = ${orbital.l}。`,
    }
  }
  if (Math.abs(orbital.m) > stateLimit.absoluteMMax) {
    return {
      status: 'unsupported',
      reason:
        `${ISOSURFACE_ENDPOINT} 仅接受 |m| ≤ ${stateLimit.absoluteMMax}；` +
      `当前态 m = ${orbital.m}。`,
    }
  }
  if (orbital.l === 0 && orbital.n >= 3) {
    return {
      status: 'unsupported',
      reason:
        `${orbital.n}s 的径向节点拓扑需要超过当前内部自适应网格上限；` +
        `${ISOSURFACE_ENDPOINT} 对该态的全部公开 resolution 都会 fail-closed。` +
        '请改用切片查看径向节点。',
    }
  }
  return {
    status: 'available',
    endpoint: ISOSURFACE_ENDPOINT,
    parameters: {
      resolution: {
        min: minimumSurfaceResolution(orbital.n),
        max: ISOSURFACE_RESOLUTION_CONSTRAINT.uiBound.max,
        step: ISOSURFACE_RESOLUTION_CONSTRAINT.uiBound.step,
      },
      probabilityMass: PROBABILITY_MASS_BOUND,
    },
    latency: 'slow',
    serverValidation: ISOSURFACE_SERVER_VALIDATION,
  }
}

function eigenstateStreamlines(orbital: OrbitalParameters): Capability {
  const stateLimit = CAPABILITY_ROUTE_CONSTRAINTS.eigenstateCurrent.state
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
  if (orbital.n > stateLimit.nMax) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} 仅接受 n ≤ ${stateLimit.nMax}；当前态 n = ${orbital.n}。`,
    }
  }
  if (orbital.l > stateLimit.lMax) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} 仅接受 l ≤ ${stateLimit.lMax}；当前态 l = ${orbital.l}。`,
    }
  }
  if (Math.abs(orbital.m) > stateLimit.absoluteMMax) {
    return {
      status: 'unsupported',
      reason:
        `${CURRENT_FIELD_ENDPOINT} 仅接受 |m| ≤ ${stateLimit.absoluteMMax}；` +
        `当前态 m = ${orbital.m}。`,
    }
  }
  return {
    status: 'available',
    endpoint: CURRENT_FIELD_ENDPOINT,
    // routes.py: `seed_count: int = Query(48, ge=1, le=96)`.
    parameters: {
      seedCount: CAPABILITY_ROUTE_CONSTRAINTS.eigenstateCurrent.parameters.seedCount.uiBound,
    },
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
      resolution: sliceResolutionBound(minimumSliceResolution(orbital)),
      aMu: A_MU_BOUND,
    },
    planes: PRINCIPAL_PLANES,
    observables: SLICE_OBSERVABLES,
    // At the declared ceiling a slice evaluates 513^2 = 263_169 points, the
    // same order as the 65^3 isosurface grid, and the cost class is a property
    // of the cell rather than of the value the slider happens to hold.
    latency: 'slow',
    serverValidation: SLICE_SERVER_VALIDATION,
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
          samples: CAPABILITY_ROUTE_CONSTRAINTS.pointCloud.parameters.samples.uiBound,
          seed: CAPABILITY_ROUTE_CONSTRAINTS.pointCloud.parameters.seed.uiBound,
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

function superpositionCapability(
  representation: RepresentationKind,
  sliceResolutionFloor?: number,
): Capability {
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
          resolution: CAPABILITY_ROUTE_CONSTRAINTS.superpositionIsosurface.parameters.resolution
            .uiBound,
          probabilityMass: PROBABILITY_MASS_BOUND,
          timeAu: TIME_BOUND,
          aMu: A_MU_BOUND,
        },
        latency: 'slow',
        serverValidation: ISOSURFACE_SERVER_VALIDATION,
      }
    case 'slice':
      return {
        status: 'available',
        endpoint: SUPERPOSITION_SLICE_ENDPOINT,
        parameters: {
          // The server catalogue derives this floor through the exact builder
          // calculation (extent CDF + every term's compact radial feature).
          // The browser consumes the published value and never reimplements
          // those numerics. A non-catalogue caller still falls back to the
          // route's outer floor and remains covered by serverValidation.
          resolution: sliceResolutionBound(
            catalogSliceResolutionFloor(sliceResolutionFloor),
          ),
          timeAu: TIME_BOUND,
          aMu: A_MU_BOUND,
        },
        planes: PRINCIPAL_PLANES,
        observables: SLICE_OBSERVABLES,
        latency: 'slow',
        serverValidation: SLICE_SERVER_VALIDATION,
      }
    case 'streamlines': {
      return {
        status: 'available',
        endpoint: SUPERPOSITION_CURRENT_FIELD_ENDPOINT,
        parameters: {
          seedCount:
            CAPABILITY_ROUTE_CONSTRAINTS.superpositionCurrent.parameters.seedCount.uiBound,
          timeAu: TIME_BOUND,
          aMu: A_MU_BOUND,
        },
        latency: 'slow',
      }
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
export function capabilityFor({
  mode,
  orbital,
  representation,
  superpositionSliceResolutionFloor,
}: CapabilityInputs): Capability {
  return mode === 'superposition'
    ? superpositionCapability(representation, superpositionSliceResolutionFloor)
    : eigenstateCapability(orbital, representation)
}

/** Query-parameter name for each tunable, as the routes spell it. */
const WIRE_NAME: Record<ParameterId, string> = {
  samples: CAPABILITY_ROUTE_CONSTRAINTS.pointCloud.parameters.samples.wireName,
  seed: CAPABILITY_ROUTE_CONSTRAINTS.pointCloud.parameters.seed.wireName,
  resolution:
    CAPABILITY_ROUTE_CONSTRAINTS.eigenstateIsosurface.parameters.resolution.wireName,
  probabilityMass:
    CAPABILITY_ROUTE_CONSTRAINTS.eigenstateIsosurface.parameters.probabilityMass.wireName,
  seedCount: CAPABILITY_ROUTE_CONSTRAINTS.eigenstateCurrent.parameters.seedCount.wireName,
  timeAu: CAPABILITY_ROUTE_CONSTRAINTS.superpositionIsosurface.parameters.timeAu.wireName,
  aMu: CAPABILITY_ROUTE_CONSTRAINTS.eigenstateSlice.parameters.aMu.wireName,
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
        }
      : {
          n: orbital.n,
          l: orbital.l,
          m: orbital.m,
          basis: orbital.basis,
        }
  // Charge is present on every scene route but is not a generic slider. Its
  // UI range still comes from the route table and is checked against OpenAPI,
  // so the number input and planner cannot drift into different contracts.
  params[Z_CONSTRAINT.wireName] = clampParameter(Z_CONSTRAINT.uiBound, orbital.z)
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
