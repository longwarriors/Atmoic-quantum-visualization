import { PLANE_FRAMES } from '../api/sliceContract'
import type { BasisKind, PrincipalPlane } from '../api/types'

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

/**
 * Where to stand to look at a principal plane face-on, and which way is up
 * when you do.
 *
 * A slice is a picture of the (u, v) grid the server sampled, so the only
 * honest way to show it is the one where screen +X is u and screen +Y is v:
 * any other viewpoint hands the reader a rotated or mirrored copy of a payload
 * whose whole point is that its handedness is pinned down. Placing the camera
 * along the frame's OWN normal with the frame's v axis as `up` gets that for
 * free -- three's lookAt builds x = up x z and y = z x x, and the frozen frames
 * are orthonormal and right-handed, so x lands on u and y on v -- and it needs
 * no per-plane special case, only the table.
 *
 * The `xz` plane is where a shortcut shows: its normal is -y, because
 * x_hat x z_hat = -y_hat. Reaching for +y instead mirrors the picture, and the
 * usual reflex of "up is +y" is worse still -- there it is parallel to the view
 * direction, where lookAt has no basis to build at all.
 *
 * Both return plain tuples and import nothing from three, for the reason
 * `cameraDirectionFor` does: this is arithmetic over a frozen table, it belongs
 * in the test suite, and the caller scales and normalises what it is handed.
 */
export function cameraDirectionForPlane(plane: PrincipalPlane): [number, number, number] {
  // Copied, not aliased: PLANE_FRAMES is the contract's frozen table, and the
  // canvas normalises the vector it is given in place.
  return [...PLANE_FRAMES[plane].normal]
}

/** The frame's v axis: what screen +Y must be for the slice to read as sampled. */
export function cameraUpForPlane(plane: PrincipalPlane): [number, number, number] {
  return [...PLANE_FRAMES[plane].v_axis]
}
