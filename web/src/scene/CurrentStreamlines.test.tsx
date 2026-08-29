/**
 * What `CurrentStreamlines` builds, asserted on the real three.js geometry it
 * constructs.
 *
 * GO from the T0 harness spike: this component renders under
 * `@react-three/test-renderer` with nothing mocked, so every number below is
 * read off the `THREE.BufferGeometry` the component itself created -- not off a
 * stub standing in for one. What this spec does NOT claim is that any of it
 * appears on a screen: there is no GPU here, no frame is drawn, and visual
 * fidelity is PR-8C's business.
 *
 * Two harness facts the spike established and this file depends on:
 *   - Specs cannot use JSX. vitest.config.ts declares no React plugin, so
 *     esbuild compiles this file with the CLASSIC JSX runtime and any JSX dies
 *     at run time with "React is not defined". Hence `createElement`.
 *   - `renderer.scene.children[i]` is a `ReactThreeTestInstance` WRAPPER, not a
 *     three object. Reading `.geometry` off the wrapper yields `undefined` and
 *     makes an assertion vacuously pass, so every assertion here goes through
 *     `.instance` (the real object) or `.type` (its three type name).
 *     `instanceof THREE.Mesh` is likewise false -- the test renderer pulls a
 *     second copy of three -- so structural checks use `.type` strings.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CurrentFieldPayload,
  OrbitalMetadata,
  StreamlineGeometry,
  SuperpositionCurrentPayload,
  SuperpositionMetadata,
} from '../api/types'
import { CurrentStreamlines } from './CurrentStreamlines'

/* ------------------------------------------------------------- act scope */

interface ActScope {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let restoreActEnvironment: () => void = () => undefined

beforeEach(() => {
  const scope = globalThis as ActScope
  const had = 'IS_REACT_ACT_ENVIRONMENT' in scope
  const previous = scope.IS_REACT_ACT_ENVIRONMENT
  scope.IS_REACT_ACT_ENVIRONMENT = true
  restoreActEnvironment = () => {
    if (had) {
      scope.IS_REACT_ACT_ENVIRONMENT = previous
    } else {
      delete scope.IS_REACT_ACT_ENVIRONMENT
    }
  }
})

afterEach(() => {
  restoreActEnvironment()
  vi.restoreAllMocks()
})

/* --------------------------------------------------------------- payloads */

/** Two streamlines of different lengths: 3 + 2 = 5 drawn segments. */
const LINES: number[][][] = [
  [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ],
  [
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 0],
  ],
]
const SPEED: number[][] = [
  [0, 1, 2, 4],
  [4, 2, 0],
]
const MAX_SPEED = 4

/** Vertices a `LineSegments` needs: both endpoints of every drawn segment. */
const expectedVertexCount = (lines: number[][][]): number =>
  2 * lines.reduce((total, line) => total + Math.max(0, line.length - 1), 0)

const orbitalMetadata = (): OrbitalMetadata => ({
  state: { n: 2, l: 1, m: 1, z: 1, a_mu: 1, basis: 'complex' },
  label: '2p_+1',
  energy_hartree: -0.125,
  length_unit: 'bohr',
  observable: 'probability current',
  representation: 'streamlines',
  normalization: 'unit',
  coordinate_convention: 'physics',
  spherical_harmonic_convention: 'condon-shortley',
  geometry_semantics: 'arc-length sampled flow lines',
  color_semantics: '|j|/rho',
  references: [],
  warnings: [],
})

const superpositionMetadata = (): SuperpositionMetadata => ({
  terms: [
    { n: 1, l: 0, m: 0, coefficient_real: 0.7071067811865476, coefficient_imag: 0 },
    { n: 2, l: 1, m: 0, coefficient_real: 0.7071067811865476, coefficient_imag: 0 },
  ],
  label: '1s + 2p_z',
  basis: 'complex',
  z: 1,
  a_mu: 1,
  reduced_mass_ratio: 1,
  time_au: 3.5,
  energy_expectation_hartree: -0.3125,
  is_stationary: false,
  length_unit: 'bohr',
  observable: 'probability current',
  representation: 'streamlines',
  normalization: 'unit',
  coordinate_convention: 'physics',
  spherical_harmonic_convention: 'condon-shortley',
  geometry_semantics: 'arc-length sampled flow lines',
  color_semantics: '|j|/rho',
  references: [],
  warnings: [],
})

function eigenstateField(overrides: Partial<CurrentFieldPayload> = {}): CurrentFieldPayload {
  return {
    lines: LINES,
    speed: SPEED,
    max_speed: MAX_SPEED,
    metadata: orbitalMetadata(),
    seed_count: 2,
    arc_step_bohr: 0.1,
    seed_density_floor: 1e-6,
    extent_bohr: 12,
    continuity_residual: 1e-9,
    continuity_absolute_residual: 1e-9,
    continuity_scale: 1,
    continuity_scale_kind: 'stationary_current',
    continuity_probe_count: 64,
    integration_rule: 'rk4',
    ...overrides,
  }
}

/**
 * A time-dependent current field. Structurally a superset of the eigenstate
 * payload and NOT assignable to it (`continuity_scale_kind` admits
 * `transition_coherence`, which the eigenstate union excludes), so a component
 * typed on `CurrentFieldPayload` cannot accept this -- which is exactly what
 * this spec exists to pin.
 */
function superpositionField(): SuperpositionCurrentPayload {
  return {
    lines: LINES,
    speed: SPEED,
    max_speed: MAX_SPEED,
    metadata: superpositionMetadata(),
    seed_count: 2,
    arc_step_bohr: 0.1,
    seed_density_floor: 1e-6,
    extent_bohr: 12,
    continuity_residual: 2e-9,
    continuity_absolute_residual: 2e-9,
    continuity_scale: 1,
    continuity_scale_kind: 'transition_coherence',
    continuity_probe_count: 64,
    continuity_phase_count: 8,
    density_rate_scale: 1,
    integration_rule: 'rk4',
  }
}

/* ---------------------------------------------------------------- harness */

interface Rendered {
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>
  segments: THREE.LineSegments
  geometry: THREE.BufferGeometry
}

async function render(data: StreamlineGeometry, opacity = 1): Promise<Rendered> {
  const renderer = await ReactThreeTestRenderer.create(
    createElement(CurrentStreamlines, { data, opacity }),
  )
  const node = renderer.scene.children[0]
  const segments = node.instance as THREE.LineSegments
  return { renderer, segments, geometry: segments.geometry }
}

const attributeOf = (geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute =>
  geometry.getAttribute(name) as THREE.BufferAttribute

/* ------------------------------------------------------------------ specs */

describe('CurrentStreamlines', () => {
  it('draws both endpoints of every segment of every line', async () => {
    const { renderer, segments, geometry } = await render(eigenstateField())

    expect(segments.type).toBe('LineSegments')
    expect(attributeOf(geometry, 'position').count).toBe(expectedVertexCount(LINES))
    // 10 vertices: line 0 contributes 3 segments, line 1 contributes 2.
    expect(attributeOf(geometry, 'position').count).toBe(10)
    expect(attributeOf(geometry, 'color').count).toBe(expectedVertexCount(LINES))

    await renderer.unmount()
  })

  it('places each segment endpoint at its own sampled point', async () => {
    const { renderer, geometry } = await render(eigenstateField())
    const position = attributeOf(geometry, 'position')

    // Segment 0 of line 0 runs from its first sample to its second; segment 1
    // starts again at that second sample, which is why the vertex count is
    // 2*(len-1) and not len.
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([0, 0, 0])
    expect([position.getX(1), position.getY(1), position.getZ(1)]).toEqual([1, 0, 0])
    expect([position.getX(2), position.getY(2), position.getZ(2)]).toEqual([1, 0, 0])
    // The second line starts at vertex 6 (line 0 used 3 segments = 6 vertices).
    expect([position.getX(6), position.getY(6), position.getZ(6)]).toEqual([0, 1, 0])

    await renderer.unmount()
  })

  it('renders a superposition current field through the same path', async () => {
    // The whole point of typing the prop on `StreamlineGeometry`: a
    // time-dependent payload is the same geometry, so it goes through the same
    // component rather than a parallel one that could drift from it.
    const data = superpositionField()
    const { renderer, segments, geometry } = await render(data)

    expect(segments.type).toBe('LineSegments')
    expect(attributeOf(geometry, 'position').count).toBe(expectedVertexCount(data.lines))
    expect(attributeOf(geometry, 'position').count).toBe(10)
    expect(attributeOf(geometry, 'color').count).toBe(expectedVertexCount(data.lines))

    await renderer.unmount()
  })

  it('renders a bare StreamlineGeometry, with no payload metadata at all', async () => {
    // Nothing outside `lines`, `speed` and `max_speed` is read, and the type
    // now says so. A component that reached for `metadata` would throw here.
    const bare: StreamlineGeometry = { lines: LINES, speed: SPEED, max_speed: MAX_SPEED }
    const { renderer, geometry } = await render(bare)

    expect(attributeOf(geometry, 'position').count).toBe(10)

    await renderer.unmount()
  })

  it('colours each endpoint by its own speed against the payload maximum', async () => {
    const { renderer, geometry } = await render(eigenstateField())
    const color = attributeOf(geometry, 'color')

    // Expected values are built by the same THREE.Color path the component
    // uses, because a hex literal is sRGB and three converts it into the
    // working colour space -- comparing against raw bytes would be comparing
    // two different spaces.
    const slow = new THREE.Color('#2b6cff')
    const fast = new THREE.Color('#ff4d6d')
    const at = (index: number): [number, number, number] => [
      color.getX(index),
      color.getY(index),
      color.getZ(index),
    ]
    const expected = (t: number): [number, number, number] => {
      const mixed = slow.clone().lerp(fast, t)
      return [mixed.r, mixed.g, mixed.b]
    }
    const near = (actual: [number, number, number], want: [number, number, number]): void => {
      actual.forEach((value, channel) => expect(value).toBeCloseTo(want[channel], 5))
    }

    // Vertex 0 is the zero-speed end of line 0: the pure "slow" colour.
    near(at(0), expected(0))
    // Vertex 1 sits at speed 1 of max 4. Colour is sqrt(|j|/rho / max) --
    // sqrt(0.25) = 0.5 -- so a quarter of the maximum speed reads as HALF the
    // colour ramp, not a quarter of it. That non-linearity is the ramp's, and
    // pinning it here is what stops it drifting into a linear one.
    near(at(1), expected(0.5))
    // Vertex 5 is the last endpoint of line 0, at speed == max_speed.
    near(at(5), expected(1))

    await renderer.unmount()
  })

  it('normalises colour without dividing by zero when the field is at rest', async () => {
    const atRest = eigenstateField({ speed: [[0, 0, 0, 0], [0, 0, 0]], max_speed: 0 })
    const { renderer, geometry } = await render(atRest)
    const color = attributeOf(geometry, 'color')

    for (let index = 0; index < color.count; index += 1) {
      expect(Number.isFinite(color.getX(index))).toBe(true)
      expect(Number.isFinite(color.getY(index))).toBe(true)
      expect(Number.isFinite(color.getZ(index))).toBe(true)
    }

    await renderer.unmount()
  })

  it('still draws a line whose speeds run short, at the slow end of the ramp', async () => {
    // `speed[i]` is supposed to be as long as `lines[i]`. If a payload ever
    // disagrees, the honest failure is a streamline coloured as if it were at
    // rest -- not a NaN colour, which three writes to the buffer as a black
    // vertex and which nothing downstream would flag.
    const truncated = eigenstateField({ speed: [[0, 1], [4, 2, 0]] })
    const { renderer, geometry } = await render(truncated)
    const color = attributeOf(geometry, 'color')

    expect(color.count).toBe(10)
    for (let index = 0; index < color.count; index += 1) {
      expect(Number.isNaN(color.getX(index))).toBe(false)
    }
    // Vertex 5 is the endpoint whose speed is missing: the pure "slow" colour.
    const slow = new THREE.Color('#2b6cff')
    expect(color.getX(5)).toBeCloseTo(slow.r, 5)
    expect(color.getZ(5)).toBeCloseTo(slow.b, 5)

    await renderer.unmount()
  })

  it('draws nothing at all when the field carries no lines', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      createElement(CurrentStreamlines, { data: eigenstateField({ lines: [], speed: [] }), opacity: 1 }),
    )

    expect(renderer.scene.children).toHaveLength(0)

    await renderer.unmount()
  })

  it('disposes its geometry on unmount', async () => {
    const { renderer, geometry } = await render(eigenstateField())
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.unmount()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the superseded geometry when a new frame arrives', async () => {
    const { renderer, geometry } = await render(superpositionField())
    const dispose = vi.spyOn(geometry, 'dispose')

    // A later instant of the same superposition: a fresh payload object, so a
    // fresh geometry. The old one is GPU memory nobody can reach any more.
    await renderer.update(
      createElement(CurrentStreamlines, { data: superpositionField(), opacity: 1 }),
    )

    expect(dispose).toHaveBeenCalledTimes(1)
    const next = (renderer.scene.children[0].instance as THREE.LineSegments).geometry
    expect(next).not.toBe(geometry)

    await renderer.unmount()
  })
})
