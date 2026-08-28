/**
 * What `OrbitalSurface` builds, asserted on the real three.js geometry it
 * constructs.
 *
 * GO from the T0 harness spike: this component renders under
 * `@react-three/test-renderer` with nothing mocked, so the attribute counts and
 * colours below are read off the `THREE.BufferGeometry` the component created.
 * Nothing here claims the surface LOOKS right -- there is no GPU in this
 * process and no frame is drawn; shading and silhouette are PR-8C's business.
 *
 * Harness facts from the spike that this file depends on: specs cannot use JSX
 * (vitest.config.ts declares no React plugin, so esbuild uses the classic
 * runtime and JSX dies with "React is not defined"), and
 * `renderer.scene.children[i]` is a `ReactThreeTestInstance` wrapper whose
 * `.geometry` is `undefined` -- assertions therefore go through `.instance`
 * and `.type` rather than `instanceof`, which is false across the test
 * renderer's second copy of three.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SurfaceGeometry } from '../api/types'
import { phaseToLinearRgb, phaseToRgb } from './color'
import { OrbitalSurface } from './OrbitalSurface'

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

/** A tetrahedron: four vertices, four faces, one phase per vertex. */
function surface(): SurfaceGeometry {
  return {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    normals: [
      [0, 0, -1],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    faces: [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ],
    phase: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
  }
}

/* ---------------------------------------------------------------- harness */

interface Rendered {
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>
  group: THREE.Object3D
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
}

async function render(data: SurfaceGeometry, opacity = 1): Promise<Rendered> {
  const renderer = await ReactThreeTestRenderer.create(
    createElement(OrbitalSurface, { data, opacity }),
  )
  const groupNode = renderer.scene.children[0]
  const meshNode = groupNode.children[0]
  const mesh = meshNode.instance as THREE.Mesh
  return {
    renderer,
    group: groupNode.instance,
    mesh,
    geometry: mesh.geometry as THREE.BufferGeometry,
  }
}

const attributeOf = (geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute =>
  geometry.getAttribute(name) as THREE.BufferAttribute

/* ------------------------------------------------------------------ specs */

describe('OrbitalSurface', () => {
  it('renders one indexed mesh inside a group', async () => {
    const { renderer, group, mesh } = await render(surface())

    expect(group.type).toBe('Group')
    expect(mesh.type).toBe('Mesh')
    // A phase surface neither receives a decorative lighting term nor casts a
    // second, unlabeled silhouette onto the grid.
    expect(mesh.castShadow).toBe(false)
    expect(mesh.receiveShadow).toBe(false)

    await renderer.unmount()
  })

  it('carries one position and one normal per payload vertex, and every face index', async () => {
    const data = surface()
    const { renderer, geometry } = await render(data)

    expect(attributeOf(geometry, 'position').count).toBe(data.vertices.length)
    expect(attributeOf(geometry, 'normal').count).toBe(data.normals.length)
    // Indexed, not expanded: 4 triangles addressing 4 shared vertices. Keep
    // the API's normals with those vertices even though the deliberately unlit
    // data-colour material does not consume them.
    expect(geometry.getIndex()?.count).toBe(data.faces.length * 3)

    const position = attributeOf(geometry, 'position')
    expect([position.getX(1), position.getY(1), position.getZ(1)]).toEqual([1, 0, 0])
    const normal = attributeOf(geometry, 'normal')
    expect([normal.getX(0), normal.getY(0), normal.getZ(0)]).toEqual([0, 0, -1])
    expect(Array.from(geometry.getIndex()?.array ?? [])).toEqual(data.faces.flat())

    await renderer.unmount()
  })

  it('colours every vertex by its own phase', async () => {
    const data = surface()
    const { renderer, geometry } = await render(data)
    const color = attributeOf(geometry, 'color')

    expect(color.count).toBe(data.phase.length)
    data.phase.forEach((phase, index) => {
      const [r, g, b] = phaseToLinearRgb(phase)
      expect(color.getX(index)).toBeCloseTo(r, 6)
      expect(color.getY(index)).toBeCloseTo(g, 6)
      expect(color.getZ(index)).toBeCloseTo(b, 6)
    })
    // Phase is the whole point of the colour: two different phases must not
    // land on the same colour.
    expect(color.getX(0)).not.toBeCloseTo(color.getX(2), 3)
    // The legend values are sRGB bytes. Writing those bytes directly into a
    // vertex attribute makes Three encode them a second time on output.
    expect(color.getY(0)).not.toBeCloseTo(phaseToRgb(0)[1], 3)

    await renderer.unmount()
  })

  it('uses an unlit material immune to lights, normals, shadows, fog and tone mapping', async () => {
    const { renderer, mesh } = await render(surface())
    const material = mesh.material as THREE.MeshBasicMaterial

    expect(material.type).toBe('MeshBasicMaterial')
    expect(material.vertexColors).toBe(true)
    expect(material.fog).toBe(false)
    expect(material.toneMapped).toBe(false)
    expect(material.side).toBe(THREE.FrontSide)

    await renderer.unmount()
  })

  it('measures its own bounds so the camera fit has something to frame', async () => {
    const { renderer, geometry } = await render(surface())

    expect(geometry.boundingBox).not.toBeNull()
    expect(geometry.boundingSphere).not.toBeNull()
    expect(geometry.boundingBox?.max.x).toBe(1)

    await renderer.unmount()
  })

  it('writes depth only while the surface is nearly opaque', async () => {
    const opaque = await render(surface(), 1)
    const opaqueMaterial = opaque.mesh.material as THREE.Material
    expect(opaqueMaterial.transparent).toBe(false)
    expect((opaqueMaterial as THREE.MeshBasicMaterial).depthWrite).toBe(true)
    await opaque.renderer.unmount()

    const glassy = await render(surface(), 0.5)
    const glassyMaterial = glassy.mesh.material as THREE.Material
    expect(glassyMaterial.transparent).toBe(true)
    expect(glassyMaterial.opacity).toBe(0.5)
    // A translucent lobe that wrote depth would occlude the lobe behind it and
    // hide half the orbital.
    expect((glassyMaterial as THREE.MeshBasicMaterial).depthWrite).toBe(false)
    await glassy.renderer.unmount()
  })

  it('disposes its geometry on unmount', async () => {
    const { renderer, geometry } = await render(surface())
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.unmount()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the superseded geometry when a new payload arrives', async () => {
    const { renderer, geometry } = await render(surface())
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.update(createElement(OrbitalSurface, { data: surface(), opacity: 1 }))

    expect(dispose).toHaveBeenCalledTimes(1)
    const next = (renderer.scene.children[0].children[0].instance as THREE.Mesh).geometry
    expect(next).not.toBe(geometry)

    await renderer.unmount()
  })

  it('keeps the geometry it has when only the opacity changes', async () => {
    const data = surface()
    const { renderer, geometry } = await render(data, 1)
    const dispose = vi.spyOn(geometry, 'dispose')

    await renderer.update(createElement(OrbitalSurface, { data, opacity: 0.4 }))

    // Rebuilding a 40k-triangle isosurface because a slider moved would stall
    // the frame for no new information.
    expect(dispose).not.toHaveBeenCalled()
    const meshNode = renderer.scene.children[0].children[0]
    expect((meshNode.instance as THREE.Mesh).geometry).toBe(geometry)
    expect(((meshNode.instance as THREE.Mesh).material as THREE.Material).opacity).toBe(0.4)

    await renderer.unmount()
  })
})
