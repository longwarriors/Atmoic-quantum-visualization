import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { PLANE_FRAMES, PRINCIPAL_PLANES } from '../api/sliceContract'
import type { BasisKind } from '../api/types'
import {
  DEFAULT_CAMERA_DIRECTION,
  cameraDirectionFor,
  cameraDirectionForPlane,
  cameraUpForPlane,
} from './camera'

const state = (basis: BasisKind, l: number, m: number) => ({ basis, l, m })

describe('cameraDirectionFor', () => {
  it('frames a scene it knows nothing about from the three-quarter default', () => {
    expect(cameraDirectionFor(undefined)).toEqual([1, 0.45, 1])
    expect(DEFAULT_CAMERA_DIRECTION).toEqual([1, 0.45, 1])
  })

  it('looks down the node of a real p orbital', () => {
    // 2p_x (m = 1) points along x, so a camera on +z sees the two lobes side
    // by side; 2p_y and 2p_z are seen from +x for the same reason.
    expect(cameraDirectionFor(state('real', 1, 1))).toEqual([0, 0.35, 1])
    expect(cameraDirectionFor(state('real', 1, 0))).toEqual([1, 0.35, 0])
    expect(cameraDirectionFor(state('real', 1, -1))).toEqual([1, 0.35, 0])
  })

  it('does the same for the real d orbitals, with |m| = 2 as the in-plane pair', () => {
    expect(cameraDirectionFor(state('real', 2, 2))).toEqual([0, 0.35, 1])
    expect(cameraDirectionFor(state('real', 2, -2))).toEqual([0, 0.35, 1])
    for (const m of [-1, 0, 1]) {
      expect(cameraDirectionFor(state('real', 2, m))).toEqual([1, 0.35, 0])
    }
  })

  it('keeps the default for every other real l', () => {
    for (const l of [0, 3, 4]) {
      for (let m = -l; m <= l; m += 1) {
        expect(cameraDirectionFor(state('real', l, m)), `l=${l} m=${m}`).toEqual([1, 0.45, 1])
      }
    }
  })

  it('keeps the default for the complex basis, whose lobes are not axis-aligned', () => {
    for (let l = 0; l <= 3; l += 1) {
      for (let m = -l; m <= l; m += 1) {
        expect(cameraDirectionFor(state('complex', l, m)), `l=${l} m=${m}`).toEqual([1, 0.45, 1])
      }
    }
  })

  it('returns a fresh array each call, so a caller cannot mutate the next answer', () => {
    // The canvas normalises the vector in place; a shared constant would be
    // scaled to unit length once and stay wrong for every later scene.
    const first = cameraDirectionFor(undefined)
    const second = cameraDirectionFor(undefined)
    expect(first).not.toBe(second)
    expect(first).not.toBe(DEFAULT_CAMERA_DIRECTION)
  })
})

/** Distance along the view direction. Arbitrary: only the basis is asserted. */
const ORBIT_DISTANCE = 7.5

/**
 * The world-space camera basis after a real three.js `lookAt(0, 0, 0)`.
 *
 * The assertion has to go through a real PerspectiveCamera rather than through
 * a re-derivation of `Matrix4.lookAt`: the claim under test is "three's own
 * basis lands on u and v", and a hand-rolled cross product here would agree
 * with a hand-rolled cross product in the module for exactly as long as both
 * are wrong in the same way.
 */
function screenBasis(
  direction: readonly [number, number, number],
  up: readonly [number, number, number],
): { x: Vector3; y: Vector3; z: Vector3 } {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(...direction).normalize().multiplyScalar(ORBIT_DISTANCE)
  camera.up.set(...up)
  camera.lookAt(0, 0, 0)
  // lookAt writes the quaternion; the matrix the basis is read from is only
  // rebuilt from it on the next update, which nothing here would otherwise do.
  camera.updateMatrixWorld(true)
  const x = new Vector3()
  const y = new Vector3()
  const z = new Vector3()
  camera.matrixWorld.extractBasis(x, y, z)
  return { x, y, z }
}

const closeTo = (actual: Vector3, expected: readonly [number, number, number], label: string) => {
  expect(actual.x, `${label}.x`).toBeCloseTo(expected[0], 12)
  expect(actual.y, `${label}.y`).toBeCloseTo(expected[1], 12)
  expect(actual.z, `${label}.z`).toBeCloseTo(expected[2], 12)
}

describe('cameraDirectionForPlane / cameraUpForPlane', () => {
  it('hands back the frozen frame normal and v axis, as fresh plain tuples', () => {
    for (const plane of PRINCIPAL_PLANES) {
      const frame = PLANE_FRAMES[plane]
      expect(cameraDirectionForPlane(plane), plane).toEqual([...frame.normal])
      expect(cameraUpForPlane(plane), plane).toEqual([...frame.v_axis])
      // Fresh arrays for the same reason cameraDirectionFor returns one: the
      // canvas normalises the vector it is handed, in place.
      expect(cameraDirectionForPlane(plane)).not.toBe(cameraDirectionForPlane(plane))
      expect(cameraUpForPlane(plane)).not.toBe(cameraUpForPlane(plane))
    }
  })

  it('puts the xz normal on -y, where a right-handed frame needs it', () => {
    // x_hat x z_hat = -y_hat. +y here is the mirror that reverses every phase
    // winding on the plane, and it is also parallel to the naive `up` of +y,
    // which would make lookAt degenerate rather than merely wrong.
    expect(cameraDirectionForPlane('xz')).toEqual([0, -1, 0])
  })

  it('lands screen +X on the u axis and screen +Y on the v axis, for every plane', () => {
    for (const plane of PRINCIPAL_PLANES) {
      const frame = PLANE_FRAMES[plane]
      const basis = screenBasis(cameraDirectionForPlane(plane), cameraUpForPlane(plane))
      closeTo(basis.x, frame.u_axis, `${plane} screen +X`)
      closeTo(basis.y, frame.v_axis, `${plane} screen +Y`)
      // And the camera looks down -Z, so its +Z is the way it came: the normal.
      closeTo(basis.z, frame.normal, `${plane} screen +Z`)
    }
  })

  it('places the camera off the plane, on the normal side of it', () => {
    for (const plane of PRINCIPAL_PLANES) {
      const direction = cameraDirectionForPlane(plane)
      const normal = PLANE_FRAMES[plane].normal
      const alongNormal =
        direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2]
      expect(alongNormal, `${plane} looks at the plane from its own normal side`).toBeCloseTo(1, 12)
    }
  })
})
