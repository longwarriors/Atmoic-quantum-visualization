import { describe, expect, it } from 'vitest'

import type { BasisKind } from '../api/types'
import { DEFAULT_CAMERA_DIRECTION, cameraDirectionFor } from './camera'

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
