import type { BasisKind } from '../api/types'

/**
 * Where to put the camera when a new scene arrives.
 *
 * A real p or d orbital has its lobes on the axes, so there is a direction from
 * which the shape reads as itself and a direction from which two lobes overlap
 * into a blob. Which one depends on m, and only in the real basis: a complex
 * orbital is a ring of constant magnitude about z, and no azimuthal viewpoint
 * is more honest than another, so it keeps the neutral three-quarter view.
 *
 * A plain tuple rather than a three.js Vector3: this is arithmetic, it belongs
 * in the test suite, and importing three here would drag a WebGL harness in
 * with it. The caller normalises and scales it to its own orbit distance.
 */
export type CameraDirection = readonly [number, number, number]

export interface CameraViewState {
  basis: BasisKind
  l: number
  m: number
}

/** The neutral three-quarter view: nothing about the state argues for another. */
export const DEFAULT_CAMERA_DIRECTION: CameraDirection = [1, 0.45, 1]

/** Looking down +z: for a lobe pair lying along x. */
const ALONG_Z: CameraDirection = [0, 0.35, 1]
/** Looking down +x: for a lobe pair lying along y or z. */
const ALONG_X: CameraDirection = [1, 0.35, 0]

/**
 * The canonical view direction for a state, as a fresh tuple.
 *
 * Fresh on purpose: the canvas normalises the vector it is handed, in place,
 * so a shared array would be scaled to unit length by the first scene and stay
 * that way for every later one.
 */
export function cameraDirectionFor(state: CameraViewState | undefined): [number, number, number] {
  return [...direction(state)]
}

function direction(state: CameraViewState | undefined): CameraDirection {
  if (state?.basis !== 'real') {
    return DEFAULT_CAMERA_DIRECTION
  }
  if (state.l === 1) {
    // m = 1 is p_x (the real basis names the x combination m = +1 here), whose
    // lobes lie along x and read best from +z.
    return state.m === 1 ? ALONG_Z : ALONG_X
  }
  if (state.l === 2) {
    // |m| = 2 are d_xy and d_x2-y2, both in the xy-plane.
    return state.m === 2 || state.m === -2 ? ALONG_Z : ALONG_X
  }
  return DEFAULT_CAMERA_DIRECTION
}
