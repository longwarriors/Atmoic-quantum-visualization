/**
 * What `SliceField` puts in the scene, asserted on the real three objects it
 * builds.
 *
 * WHAT THIS FILE DOES NOT CLAIM: that the slice LOOKS right. There is no GPU in
 * this process and no frame is drawn here; the pixels are PR-8C's visual CI.
 * What is claimed is everything the picture's correctness rests on and that a
 * screenshot could not tell you anyway -- the sampling mode, the colour space,
 * the orientation of the quad, and that nothing survives unmount.
 *
 * Three of those deserve saying out loud, because they are the assertions a
 * reviewer would otherwise read as ceremony:
 *
 * **The filters.** `NearestFilter` is not a style choice. A masked texel is
 * `[0, 0, 0, 0]`; bilinear filtering would average it with its opaque
 * neighbours and produce a partially transparent texel whose RGB is a fraction
 * of a real phase colour -- i.e. it would invent a phase in the one region the
 * payload went to the trouble of saying has none.
 *
 * **The colour space.** The texels come out of `sliceColor.ts`, whose constants
 * are chosen by arithmetic defined on sRGB-encoded channels -- the WCAG
 * transfer function in sliceColor.test.ts, and a contrast ratio against the
 * scene background that only works out if the bytes are what a viewer sees. So
 * the texture is tagged sRGB, and the renderer decodes it once and encodes it
 * once, which is the identity. Tagging it `NoColorSpace` instead reads every
 * byte as a LINEAR value and encodes it on the way out, which lifted the dark
 * neutral #383838 to #818181 on screen and put the legend and the plane beside
 * it in disagreement -- the one thing this material turns tone mapping off to
 * prevent.
 *
 * **The quaternion.** Asserted by what it DOES to the plane's own axes -- local
 * +x lands on `u_axis`, +y on `v_axis`, +z on `normal` -- rather than by
 * comparing against a second `makeBasis` call. Recomputing the implementation
 * in the spec would pass just as happily with `u` and `v` swapped, which is
 * exactly the mistake that mirrors every asymmetric slice.
 *
 * Payloads are built as raw records and pushed through `parseSlicePayload`
 * rather than cast into shape, for `sliceTexture.test.ts`'s reason: a fixture
 * the contract would refuse is a fixture no renderer can ever be handed.
 *
 * Harness facts from the T0 spike this file depends on: specs cannot use JSX
 * (vitest.config.ts declares no React plugin, so esbuild compiles with the
 * classic runtime and JSX dies with "React is not defined"), and
 * `renderer.scene.findAll(...)` hands back `ReactThreeTestInstance` wrappers --
 * so assertions read `.instance` and `.type` rather than `instanceof`, which is
 * false across the test renderer's second copy of three. The default `node`
 * environment is enough: this component reads no `window`.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PLANE_FRAMES, parseSlicePayload, type AnySlicePayload } from '../api/sliceContract'
import type { PrincipalPlane } from '../api/types'
import { divergingRgb, sequentialRgb, SLICE_NEUTRAL_RGB, type Rgb } from './sliceColor'
import { SliceField } from './SliceField'
import { slicePlaneSize, sliceTexels } from './sliceTexture'

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

/* ------------------------------------------------------------- fixtures */

/** Odd, and at the contract's minimum: the smallest legal grid. */
const RESOLUTION = 65
const EXTENT_BOHR = 3.2
const SPACING_BOHR = (2 * EXTENT_BOHR) / (RESOLUTION - 1)

/**
 * An asymmetric field, for `sliceTexture.test.ts`'s reason: a symmetric one is
 * reproduced byte for byte by a transposed texeliser, so it can distinguish
 * nothing.
 */
function rampValues(): number[] {
  const values: number[] = []
  for (let row = 0; row < RESOLUTION; row += 1) {
    for (let col = 0; col < RESOLUTION; col += 1) {
      values.push(col - 2 * row)
    }
  }
  return values
}

/**
 * A real-component slice on `plane`, with the frame taken from the contract's
 * own frozen table rather than written out here -- the table is what the
 * renderer must honour, and a second copy of it in the spec would let both
 * drift together.
 */
function slicePayload(plane: PrincipalPlane): AnySlicePayload {
  const frame = PLANE_FRAMES[plane]
  return parseSlicePayload({
    layout: 'row_major_v_rows_u_columns',
    plane,
    slice_observable: 'wavefunction_real',
    resolution: RESOLUTION,
    extent_bohr: EXTENT_BOHR,
    spacing_bohr: SPACING_BOHR,
    origin_bohr: [0, 0, 0],
    u_axis: [...frame.u_axis],
    v_axis: [...frame.v_axis],
    normal: [...frame.normal],
    length_unit: 'bohr',
    value_unit: 'bohr^-3/2',
    masked_value_sentinel: 0,
    max_amplitude_on_plane: 0.31,
    metadata: { state: { n: 2, l: 1, m: 0, label: '2p_z' } },
    values: rampValues(),
    valid_mask: null,
    phase_mask_relative_amplitude: null,
    phase_mask_amplitude_scale: null,
    phase_mask_amplitude_threshold: null,
    phase_mask_numeric_floor: null,
    phase_masked_fraction: null,
  })
}

/* -------------------------------------------------------------- harness */

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

const mountSlice = async (data: AnySlicePayload): Promise<Renderer> =>
  ReactThreeTestRenderer.create(createElement(SliceField, { data }))

/**
 * Every three OBJECT under the scene, in tree order.
 *
 * `findAll` reaches attached instances (materials, geometries) as well, so this
 * keeps only what is actually in the scene graph -- by `isObject3D` rather than
 * `instanceof`, which is false across the test renderer's second copy of three.
 */
const objectsUnder = (renderer: Renderer): THREE.Object3D[] =>
  renderer.scene
    .findAll(() => true)
    .map((child) => child.instance)
    .filter((object) => (object as { isObject3D?: boolean }).isObject3D === true)

/** The one mesh this component draws. */
function meshOf(renderer: Renderer): THREE.Mesh {
  const meshes = objectsUnder(renderer).filter((object) => object.type === 'Mesh')
  expect(meshes).toHaveLength(1)
  return meshes[0] as THREE.Mesh
}

const materialOf = (renderer: Renderer): THREE.MeshBasicMaterial =>
  meshOf(renderer).material as THREE.MeshBasicMaterial

const textureOf = (renderer: Renderer): THREE.DataTexture =>
  materialOf(renderer).map as THREE.DataTexture

/* --------------------------------------------------- legend and canvas */

/**
 * The colour stops of one legend ramp, read out of the stylesheet the app
 * actually ships.
 *
 * Read rather than transcribed: styles.css says of these stops that they "are
 * the colours scene/sliceColor.ts computes, not colours picked to look
 * similar", and a second copy of them here would let the two drift together
 * while the claim went on being made.
 */
function rampStops(className: string): string[] {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf-8')
  const rule = new RegExp(`\\.${className}\\s*\\{[^}]*?linear-gradient\\(([^)]*)\\)`).exec(css)
  if (rule === null) {
    throw new Error(`styles.css has no .${className} rule with a linear-gradient.`)
  }
  return [...rule[1].matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].toLowerCase())
}

/**
 * The colour the RENDERER ends up putting on screen for one colour-map value,
 * given the colour space the texture declares it in.
 *
 * Expressed through three's own `ColorManagement` rather than through a
 * reimplemented transfer function, so this is the conversion the fragment
 * shader performs and not a second opinion about it: `setRGB(..., source)`
 * takes the value into the working space exactly as the texture fetch does,
 * and `getHexString(SRGBColorSpace)` takes it out again exactly as
 * `<colorspace_fragment>` does for a renderer whose `outputColorSpace` is sRGB
 * (OrbitalCanvas pins that). `NoColorSpace` means "no conversion", i.e. the
 * value is used as it stands in the working space, which is linear-sRGB.
 *
 * The round trip through bytes is `sliceTexture.ts`'s own quantisation: what
 * reaches the GPU is `Math.round(channel * 255)`, not the double.
 */
function onScreenHex(rgb: Readonly<Rgb>, textureColorSpace: string): string {
  const source =
    textureColorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  const [r, g, b] = rgb.map((channel) => Math.round(channel * 255) / 255)
  return `#${new THREE.Color().setRGB(r, g, b, source).getHexString(THREE.SRGBColorSpace)}`
}

/* ---------------------------------------------------------------- tests */

describe('SliceField', () => {
  it('draws the slice as one textured mesh, and nothing else', async () => {
    const renderer = await mountSlice(slicePayload('xz'))

    expect(objectsUnder(renderer).map((object) => object.type)).toEqual(['Mesh'])

    await renderer.unmount()
  })

  it('uploads the texeliser"s own bytes, at the payload"s resolution', async () => {
    const payload = slicePayload('xz')
    const renderer = await mountSlice(payload)
    const texture = textureOf(renderer)

    // The bytes are `sliceTexture.ts`'s business and are pinned there; what is
    // pinned HERE is that the component uploads those bytes rather than a
    // second, hand-rolled encoding of the same payload.
    expect(texture.image.width).toBe(RESOLUTION)
    expect(texture.image.height).toBe(RESOLUTION)
    expect(texture.image.data).toEqual(sliceTexels(payload))
    expect(texture.format).toBe(THREE.RGBAFormat)
    expect(texture.type).toBe(THREE.UnsignedByteType)
    // `needsUpdate` has no getter in three; the version counter is what it
    // moves, and an unuploaded texture would still be sitting at 0.
    expect(texture.version).toBeGreaterThan(0)

    await renderer.unmount()
  })

  it('states all four sampling and colour decisions on the texture explicitly', async () => {
    const renderer = await mountSlice(slicePayload('xz'))
    const texture = textureOf(renderer)

    // Read off a MOUNTED texture, not a freshly constructed one, and that is
    // the point of this test rather than an accident of the harness: r3f's
    // applyProps auto-tags any RGBA8 texture assigned to a `map` PROP with
    // SRGBColorSpace whenever the root is not `linear`, overwriting whatever
    // the module set -- measured, the declarative `<meshBasicMaterial
    // map={texture} />` spelling hands back a texture tagged "srgb" however it
    // was declared. Reading the tag off a mounted texture is what makes this
    // assertion about the colour space the RENDERER ends up using rather than
    // the one this module asked for.

    // The first three happen to be three@0.185.1's DataTexture defaults. They
    // are asserted -- and set -- anyway: a default is a fact about a
    // dependency's version, and each of these four is load-bearing physics. The
    // fourth is a departure from the default, not a restatement of it.
    // Interpolating a masked texel against an opaque one invents a phase where
    // the payload said there is none...
    expect(texture.magFilter).toBe(THREE.NearestFilter)
    expect(texture.minFilter).toBe(THREE.NearestFilter)
    // ...row 0 of the payload is v = -extent, which is where the plane's own
    // v axis starts, so flipping the image would mirror the slice about u...
    expect(texture.flipY).toBe(false)
    // ...and the texels are sRGB, because that is the space sliceColor.ts's own
    // arithmetic is defined in, so the renderer's decode and its output encode
    // cancel and the plane shows the colours the legend prints. The test below
    // measures that end of it; this line is here because the tag is also what
    // r3f would otherwise pick on the app's behalf, from the root's linear flag
    // rather than from anything about this colour map.
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)

    await renderer.unmount()
  })

  it('paints it with an unlit, unfogged, double-sided, alpha-cut material', async () => {
    const renderer = await mountSlice(slicePayload('xz'))
    const material = materialOf(renderer)

    expect(material.type).toBe('MeshBasicMaterial')
    expect(material.transparent).toBe(true)
    // Fog is atmosphere and a colormap is data. three's materials opt INTO fog
    // by default, and the canvas builds a scene fog scaled to the extent -- so
    // a quad that spans the whole extent, viewed from far enough back to frame
    // it, sits deep in that range and every texel is blended towards the fog
    // colour. Measured against the first CI bootstrap: the centre of the
    // 1s + 2p_z section came out at luminance 9.6, which is the fog colour
    // #050a13 exactly, i.e. the data contributed nothing at all. Nothing in
    // this repo could see that -- the texels are right, and every other
    // representation hugs the origin where the fog has barely started.
    expect(material.fog).toBe(false)
    // Masked texels carry alpha 0 and every other texel alpha 255, so a cut
    // anywhere in between discards exactly the masked ones and leaves no
    // blended edge tinting their neighbours.
    expect(material.alphaTest).toBe(0.5)
    // A slice is a section, not a surface: it has no inside, and it must read
    // from whichever side the orbit control leaves the camera on.
    expect(material.side).toBe(THREE.DoubleSide)
    // The legend's CSS ramp is not tone-mapped, and the renderer's exposure is
    // a photographic control. A colormap is data: pushing it through ACES
    // would make the same value read as a different colour at a different
    // exposure, and disagree with the legend beside it.
    expect(material.toneMapped).toBe(false)

    await renderer.unmount()
  })

  it('renders the very colours the legend beside it prints', async () => {
    const renderer = await mountSlice(slicePayload('xz'))
    const space = textureOf(renderer).colorSpace

    // The legend is not decoration: it is the key by which every number on the
    // plane is read, and the slice turns tone mapping off (see the material
    // test above) for the sole purpose of keeping these two the same colour.
    // What settles WHICH side is right is sliceColor.ts's own arithmetic:
    // sliceColor.test.ts feeds its output through the WCAG transfer function --
    // which is defined on sRGB-encoded channels -- and NEUTRAL_DEPTH is chosen
    // so the neutral lands "on #383838 ... about 1.7:1 against this scene's
    // background", a contrast ratio that only comes out at 1.69 if #383838 is
    // what a viewer actually sees. These are sRGB values by construction, so
    // the texture that carries them has to say so.
    expect(onScreenHex(SLICE_NEUTRAL_RGB, space)).toBe(rampStops('density-ramp')[0])
    expect(onScreenHex(sequentialRgb(0.5), space)).toBe(rampStops('density-ramp')[1])
    expect(onScreenHex(sequentialRgb(1), space)).toBe(rampStops('density-ramp')[2])

    expect(onScreenHex(divergingRgb(-1), space)).toBe(rampStops('diverging-ramp')[0])
    expect(onScreenHex(divergingRgb(0), space)).toBe(rampStops('diverging-ramp')[1])
    expect(onScreenHex(divergingRgb(1), space)).toBe(rampStops('diverging-ramp')[2])

    await renderer.unmount()
  })

  it('lands texel column 0 on -u and texel row 0 on -v, on the quad itself', async () => {
    const renderer = await mountSlice(slicePayload('xz'))
    const geometry = meshOf(renderer).geometry
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')

    // THE ONE LINK IN THE ORIENTATION CHAIN NOTHING ELSE PINS. The quaternion
    // test below fixes local +X onto u and local +Y onto v; `flipY = false`
    // fixes texel row 0 onto texture coordinate v = 0. What joins them is
    // `PlaneGeometry`'s own UV convention -- which corner of the quad carries
    // v = 0 -- and that is three's decision, not this repo's. Negate both of
    // these and the picture turns through 180 degrees: a winding still winds
    // the same way, a nodal line stays where it was, and every array-level
    // oracle in this repo still passes.
    for (let index = 0; index < position.count; index += 1) {
      expect(uv.getX(index)).toBe(position.getX(index) > 0 ? 1 : 0)
      expect(uv.getY(index)).toBe(position.getY(index) > 0 ? 1 : 0)
    }

    await renderer.unmount()
  })

  it('sizes the quad by the shared plane-size rule, not by 2 * extent', async () => {
    const payload = slicePayload('xz')
    const renderer = await mountSlice(payload)
    const geometry = meshOf(renderer).geometry as THREE.PlaneGeometry

    expect(geometry.type).toBe('PlaneGeometry')
    // `resolution * spacing`, one whole spacing MORE than the span of the
    // samples: a texel is a cell whose CENTRE lands on its sample node, so the
    // quad reaches half a spacing past the end samples at each edge.
    expect(geometry.parameters.width).toBeCloseTo(slicePlaneSize(payload), 12)
    expect(geometry.parameters.height).toBeCloseTo(slicePlaneSize(payload), 12)
    expect(slicePlaneSize(payload)).not.toBeCloseTo(2 * EXTENT_BOHR, 6)

    await renderer.unmount()
  })

  it('orients the quad onto the payload"s own frame, on every principal plane', async () => {
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      const payload = slicePayload(plane)
      const renderer = await mountSlice(payload)
      const mesh = meshOf(renderer)

      // A PlaneGeometry is built in its own xy-plane with +z out of it, so the
      // rotation is right exactly when it carries local +x onto u, +y onto v
      // and +z onto the normal. Asserted that way round rather than against a
      // second makeBasis call, which would agree just as happily with u and v
      // swapped -- the transposition that mirrors every asymmetric slice.
      const frame = PLANE_FRAMES[plane]
      for (const [local, expected] of [
        [new THREE.Vector3(1, 0, 0), frame.u_axis],
        [new THREE.Vector3(0, 1, 0), frame.v_axis],
        [new THREE.Vector3(0, 0, 1), frame.normal],
      ] as const) {
        const rotated = local.clone().applyQuaternion(mesh.quaternion)
        expect(rotated.x).toBeCloseTo(expected[0], 12)
        expect(rotated.y).toBeCloseTo(expected[1], 12)
        expect(rotated.z).toBeCloseTo(expected[2], 12)
      }

      // The contract pins the origin at [0, 0, 0], and the quad is centred on
      // it: a section that drifted off the nucleus would be a section of some
      // other plane.
      expect(mesh.position.length()).toBeCloseTo(0, 12)

      await renderer.unmount()
    }
  })

  it('leaves no GPU resource behind when it goes', async () => {
    const renderer = await mountSlice(slicePayload('yz'))
    const texture = textureOf(renderer)
    const geometry = meshOf(renderer).geometry
    const material = materialOf(renderer)
    const disposeTexture = vi.spyOn(texture, 'dispose')
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')

    await renderer.unmount()

    // A slice at 513 is a megabyte of texels and a vertex buffer per scene;
    // leaving them attached to the context is a leak that grows with every
    // plane the user tries. The material is on this list because this
    // component OWNS it -- r3f disposes the materials it constructs from JSX,
    // and disposes nothing it was merely handed.
    expect(disposeTexture).toHaveBeenCalledTimes(1)
    expect(disposeGeometry).toHaveBeenCalledTimes(1)
    expect(disposeMaterial).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the texture when a new payload arrives, and drops the old one', async () => {
    const renderer = await mountSlice(slicePayload('xz'))
    const first = textureOf(renderer)
    const disposeFirst = vi.spyOn(first, 'dispose')

    await renderer.update(createElement(SliceField, { data: slicePayload('yz') }))

    // A playback frame is a different payload on the same component. If the
    // texture were built once and kept, every later instant of a superposition
    // would be drawn with the first instant's bytes.
    expect(textureOf(renderer)).not.toBe(first)
    expect(disposeFirst).toHaveBeenCalledTimes(1)

    await renderer.unmount()
  })
})
