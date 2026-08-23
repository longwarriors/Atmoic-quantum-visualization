import { describe, expect, it } from 'vitest'

import { phaseToRgb } from './color'

describe('phaseToRgb', () => {
  it('is continuous across the -pi/+pi seam', () => {
    // quality-gates.md requires the phase wheel to be periodic. A hue map that
    // clamps instead of wrapping puts a visible seam through every complex
    // orbital exactly where the phase is most interesting.
    const lower = phaseToRgb(-Math.PI)
    const upper = phaseToRgb(Math.PI)
    lower.forEach((channel, index) => expect(channel).toBeCloseTo(upper[index], 6))
  })

  it('is periodic over a full turn', () => {
    for (const phase of [-2.4, -0.3, 0, 0.7, 2.9]) {
      const base = phaseToRgb(phase)
      const wrapped = phaseToRgb(phase + 2 * Math.PI)
      base.forEach((channel, index) => expect(channel).toBeCloseTo(wrapped[index], 6))
    }
  })

  it('keeps every channel inside the unit range', () => {
    for (let phase = -Math.PI; phase <= Math.PI; phase += Math.PI / 32) {
      for (const channel of phaseToRgb(phase)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('separates opposite phases, so +m and -m do not render identically', () => {
    const [r1, g1, b1] = phaseToRgb(0)
    const [r2, g2, b2] = phaseToRgb(Math.PI)
    expect(Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)).toBeGreaterThan(0.3)
  })
})
