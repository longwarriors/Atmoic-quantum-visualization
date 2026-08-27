import type { BasisKind, OrbitalParameters, RepresentationKind } from './types'

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

/** routes.py: `probability_mass: float = Query(0.90, ge=0.50, le=0.99)`, both routes. */
const PROBABILITY_MASS_BOUND: ParameterBound = { min: 0.5, max: 0.99, step: 0.01 }
/** routes.py: `time: float = Query(0.0, ge=-1_000.0, le=1_000.0)`, both superposition routes. */
const TIME_BOUND: ParameterBound = { min: -1000, max: 1000, step: 0.6 }
/** routes.py: `resolution: int = Query(65, ge=49, le=81)`, both isosurface routes. */
const RESOLUTION_MAX = 81
const RESOLUTION_MIN = 49

/**
 * The finest grid an eigenstate of this n needs before its outer lobes stop
 * being cut by the sampling. A UI-side floor on top of the route's ge=49, and
 * an EIGENSTATE rule only: a superposition has no single n, so carrying it
 * over would refuse grids the superposition route accepts.
 */
function minimumSurfaceResolution(n: number): number {
  return Math.max(RESOLUTION_MIN, 16 * n + 17)
}

function eigenstateIsosurface(orbital: OrbitalParameters): Capability {
  // routes.py `isosurface`: n le=4, l le=3, m ge=-3 le=3.
  if (orbital.n > 4) {
    return {
      status: 'unsupported',
      reason:
        `${ISOSURFACE_ENDPOINT} accepts n <= 4 -- above that the level set is not ` +
        `validated -- and this state has n = ${orbital.n}.`,
    }
  }
  if (orbital.l > 3) {
    return {
      status: 'unsupported',
      reason: `${ISOSURFACE_ENDPOINT} accepts l <= 3, and this state has l = ${orbital.l}.`,
    }
  }
  if (Math.abs(orbital.m) > 3) {
    return {
      status: 'unsupported',
      reason: `${ISOSURFACE_ENDPOINT} accepts |m| <= 3, and this state has m = ${orbital.m}.`,
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
        'A real stationary orbital carries identically zero probability current, so its ' +
        'streamlines would be an empty picture rather than a physical statement. Switch the ' +
        'basis to complex.',
    }
  }
  if (orbital.m === 0) {
    return {
      status: 'unsupported',
      reason:
        'An m = 0 stationary orbital has no azimuthal phase gradient, so its probability ' +
        'current vanishes identically. Choose m != 0.',
    }
  }
  // Then the route's own range: n le=6, l le=5, m ge=-5 le=5. The old UI
  // predicate stopped at the two physics tests above and asked the server for
  // states it rejects.
  if (orbital.n > 6) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} accepts n <= 6, and this state has n = ${orbital.n}.`,
    }
  }
  if (orbital.l > 5) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} accepts l <= 5, and this state has l = ${orbital.l}.`,
    }
  }
  if (Math.abs(orbital.m) > 5) {
    return {
      status: 'unsupported',
      reason: `${CURRENT_FIELD_ENDPOINT} accepts |m| <= 5, and this state has m = ${orbital.m}.`,
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

function eigenstateCapability(
  orbital: OrbitalParameters,
  representation: RepresentationKind,
): Capability {
  if (representation === 'point_cloud') {
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
  }
  if (representation === 'isosurface') {
    return eigenstateIsosurface(orbital)
  }
  return eigenstateStreamlines(orbital)
}

function superpositionCapability(representation: RepresentationKind): Capability {
  if (representation === 'point_cloud') {
    return {
      status: 'not_implemented',
      reason:
        `No route samples a time-dependent state as a point cloud: ${POINT_CLOUD_ENDPOINT} ` +
        'takes one stationary (n, l, m) and cannot express |Psi(t)|^2. Nothing about the ' +
        'physics forbids it -- it has not been built.',
    }
  }
  if (representation === 'isosurface') {
    return {
      status: 'available',
      endpoint: SUPERPOSITION_ISOSURFACE_ENDPOINT,
      parameters: {
        // The route's own range, unconditional: no single n, so no 16n + 17.
        resolution: { min: RESOLUTION_MIN, max: RESOLUTION_MAX, step: 2 },
        probabilityMass: PROBABILITY_MASS_BOUND,
        timeAu: TIME_BOUND,
      },
      latency: 'slow',
    }
  }
  return {
    status: 'available',
    endpoint: SUPERPOSITION_CURRENT_FIELD_ENDPOINT,
    // routes.py: `seed_count: int = Query(24, ge=1, le=128)` -- half the
    // eigenstate route's ceiling, because every seed is re-integrated at every
    // instant of the clock.
    parameters: {
      seedCount: { min: 1, max: 128, step: 1 },
      timeAu: TIME_BOUND,
    },
    latency: 'slow',
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
}

function parameterValue(inputs: SceneRequestInputs, id: ParameterId): number {
  return {
    samples: inputs.samples,
    seed: inputs.seed,
    resolution: inputs.resolution,
    probabilityMass: inputs.probabilityMass,
    seedCount: inputs.seedCount,
    timeAu: inputs.timeAu,
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
 * Superposition requests spell out `basis`, `z` and `a_mu` even when they equal
 * the route's defaults. Omitting them is what let the server quietly render a
 * different state from the one the panel was describing.
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
          a_mu: inputs.aMu,
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
  return {
    status: 'available',
    endpoint: capability.endpoint,
    params,
    latency: capability.latency,
  }
}
