/** @vitest-environment jsdom */
/**
 * What `ElectronCloud` builds, and what it does NOT rebuild when a display
 * slider moves.
 *
 * GO from the T0 harness spike: this component renders under
 * `@react-three/test-renderer` with nothing mocked, so the buffers and uniforms
 * below are the real `THREE.BufferGeometry` and `THREE.ShaderMaterial` the
 * component created. This file proves construction and update behaviour only --
 * no pixel is produced in this process, and how the sprite actually looks is
 * PR-8C's business.
 *
 * `jsdom` rather than the config's default `node` environment, and it is not
 * cosmetic: the component reads `window.devicePixelRatio` to size its points,
 * so under `node` it throws on mount.
 *
 * Harness facts from the spike this file depends on: specs cannot use JSX
 * (vitest.config.ts declares no React plugin, so esbuild compiles with the
 * classic runtime and JSX dies with "React is not defined"), and
 * `renderer.scene.children[i]` is a `ReactThreeTestInstance` wrapper whose
 * `.geometry` is `undefined` -- so every assertion reads `.instance` or
 * `.type`, never `instanceof`, which is false across the test renderer's second
 * copy of three.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createElement } from 'react'
import type * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrbitalMetadata, PointCloudData } from '../api/types'
import { ElectronCloud } from './ElectronCloud'
import { orbitalPointFragmentShader, orbitalPointVertexShader } from './shaders/orbitalPoints'

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

/* --------------------------------------------------------------- fixtures */

const metadata = (): OrbitalMetadata => ({
  state: { n: 2, l: 1, m: 0, z: 1, a_mu: 1, basis: 'real' },
  label: '2p_z',
  energy_hartree: -0.125,
  length_unit: 'bohr',
  observable: '|psi|^2',
  representation: 'point_cloud',
  normalization: 'unit',
  coordinate_convention: 'physics',
  spherical_harmonic_convention: 'condon-shortley',
  geometry_semantics: 'importance-sampled positions',
  color_semantics: 'phase',
  references: [],
  warnings: [],
})

/** Three sampled positions with one phase each. */
function cloud(): PointCloudData {
  return {
    count: 3,
    stride: 3,
    positions: new Float32Array([0, 0, 0, 1, 2, 3, -1, -2, -3]),
    intensity: new Float32Array([1, 0.5, 0.25]),
    phase: new Float32Array([0, Math.PI, 2 * Math.PI]),
    radialMass: 0.9,
    extentBohr: 12,
    metadata: metadata(),
  }
}

/* ---------------------------------------------------------------- harness */

interface Rendered {
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>
  points: THREE.Points
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
}

function readNode(renderer: Rendered['renderer']): Omit<Rendered, 'renderer'> {
  const points = renderer.scene.children[0].instance as THREE.Points
  return {
    points,
    geometry: points.geometry as THREE.BufferGeometry,
    material: points.material as THREE.ShaderMaterial,
  }
}

async function render(
  data: PointCloudData,
  pointSize = 2.8,
  opacity = 1,
): Promise<Rendered> {
  const renderer = await ReactThreeTestRenderer.create(
    createElement(ElectronCloud, { data, pointSize, opacity }),
  )
  return { renderer, ...readNode(renderer) }
}

const attributeOf = (geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute =>
  geometry.getAttribute(name) as THREE.BufferAttribute

/* ------------------------------------------------------------------ specs */

describe('ElectronCloud', () => {
  it('renders one un-culled point per sample, with its phase alongside', async () => {
    const data = cloud()
    const { renderer, points, geometry } = await render(data)

    expect(points.type).toBe('Points')
    expect(attributeOf(geometry, 'position').count).toBe(data.count)
    expect(attributeOf(geometry, 'phase').count).toBe(data.count)
    expect(attributeOf(geometry, 'phase').itemSize).toBe(1)
    // The payload's own buffers, not a copy: a 28k-sample cloud is re-uploaded
    // on every frame of playback and copying it twice is pure latency.
    expect(attributeOf(geometry, 'position').array).toBe(data.positions)
    expect(attributeOf(geometry, 'phase').array).toBe(data.phase)
    // Sprites are drawn far larger than their vertex, so a point at the edge
    // of the frustum must not vanish because its zero-size bounding point left
    // it.
    expect(points.frustumCulled).toBe(false)

    await renderer.unmount()
  })

  it('drives the point shaders and starts from the props it was given', async () => {
    const { renderer, material } = await render(cloud(), 3.5, 0.6)

    expect(material.vertexShader).toBe(orbitalPointVertexShader)
    expect(material.fragmentShader).toBe(orbitalPointFragmentShader)
    expect(material.uniforms.pointSize.value).toBe(3.5)
    expect(material.uniforms.opacity.value).toBe(0.6)
    expect(material.transparent).toBe(true)
    // Additive-looking clouds are order-independent only while nothing writes
    // depth; a depth-writing point sprite erases the samples behind it.
    expect(material.depthWrite).toBe(false)

    await renderer.unmount()
  })

  it('keeps phase data colours independent of fog depth and tone mapping', async () => {
    const { renderer, material } = await render(cloud())

    // Negative controls: enabling either transform makes one phase acquire a
    // different screen colour as the camera or exposure control moves.
    expect(material.fog).toBe(false)
    expect(material.toneMapped).toBe(false)
    expect(material.uniforms).not.toHaveProperty('fogColor')
    expect(material.uniforms).not.toHaveProperty('fogNear')
    expect(material.uniforms).not.toHaveProperty('fogFar')

    await renderer.unmount()
  })

  it('sizes its sprites by the device pixel ratio, capped at 2', async () => {
    const original = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    try {
      const { renderer, material } = await render(cloud())
      // Uncapped, a 3x display would ask for sprites nine times the fill cost
      // for no more information.
      expect(material.uniforms.pixelRatio.value).toBe(2)
      await renderer.unmount()
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
    }
  })

  it('updates the pointSize uniform without rebuilding the geometry', async () => {
    const data = cloud()
    const { renderer, geometry, material } = await render(data, 2.8, 1)
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.update(
      createElement(ElectronCloud, { data, pointSize: 6.25, opacity: 1 }),
    )

    const after = readNode(renderer)
    expect(after.material.uniforms.pointSize.value).toBe(6.25)
    expect(after.material).toBe(material)
    // The identity assertion IS the test. A slider that moved 28k positions
    // back onto the GPU would drop frames while showing exactly the same
    // samples, so the geometry object must survive the update untouched.
    expect(after.geometry).toBe(geometry)
    expect(dispose).not.toHaveBeenCalled()

    await renderer.unmount()
  })

  it('updates the opacity uniform without rebuilding the geometry', async () => {
    const data = cloud()
    const { renderer, geometry } = await render(data, 2.8, 1)
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.update(
      createElement(ElectronCloud, { data, pointSize: 2.8, opacity: 0.3 }),
    )

    const after = readNode(renderer)
    expect(after.material.uniforms.opacity.value).toBe(0.3)
    expect(after.geometry).toBe(geometry)
    expect(dispose).not.toHaveBeenCalled()

    await renderer.unmount()
  })

  it('rebuilds and disposes when a different sample set arrives', async () => {
    const { renderer, geometry } = await render(cloud())
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.update(
      createElement(ElectronCloud, { data: cloud(), pointSize: 2.8, opacity: 1 }),
    )

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(readNode(renderer).geometry).not.toBe(geometry)

    await renderer.unmount()
  })

  it('disposes its geometry on unmount', async () => {
    const { renderer, geometry } = await render(cloud())
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.unmount()

    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
