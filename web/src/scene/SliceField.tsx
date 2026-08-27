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
 * The four texture settings below are each written out even though every one of
 * them is three@0.185.1's own `DataTexture` default. A default is a fact about
 * a dependency's version, not a decision this scene has made, and all four are
 * load-bearing: a minor upgrade that changed one would silently change the
 * physics the picture asserts, with no diff anywhere in this repo. Their
 * reasons are on the lines themselves.
 *
 * Two shapes here are dictated by react-three-fiber rather than by three, and
 * both were measured rather than guessed:
 *
 * **The material is an object, not a `<meshBasicMaterial>` child.** r3f's
 * `applyProps` auto-tags any RGBA8 texture assigned to a `map` prop with
 * `SRGBColorSpace` whenever the root is not `linear` (events-*.js: the
 * `colorMaps` list). That fires AFTER this module sets `NoColorSpace`, so the
 * declarative spelling silently produces a double-decoded colormap that no
 * longer matches the isosurface's vertex colours -- measured: the texture came
 * back tagged `"srgb"`. Owning the material keeps `map` out of r3f's reach, and
 * costs one more `dispose`.
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
    // The texels come out of `sliceColor.ts` in the same working space
    // `phaseToRgb` writes the isosurface's vertex colours in. Tagging them sRGB
    // would have the renderer decode them a second time, and one phase would
    // then be two different colours depending on the representation.
    value.colorSpace = THREE.NoColorSpace
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
