import { useEffect, useRef, useState } from 'react'

import { planSceneRequest, type ScenePlan, type SceneRequestInputs } from '../api/capability'
import {
  fetchCurrentField,
  fetchIsosurface,
  fetchPointCloud,
  fetchSlice,
  fetchSuperpositionCurrentField,
  fetchSuperpositionIsosurface,
  fetchSuperpositionSlice,
} from '../api/client'
import { PRINCIPAL_PLANES, SLICE_OBSERVABLES } from '../api/sliceContract'
import type {
  CurrentFieldPayload,
  IsosurfacePayload,
  PointCloudData,
  PrincipalPlane,
  SceneStatus,
  SliceObservable,
  SlicePayload,
  SuperpositionCurrentPayload,
  SuperpositionIsosurfacePayload,
  SuperpositionSlicePayload,
} from '../api/types'
import { createFetchCoordinator, sceneIdentityKey, type ResponseDecision } from './sceneRequest'
import {
  statusFromCurrentField,
  statusFromSlice,
  statusFromSuperpositionIsosurface,
} from './sceneStatus'

/**
 * The one thing on screen, and what it is.
 *
 * The canvas used to hold four independent `useState` slots and render every
 * one that happened to be non-null, so a scene change that filled the new slot
 * before clearing the old one drew two physically different objects at once.
 * A discriminated union cannot represent that state: there is either an asset
 * or there is not, and its `kind` says which route answered.
 */
export type SceneAsset =
  | { kind: 'point_cloud'; data: PointCloudData }
  | { kind: 'isosurface'; data: IsosurfacePayload }
  | { kind: 'slice'; data: SlicePayload }
  | { kind: 'streamlines'; data: CurrentFieldPayload }
  | { kind: 'superposition_isosurface'; data: SuperpositionIsosurfacePayload }
  | { kind: 'superposition_slice'; data: SuperpositionSlicePayload }
  | { kind: 'superposition_streamlines'; data: SuperpositionCurrentPayload }

/**
 * Every value the request depends on, passed in rather than read from the
 * store. The hook owning the store as well as the fetch would make it
 * untestable without a zustand instance and would hide which inputs actually
 * reach the server; this way the list is the type.
 */
export type SceneAssetInputs = SceneRequestInputs

export interface SceneAssetState {
  /** What to draw, or null while there is nothing true to draw. */
  asset: SceneAsset | null
  /**
   * The identity of the asset on screen. It changes when the scene does and
   * stays put across playback frames, so the camera fit happens once per
   * scene rather than once per arriving frame.
   */
  fitKey: string | null
}

/** Query-parameter names, as routes.py spells them. */
const SAMPLES_PARAM = 'samples'
const SEED_PARAM = 'seed'
const RESOLUTION_PARAM = 'resolution'
const PROBABILITY_MASS_PARAM = 'probability_mass'
const SEED_COUNT_PARAM = 'seed_count'
const TIME_PARAM = 'time'
const A_MU_PARAM = 'a_mu'
const PLANE_PARAM = 'plane'
const OBSERVABLE_PARAM = 'observable'

const POINT_CLOUD_ENDPOINT = '/api/orbitals/point-cloud'
const ISOSURFACE_ENDPOINT = '/api/orbitals/isosurface'
const CURRENT_FIELD_ENDPOINT = '/api/orbitals/current-field'
const SLICE_ENDPOINT = '/api/orbitals/slice'
const SUPERPOSITION_ISOSURFACE_ENDPOINT = '/api/superposition/isosurface'
const SUPERPOSITION_CURRENT_FIELD_ENDPOINT = '/api/superposition/current-field'
const SUPERPOSITION_SLICE_ENDPOINT = '/api/superposition/slice'

/**
 * A tunable the plan declares, taken from the plan rather than from the raw
 * inputs: `planSceneRequest` has already clamped it into the bound the route
 * accepts, and the unclamped input is exactly what used to produce 422s.
 *
 * A missing one is a contract break between the capability matrix and this
 * dispatcher, not something to paper over with a default -- a defaulted
 * resolution would render a different grid from the one the panel is showing.
 */
function requireNumber(plan: ScenePlan, name: string): number {
  const value = plan.params[name]
  if (typeof value !== 'number') {
    throw new Error(`The plan for ${plan.endpoint} carries no numeric ${name}.`)
  }
  return value
}

/**
 * An enumerated choice the plan declares, checked against the closed set the
 * contract names.
 *
 * The counterpart of `requireNumber` for `plane` and `observable`, and it
 * fails closed for a sharper reason than a missing number does. A missing
 * `resolution` produces a 422 the user sees; a missing `plane` produces
 * nothing at all, because the route substitutes `xz` and returns a perfectly
 * valid section of a plane nobody asked for while the panel goes on saying
 * `xy`. The membership test is what makes the returned type honest rather than
 * a cast: `PrincipalPlane` is a claim about the value, and an unchecked `as`
 * would let a typo become a query parameter.
 */
function requireChoice<T extends string>(
  plan: ScenePlan,
  name: string,
  declared: readonly T[],
): T {
  const value = plan.params[name]
  if (typeof value !== 'string') {
    throw new Error(`The plan for ${plan.endpoint} carries no ${name}.`)
  }
  if (!declared.includes(value as T)) {
    throw new Error(
      `The plan for ${plan.endpoint} names ${name}=${value}, which is not one of ` +
        `${declared.join(', ')}.`,
    )
  }
  return value as T
}

const requirePlane = (plan: ScenePlan): PrincipalPlane =>
  requireChoice(plan, PLANE_PARAM, PRINCIPAL_PLANES)

const requireObservable = (plan: ScenePlan): SliceObservable =>
  requireChoice(plan, OBSERVABLE_PARAM, SLICE_OBSERVABLES)

/**
 * Issue the request the plan describes.
 *
 * One dispatch on the endpoint the capability matrix chose, replacing the
 * four-branch `if` chain that re-derived the choice from `mode` and
 * `representation` and could disagree with the matrix about what was
 * available. Every cell the matrix can plan is covered; an endpoint without a
 * fetcher throws rather than silently rendering nothing.
 */
export async function executeSceneRequest(
  plan: ScenePlan,
  inputs: SceneAssetInputs,
  signal: AbortSignal,
): Promise<SceneAsset> {
  switch (plan.endpoint) {
    case POINT_CLOUD_ENDPOINT:
      return {
        kind: 'point_cloud',
        data: await fetchPointCloud(
          inputs.orbital,
          requireNumber(plan, SAMPLES_PARAM),
          requireNumber(plan, SEED_PARAM),
          signal,
        ),
      }
    case ISOSURFACE_ENDPOINT:
      return {
        kind: 'isosurface',
        data: await fetchIsosurface(
          inputs.orbital,
          requireNumber(plan, RESOLUTION_PARAM),
          requireNumber(plan, PROBABILITY_MASS_PARAM),
          signal,
        ),
      }
    case CURRENT_FIELD_ENDPOINT:
      return {
        kind: 'streamlines',
        data: await fetchCurrentField(inputs.orbital, requireNumber(plan, SEED_COUNT_PARAM), signal),
      }
    case SLICE_ENDPOINT:
      return {
        kind: 'slice',
        // `a_mu` comes from the plan rather than from `inputs.aMu`: the plan's
        // copy has been clamped into the bound the route accepts, and the
        // panel's raw value is exactly what produces 422s.
        data: await fetchSlice(
          inputs.orbital,
          requireNumber(plan, RESOLUTION_PARAM),
          requireNumber(plan, A_MU_PARAM),
          requirePlane(plan),
          requireObservable(plan),
          signal,
        ),
      }
    case SUPERPOSITION_ISOSURFACE_ENDPOINT:
      return {
        kind: 'superposition_isosurface',
        data: await fetchSuperpositionIsosurface(
          inputs.superpositionTerms,
          requireNumber(plan, TIME_PARAM),
          requireNumber(plan, RESOLUTION_PARAM),
          inputs.superpositionBasis,
          inputs.orbital.z,
          inputs.aMu,
          requireNumber(plan, PROBABILITY_MASS_PARAM),
          signal,
        ),
      }
    case SUPERPOSITION_SLICE_ENDPOINT:
      return {
        kind: 'superposition_slice',
        data: await fetchSuperpositionSlice(
          inputs.superpositionTerms,
          requireNumber(plan, TIME_PARAM),
          requireNumber(plan, RESOLUTION_PARAM),
          inputs.superpositionBasis,
          inputs.orbital.z,
          requireNumber(plan, A_MU_PARAM),
          requirePlane(plan),
          requireObservable(plan),
          signal,
        ),
      }
    case SUPERPOSITION_CURRENT_FIELD_ENDPOINT:
      return {
        kind: 'superposition_streamlines',
        data: await fetchSuperpositionCurrentField(
          inputs.superpositionTerms,
          requireNumber(plan, TIME_PARAM),
          requireNumber(plan, SEED_COUNT_PARAM),
          inputs.superpositionBasis,
          inputs.orbital.z,
          inputs.aMu,
          signal,
        ),
      }
    default:
      throw new Error(`No client fetcher serves ${plan.endpoint}.`)
  }
}

/** The bounding extent the renderer scales fog and grid by, whatever is drawn. */
export function sceneExtentBohr(asset: SceneAsset | null): number | undefined {
  if (asset === null) return undefined
  return asset.kind === 'point_cloud' ? asset.data.extentBohr : asset.data.extent_bohr
}

/** Every number the Inspector shows, derived from the payload that is on screen. */
function statusForAsset(asset: SceneAsset): SceneStatus {
  switch (asset.kind) {
    case 'point_cloud':
      return {
        loading: false,
        pointCount: asset.data.count,
        radialMass: asset.data.radialMass,
        extentBohr: asset.data.extentBohr,
        metadata: asset.data.metadata,
        warnings: asset.data.metadata.warnings,
      }
    case 'isosurface':
      return {
        loading: false,
        triangleCount: asset.data.faces.length,
        extentBohr: asset.data.extent_bohr,
        densityLevel: asset.data.density_level,
        capturedProbabilityMass: asset.data.captured_probability_mass,
        finiteGridDensityIntegral: asset.data.finite_grid_density_integral,
        gridResolution: asset.data.grid_resolution,
        gridSpacingBohr: asset.data.grid_spacing_bohr,
        metadata: asset.data.metadata,
        warnings: asset.data.metadata.warnings,
      }
    case 'slice':
    case 'superposition_slice':
      // One adapter for both: the two payloads differ only in metadata, and
      // deciding which arm to fill is `statusFromSlice`'s own job.
      return statusFromSlice(asset.data)
    case 'streamlines':
      return statusFromCurrentField(asset.data)
    case 'superposition_isosurface':
      return statusFromSuperpositionIsosurface(asset.data)
    default:
      return {
        loading: false,
        lineCount: asset.data.lines.length,
        maxSpeed: asset.data.max_speed,
        continuityResidual: asset.data.continuity_residual,
        continuityAbsoluteResidual: asset.data.continuity_absolute_residual,
        continuityScale: asset.data.continuity_scale,
        continuityScaleKind: asset.data.continuity_scale_kind,
        continuityProbeCount: asset.data.continuity_probe_count,
        continuityPhaseCount: asset.data.continuity_phase_count,
        extentBohr: asset.data.extent_bohr,
        timeAu: asset.data.metadata.time_au,
        superposition: asset.data.metadata,
        warnings: asset.data.metadata.warnings,
      }
  }
}

/**
 * Which physical object this is, as one string.
 *
 * `sceneIdentityKey` folds in everything the routes read -- including `aMu`,
 * `plane` and `sliceObservable`, which the slice rows added. The
 * superposition's own basis is appended because it changes the state being
 * drawn just as surely, and a scene whose identity did not mention it would
 * keep the old picture on screen after the user changed it.
 *
 * `aMu` used to be appended here too, on the assumption that only the
 * superposition routes read it. `/api/orbitals/slice` reads it as well, so it
 * belongs in the core key rather than in this superposition-flavoured
 * appendage; appending it a second time here would only make the key longer.
 */
function assetIdentityKey(inputs: SceneAssetInputs): string {
  return [sceneIdentityKey(inputs), `superpositionBasis=${inputs.superpositionBasis}`].join('|')
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Ask the server for the scene these inputs describe, and say honestly what is
 * on screen while it answers.
 *
 * Three things this owns that the canvas component should not: the abort
 * controller (aborting on a scene change, never on a clock tick), the
 * latest-wins coordinator, and the status the rest of the UI reads. A refusal
 * from the capability matrix produces a status and no request at all -- the
 * closed cells cannot reach a URL from here.
 */
export function useSceneAsset(
  inputs: SceneAssetInputs,
  onStatus: (status: SceneStatus) => void,
): SceneAssetState {
  const [asset, setAsset] = useState<SceneAsset | null>(null)
  const [fitKey, setFitKey] = useState<string | null>(null)
  const [coordinator] = useState(createFetchCoordinator)
  const controllerRef = useRef<AbortController | null>(null)
  const identityRef = useRef<string | null>(null)
  /** The status describing the frame on screen, or null when none is. */
  const frameStatusRef = useRef<SceneStatus | null>(null)
  /** The time of that frame, which lags the requested time while a fetch runs. */
  const renderedTimeRef = useRef<number | null>(null)
  const onStatusRef = useRef(onStatus)

  // Kept in a ref, and updated by an effect declared BEFORE the fetch effect
  // so the fetch effect always emits through the newest callback. Putting
  // `onStatus` in the fetch effect's dependencies instead would re-run the
  // whole fetch decision every time the parent re-created the callback.
  useEffect(() => {
    onStatusRef.current = onStatus
  }, [onStatus])

  const identityKey = assetIdentityKey(inputs)
  const timeAu = inputs.timeAu

  // Unmount, and nothing else. The abort used to live in the fetch effect's
  // cleanup, which re-runs on every tick: each time step cancelled the request
  // the previous step had started, so a round trip slower than the clock
  // rendered nothing at all. Identity changes still abort, explicitly, below.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      // StrictMode unmounts and remounts once in development; the remount has
      // to treat the scene as new and fetch again.
      identityRef.current = null
      coordinator.reset()
    }
  }, [coordinator])

  // `identityKey` and `timeAu` are together a total function of `inputs`, so
  // they stand for all of it here -- and they compare by value, where `inputs`
  // and `inputs.orbital` are fresh objects on every store write.
  useEffect(() => {
    const emit = (status: SceneStatus): void => {
      onStatusRef.current(status)
    }
    const planAt = (time: number) => planSceneRequest({ ...inputs, timeAu: time })

    const plan = planAt(timeAu)
    if (plan.status !== 'available') {
      // A closed cell: say what it is and why, and issue nothing. This is the
      // one path that must not reach the network, because the server would
      // answer a question the matrix has already said is meaningless.
      controllerRef.current?.abort()
      controllerRef.current = null
      coordinator.reset()
      identityRef.current = null
      frameStatusRef.current = null
      renderedTimeRef.current = null
      setAsset(null)
      setFitKey(null)
      emit({
        loading: false,
        unavailable: { kind: inputs.representation, reason: plan.reason },
      })
      return
    }

    // A plan with no time parameter cannot produce a different answer at a
    // different time -- the parameters ARE the request -- so a stationary
    // scene ignores the clock instead of re-fetching an identical grid.
    if (plan.params[TIME_PARAM] === undefined && identityRef.current === identityKey) return

    identityRef.current = identityKey
    const requestKey = identityKey
    const decision = coordinator.onInputsChanged({ identityKey, timeAu })

    if (decision.abortPrevious) {
      controllerRef.current?.abort()
      controllerRef.current = null
    }
    if (decision.clearScene) {
      // Only a different physical object clears the viewport. A later moment
      // of the same one does not: the frame on screen stays true until its
      // successor arrives.
      frameStatusRef.current = null
      renderedTimeRef.current = null
      setAsset(null)
      setFitKey(null)
      emit({ loading: true })
    } else if (frameStatusRef.current !== null) {
      // A later time of the same object, over a frame that is still up. The
      // numbers stay -- they are the frame's -- but the status now says they
      // are the OLD frame's, and at which time, rather than labelling stale
      // diagnostics with the time we have merely asked for.
      // `renderedTimeAu` rides along in the stored status, which is what makes
      // it the frame's own time rather than a second bookkeeping copy that
      // could disagree with it.
      emit({ ...frameStatusRef.current, refreshing: true, timeAu })
    }
    if (!decision.startFetch) return

    const startFetch = (activePlan: ScenePlan, time: number): void => {
      const controller = new AbortController()
      controllerRef.current = controller

      /** Run whatever the coordinator queued while this request was in flight. */
      const continueWith = ({ refetchTime }: ResponseDecision): void => {
        if (refetchTime === null) return
        const next = planAt(refetchTime)
        if (next.status === 'available') startFetch(next, refetchTime)
      }
      /** True only while this answer still describes the scene on screen. */
      const current = (): boolean =>
        !controller.signal.aborted && identityRef.current === requestKey

      executeSceneRequest(activePlan, inputs, controller.signal).then(
        (next) => {
          if (!current()) return
          setAsset(next)
          setFitKey(requestKey)
          renderedTimeRef.current = time
          const status: SceneStatus = { ...statusForAsset(next), renderedTimeAu: time }
          frameStatusRef.current = status
          emit(status)
          continueWith(coordinator.onResponse(time))
        },
        (error: unknown) => {
          if (!current()) return
          // The frame on screen is kept: a failed request does not make the
          // last successful one untrue, it just means it is now old.
          emit({
            loading: false,
            error: errorText(error),
            renderedTimeAu: renderedTimeRef.current ?? undefined,
          })
          continueWith(coordinator.onError(time))
        },
      )
    }

    startFetch(plan, timeAu)
    // `inputs` is intentionally absent from the dependencies: identityKey and
    // timeAu cover every field of it, and the object itself is a new one on
    // every render, so depending on it would re-run this on each frame.
  }, [coordinator, identityKey, timeAu])

  return { asset, fitKey }
}
