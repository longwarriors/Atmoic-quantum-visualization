/**
 * A slice payload, painted on the quad the payload's own frame describes.
 *
 * Every arithmetic decision this picture rests on -- which byte belongs to
 * which sample, how a value becomes a colour, how wide the quad has to be for a
 * texel's centre to land on its sample -- lives in `src/scene/sliceTexture.ts`
 * and is pinned there without a renderer. What is left here is the wiring that
 * genuinely needs three: a `DataTexture`, a `PlaneGeometry`, a rotation, and
 * the disposal of all three.
 *
 * Three of the four texture settings below -- the two filters and `flipY` --
 * are three@0.185.1's own `DataTexture` defaults, and are written out anyway. A
 * default is a fact about a dependency's version, not a decision this scene has
 * made, and each is load-bearing: a minor upgrade that changed one would
 * silently change the physics the picture asserts, with no diff anywhere in
 * this repo. The fourth, `colorSpace`, is a departure from the default rather
 * than a restatement of it. Their reasons are on the lines themselves.
 *
 * Two shapes here are dictated by react-three-fiber rather than by three, and
 * both were measured rather than guessed:
 *
 * **The material is an object, not a `<meshBasicMaterial>` child.** r3f's
 * `applyProps` auto-tags any RGBA8 texture assigned to a `map` prop with
 * `SRGBColorSpace` whenever the root is not `linear` (events-*.js: the
 * `colorMaps` list), overwriting whatever this module set -- measured: the
 * texture came back tagged `"srgb"` however it was declared here. That tag now
 * happens to be the one this colormap wants, which is exactly why the material
 * still has to be owned rather than declared: a colour space the renderer
 * picked from the root's linear flag is a coincidence, not a decision, and the
 * next person to read this file could not tell which it was. Owning the
 * material keeps `map` out of r3f's reach and costs one more `dispose`.
 *
 * **The rotation is handed over as an array.** r3f copies a value onto
 * `mesh.quaternion` only when `target.constructor === value.constructor`, and
 * three is loaded twice in this process (r3f's CJS bundle, this module's ESM
 * one), so a `Quaternion` instance fails that test, falls through to a plain
 * assignment, and throws on `Object3D`'s read-only `quaternion`. An array goes
 * through `fromArray` and is copy-safe across both.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { AnySlicePayload } from '../api/sliceContract'
import { slicePlaneSize, sliceTexels } from './sliceTexture'

interface SliceFieldProps {
  /** A payload that has already been through `parseSlicePayload`. */
  data: AnySlicePayload
}

/**
 * The alpha cut.
 *
 * `sliceTexels` writes alpha 0 for a masked sample and 255 for every other one,
 * so anything strictly between the two discards exactly the masked texels. Half
 * is the value furthest from both, which is what keeps it a statement about the
 * mask rather than a threshold on a colour.
 */
const MASK_ALPHA_TEST = 0.5

/** `[x, y, z, w]`, the order `THREE.Quaternion.fromArray` reads. */
export type QuaternionTuple = [number, number, number, number]

/**
 * The rotation that carries a plane geometry's own axes onto the payload's
 * frame.
 *
 * A `PlaneGeometry` is built in its local xy-plane with +z out of it, so a
 * basis matrix whose columns are (u, v, n) IS the map from local to world --
 * one expression, no per-plane special case, and no chance of the `xz` plane's
 * -y normal being "corrected" into a mirrored picture.
 *
 * Exported and returning a plain tuple so the arithmetic can be exercised
 * without a scene graph, and so the caller hands r3f something it can copy
 * across two loaded copies of three.
 */
export function sliceQuaternion(payload: AnySlicePayload): QuaternionTuple {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...payload.u_axis),
    new THREE.Vector3(...payload.v_axis),
    new THREE.Vector3(...payload.normal),
  )
  const { x, y, z, w } = new THREE.Quaternion().setFromRotationMatrix(basis)
  return [x, y, z, w]
}

export function SliceField({ data }: SliceFieldProps) {
  const texture = useMemo(() => {
    const value = new THREE.DataTexture(
      sliceTexels(data),
      data.resolution,
      data.resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    // Nearest, both ways: a masked texel is [0, 0, 0, 0], and bilinear
    // filtering would blend it with its opaque neighbours into a
    // partly-transparent texel whose RGB is a fraction of a real phase colour
    // -- inventing a phase exactly where the payload says there is none, and
    // smearing the alpha that was the statement "no datum here".
    value.magFilter = THREE.NearestFilter
    value.minFilter = THREE.NearestFilter
    // Row 0 is v = -extent, the start of the plane's own v axis, so the image
    // is already the right way up in the frame the quad is oriented onto;
    // flipping it would mirror the slice about u.
    value.flipY = false
    // sRGB, because that is what `sliceColor.ts` computes. Its constants are
    // chosen by arithmetic that is only defined on sRGB-encoded channels: the
    // ramp's monotone-luminance claim is checked in sliceColor.test.ts through
    // the WCAG transfer function, and NEUTRAL_DEPTH is set so the neutral lands
    // "on #383838 ... about 1.7:1 against this scene's background" -- a ratio
    // that comes out at 1.69 only if #383838 is the colour a viewer sees.
    // Declaring the texture NoColorSpace made the renderer read each byte as a
    // LINEAR value and then encode it on the way out, so the neutral reached the
    // screen at #818181 (measured) and the plane's dark baseline came up a light
    // grey that competed with the data it was supposed to sit behind.
    value.colorSpace = THREE.SRGBColorSpace
    // A DataTexture starts at version 0 and is never uploaded until this says
    // its pixels are real.
    value.needsUpdate = true
    return value
  }, [data])

  const geometry = useMemo(() => {
    const size = slicePlaneSize(data)
    return new THREE.PlaneGeometry(size, size)
  }, [data])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        // Unlit on purpose: this is a colormap, not a surface. A lit material
        // would multiply the data by a lighting term nobody can read off the
        // legend.
        transparent: true,
        alphaTest: MASK_ALPHA_TEST,
        // A section has no inside; the orbit control puts the camera on either
        // side of it and it must read from both.
        side: THREE.DoubleSide,
        // The legend's CSS ramp is not tone-mapped, and the renderer's exposure
        // is a photographic control. Pushing the colormap through ACES would
        // make the same value a different colour at a different exposure, and
        // disagree with the legend printed next to it.
        toneMapped: false,
        // And the same argument against the OTHER atmospheric control, which
        // three opts every material into by default. The scene's fog is a depth
        // cue scaled to the extent; this quad IS the extent, and the camera has
        // to stand far enough back to frame all of it, so the whole section
        // sits deep in the fog range -- far past its far distance once the
        // viewport is tall and narrow. Measured on the first CI bootstrap: the
        // centre of the 1s + 2p_z section rendered at luminance 9.6, which is
        // the fog colour #050a13 to the byte. A colormap is data; blending it
        // towards a colour that means "far away" makes the legend's colours
        // stop being the rendered ones, and the closer the picture is to
        // filling the frame, the less of it survives.
        fog: false,
      }),
    [texture],
  )

  const quaternion = useMemo(() => sliceQuaternion(data), [data])

  // Per resource, not per unmount: a playback frame replaces the payload, and
  // everything built for the previous instant has to go with it. At resolution
  // 513 that is a megabyte of texels per frame.
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} quaternion={quaternion} />
}
