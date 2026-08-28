import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { phaseToLinearRgb, phaseToRgb, srgbChannelToLinear } from './color'

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`
}

function ruleHexColours(selector: string): string[] {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf-8')
  const escaped = selector.replaceAll('.', '\\.')
  const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (rule === null) {
    throw new Error(`styles.css has no ${selector} rule`)
  }
  return [...rule[1].matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].toLowerCase())
}

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

  it('is the byte-exact source of the shipped phase legend', () => {
    const phases = [Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3, 0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI]
    expect(ruleHexColours('.phase-wheel')).toEqual(phases.map((phase) => toHex(phaseToRgb(phase))))

    expect(ruleHexColours('.phase-dot.red')).toEqual([
      toHex(phaseToRgb(0)),
      toHex(phaseToRgb(0)),
    ])
    expect(ruleHexColours('.phase-dot.cyan')).toEqual([
      toHex(phaseToRgb(Math.PI)),
      toHex(phaseToRgb(Math.PI)),
    ])
  })

  it('decodes sRGB through the same numerical transfer anchors as the GPU', () => {
    expect(srgbChannelToLinear(0)).toBe(0)
    // Boundary control for the linear branch of the piecewise sRGB EOTF.
    expect(srgbChannelToLinear(0.04045)).toBeCloseTo(0.00313080495336, 14)
    expect(srgbChannelToLinear(0.2744)).toBeCloseTo(0.06119708338413325, 14)
    expect(srgbChannelToLinear(0.98)).toBeCloseTo(0.9551045992327599, 14)
  })

  it.each([
    [-Math.PI, [0.06119708338413325, 0.9551045992327599, 0.9551045992327599]],
    [-Math.PI / 2, [0.35122240550796674, 0.06119708338413325, 0.9551045992327599]],
    [0, [0.9551045992327599, 0.06119708338413325, 0.06119708338413325]],
    [Math.PI / 2, [0.35122240550796674, 0.9551045992327599, 0.06119708338413325]],
    [Math.PI, [0.06119708338413325, 0.9551045992327599, 0.9551045992327599]],
  ] as const)('decodes the phase anchor %s into Linear-sRGB', (phase, expected) => {
    phaseToLinearRgb(phase).forEach((channel, index) => {
      expect(channel).toBeCloseTo(expected[index], 12)
    })
  })
})
