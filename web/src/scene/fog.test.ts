import { describe, expect, it } from 'vitest'

import { fogRangeFor } from './fog'

describe('fogRangeFor', () => {
  it('asks for no fog at all at zero strength or below', () => {
    expect(fogRangeFor(20, 0)).toBeNull()
    expect(fogRangeFor(20, -0.5)).toBeNull()
  })

  it('scales the range with the scene extent', () => {
    // near = scale * (3 - 1.5 s), far = scale * (8 - 4 s), scale = max(extent, 4).
    const near = 10 * (3 - 1.5 * 0.2)
    const ten = fogRangeFor(10, 0.2)
    const twenty = fogRangeFor(20, 0.2)
    if (ten === null || twenty === null) throw new Error('unreachable')
    expect(ten.near).toBeCloseTo(27, 9)
    expect(ten.far).toBeCloseTo(72, 9)
    expect(ten.near).toBe(near)
    expect(twenty.near).toBeCloseTo(2 * ten.near, 9)
    expect(twenty.far).toBeCloseTo(2 * ten.far, 9)
  })

  it('floors the scale at 4 so a tiny orbital is not swallowed', () => {
    expect(fogRangeFor(1, 0.2)).toEqual(fogRangeFor(4, 0.2))
    expect(fogRangeFor(0, 0.2)).toEqual(fogRangeFor(4, 0.2))
  })

  it('falls back to a scale of 8 before any extent is known', () => {
    expect(fogRangeFor(undefined, 0.2)).toEqual(fogRangeFor(8, 0.2))
  })

  it('keeps near below far across the whole slider, so nothing is fogged out entirely', () => {
    // The Fog slider runs 0..70%; three.js needs near < far or the whole
    // scene renders at full fog density.
    for (let percent = 2; percent <= 70; percent += 2) {
      const range = fogRangeFor(12, percent / 100)
      expect(range, `${percent}%`).not.toBeNull()
      if (range === null) throw new Error('unreachable')
      expect(range.near, `${percent}%`).toBeGreaterThan(0)
      expect(range.far, `${percent}%`).toBeGreaterThan(range.near)
    }
  })

  it('recedes as the strength drops: weaker fog starts further out', () => {
    const weak = fogRangeFor(12, 0.1)
    const strong = fogRangeFor(12, 0.6)
    if (weak === null || strong === null) throw new Error('unreachable')
    expect(weak.near).toBeGreaterThan(strong.near)
    expect(weak.far).toBeGreaterThan(strong.far)
  })
})
