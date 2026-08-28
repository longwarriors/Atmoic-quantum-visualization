/**
 * The contract src/scene/ElectronCloud.tsx relies on, asserted against the
 * shader sources themselves.
 *
 * src/scene/shaders/ used to sit in vitest.config.ts's `coverage.exclude` as a
 * whole directory, justified as "GLSL string modules: no branches, verified by
 * the WebGL compiler". Nothing enforced that justification, and it was an
 * escape hatch rather than a scope decision: an ordinary .ts helper with an
 * uncovered branch, dropped in here and called from src/scene/color.ts, left
 * `npm test` at exit 0 with all three coverage gates green, `npm run build` at
 * exit 0, and the uncovered branch in the production bundle (measured). The
 * exclusion is gone; these modules are gated like every other module under
 * src/scene/, and this spec is what covers them.
 *
 * That makes the per-file thresholds meaningful here -- importing the module
 * executes its two export statements -- but a bare import would pass while the
 * shaders said nothing at all, so what is asserted below is the interface the
 * scene actually binds to. None of it is checked anywhere else in this suite:
 * the components that compile these programs need a WebGL/DOM harness the
 * suite does not provide (PR-8), so a renamed uniform or a dropped varying is
 * a runtime failure in the browser today, with nothing red before it.
 */
import { describe, expect, it } from 'vitest'
import { ShaderChunk } from 'three'

import { PHASE_SATURATION, PHASE_TURN_RADIANS, PHASE_VALUE } from '../color'
import { orbitalPointFragmentShader, orbitalPointVertexShader } from './orbitalPoints'

/** The two programs, as `ShaderMaterial` receives them. */
const STAGES = [
  ['vertex', orbitalPointVertexShader],
  ['fragment', orbitalPointFragmentShader],
] as const

/**
 * Every uniform ElectronCloud.tsx sets by name. `pointSize` and `opacity` are
 * written on every prop change (`materialRef.current.uniforms.pointSize.value
 * = ...`), which throws on an undeclared uniform rather than degrading, and
 * `pixelRatio` is seeded once at material construction.
 */
const UNIFORMS = ['pointSize', 'pixelRatio', 'opacity']

/**
 * three.js resolves `#include <name>` against its own ShaderChunk registry
 * while compiling, and an unknown name throws there. Phase is data, so this
 * shader performs only the renderer's output colour-space conversion. Fog and
 * tone mapping are deliberately absent: their corresponding material flags
 * are false and either transform would make the legend cease to be a key.
 */
const VERTEX_CHUNKS: readonly string[] = []
const FRAGMENT_CHUNKS = ['colorspace_fragment']
const DATA_COLOR_TRANSFORMS = [
  'fog_pars_vertex',
  'fog_vertex',
  'fog_pars_fragment',
  'fog_fragment',
  'tonemapping_fragment',
]

describe('orbitalPoints shaders', () => {
  it.each(STAGES)('exports the %s stage as a non-empty GLSL string', (_stage, source) => {
    expect(typeof source).toBe('string')
    // Emptying the module, or replacing a shader with a placeholder, leaves
    // the import and the per-file threshold satisfied; this is what does not.
    expect(source.trim().length).toBeGreaterThan(0)
    expect(source, 'a GLSL stage with no main() does not link').toContain('void main()')
  })

  it('declares the attribute and the outputs the vertex stage must write', () => {
    // `phase` is set per point by ElectronCloud.tsx
    // (`setAttribute('phase', ...)`); `position` is three's built-in and is
    // deliberately not re-declared. gl_Position is required of any vertex
    // stage, and gl_PointSize is what makes a THREE.Points draw visible at
    // all -- without it the points render at one pixel.
    expect(orbitalPointVertexShader).toMatch(/\battribute\s+float\s+phase\b/)
    expect(orbitalPointVertexShader).toMatch(/\bgl_Position\s*=/)
    expect(orbitalPointVertexShader).toMatch(/\bgl_PointSize\s*=/)
  })

  it('writes a fragment colour', () => {
    expect(orbitalPointFragmentShader).toMatch(/\bgl_FragColor\s*=/)
  })

  it('shares the CPU phase palette and decodes its sRGB before output conversion', () => {
    expect(orbitalPointFragmentShader).toContain(`vPhase / ${PHASE_TURN_RADIANS}`)
    expect(orbitalPointFragmentShader).toContain(
      `hsv2rgb(vec3(hue, ${PHASE_SATURATION}, ${PHASE_VALUE}))`,
    )

    const palette = orbitalPointFragmentShader.indexOf('vec3 phaseSrgb = hsv2rgb')
    const decode = orbitalPointFragmentShader.indexOf('vec3 phaseLinear = sRGBTransferEOTF')
    const output = orbitalPointFragmentShader.indexOf('gl_FragColor = vec4(phaseLinear')
    expect(palette).toBeGreaterThan(-1)
    expect(decode).toBeGreaterThan(palette)
    expect(output).toBeGreaterThan(decode)
    expect(orbitalPointFragmentShader).not.toContain('gl_FragColor = vec4(phaseSrgb')

    // ShaderMaterial receives this helper from Three's program prefix. Pin the
    // dependency contract and the coefficients color.ts's numerical anchors
    // exercise, so either side changing alone makes this test fail.
    expect(ShaderChunk.colorspace_pars_fragment).toMatch(/\bvec4\s+sRGBTransferEOTF\b/)
    for (const coefficient of ['0.04045', '0.9478672986', '0.0521327014', '2.4', '0.0773993808']) {
      expect(ShaderChunk.colorspace_pars_fragment).toContain(coefficient)
    }
  })

  it.each(UNIFORMS)('declares the %s uniform ElectronCloud.tsx sets by name', (name) => {
    const declaration = new RegExp(`\\buniform\\s+\\w+\\s+${name}\\b`)
    const declared = STAGES.filter(([, source]) => declaration.test(source)).map(([stage]) => stage)
    expect(
      declared,
      `no stage declares uniform ${name}; ElectronCloud.tsx writes uniforms.${name}.value, ` +
        'which throws on a material that has no such uniform',
    ).not.toEqual([])
  })

  it('passes vPhase across the stage boundary, declared identically on both sides', () => {
    // A varying declared in one stage only is a link error, and a type
    // mismatch between the two declarations is another. Both are invisible
    // until a browser compiles the program.
    const varying = /\bvarying\s+float\s+vPhase\b/
    expect(orbitalPointVertexShader).toMatch(varying)
    expect(orbitalPointFragmentShader).toMatch(varying)
    expect(orbitalPointVertexShader, 'the vertex stage never assigns vPhase').toMatch(
      /\bvPhase\s*=/,
    )
  })

  it.each([
    ['vertex', orbitalPointVertexShader, VERTEX_CHUNKS],
    ['fragment', orbitalPointFragmentShader, FRAGMENT_CHUNKS],
  ] as const)('includes the three.js %s chunks the material flags require', (_stage, source, chunks) => {
    const included = [...source.matchAll(/#include\s*<([^>]+)>/g)].map((match) => match[1])
    for (const chunk of chunks) {
      expect(included, `#include <${chunk}> is missing`).toContain(chunk)
    }
    // A chunk name three.js does not know throws while compiling, so the set
    // is pinned in both directions rather than only checked for presence.
    expect(
      included.filter((chunk) => !chunks.includes(chunk as never)),
      'shader chunks this spec does not know about: add them here, with the material flag ' +
        'that requires them, or drop them from the shader',
    ).toEqual([])
  })

  it.each(DATA_COLOR_TRANSFORMS)('does not opt phase data into <%s>', (chunk) => {
    const sources = STAGES.map(([, source]) => source).join('\n')
    expect(sources).not.toContain(`#include <${chunk}>`)
  })
})
