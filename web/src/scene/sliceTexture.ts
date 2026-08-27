/**
 * A validated slice payload turned into texture bytes and into the geometry
 * those bytes are painted on.
 *
 * Deliberately three.js-free. Everything here is plain numbers and tuples, so
 * it runs under the plain-`node` vitest environment with no WebGL and no
 * renderer, and the component that owns the `DataTexture` and the `planeGeometry`
 * has nothing left in it worth testing except the wiring. That split is not
 * cosmetic: the two mistakes this module exists to prevent -- a transposed
 * sample order and a half-texel-narrow plane -- are both invisible in a
 * screenshot of a smooth, symmetric orbital, so they have to be pinned
 * arithmetically or not at all.
 *
 * Four decisions are stated here because none of them is recoverable from the
 * types:
 *
 * **Every sample is read through `sliceValueAt`.** Not once is `values[k]`
 * written below. `k = row * resolution + col` appears exactly once in the
 * client, in `src/api/sliceContract.ts`, and a masked sample reads as `null`
 * there rather than as the sentinel it literally holds. Writing the arithmetic
 * out here would duplicate both the layout and the mask rule, and duplicating
 * the mask rule is how the sentinel `0.0` -- which is also a perfectly good
 * phase -- gets painted as a definite colour.
 *
 * **Alpha means "there is no datum here", never "the datum is small".** Masked
 * texels are `[0, 0, 0, 0]`; everything else is opaque, down to a value a
 * billionth of the peak. A p orbital's nodal plane is a region of vanishing
 * amplitude that is *known* to vanish -- it is the physically interesting part
 * of the picture -- and fading it toward the background would make it
 * indistinguishable from the region where the phase could not be resolved. The
 * colour maps already say "near zero" with the dark neutral; alpha is reserved
 * for the other statement.
 *
 * **A signed slice is normalised by its own extreme, recomputed here.** NOT by
 * `max_amplitude_on_plane`, which is `max|psi|` -- for a real or imaginary
 * component, `|Re psi| <= |psi|` pointwise, with equality only where the other
 * component vanishes. Normalising a component by `max|psi|` therefore
 * under-saturates it by an amount that varies with the state, silently, with no
 * error anywhere: the picture is merely washed out, and washed out is
 * indistinguishable from "this orbital has low contrast".
 *
 * **A density is mapped through a square root.** `rho = |psi|^2`, so
 * `sqrt(rho / rho_max)` is `|psi| / max|psi|` and the ramp is linear in
 * amplitude, which is the quantity every other view in this app -- the point
 * cloud, the isosurface, the phase wheel -- is keyed to. A linear-in-rho ramp
 * puts the half-amplitude contour at a quarter of the way up the map and makes
 * the same orbital look tighter here than it does there.
 */
import type { AnySlicePayload } from '../api/sliceContract'
import { sliceValueAt } from '../api/sliceContract'
import type { Rgb } from './sliceColor'
import { divergingRgb, phaseRgb, sequentialRgb } from './sliceColor'

/** A point in Bohr, in the scene's own coordinates. */
export type Vec3 = [number, number, number]

/** Channels per texel: RGBA8, the format the mask needs an alpha channel for. */
const CHANNELS = 4

/** 8-bit quantisation. `Uint8ClampedArray` clamps; this fixes the rounding. */
function toByte(channel: number): number {
  return Math.round(channel * 255)
}

/**
 * `max|value|` over the unmasked samples of the slice.
 *
 * The normalisation constant for the signed maps, and the `rho_max` of the
 * density map. Recomputed rather than read off the payload for the reason in
 * the module docstring, and computed through `sliceValueAt` so that a masked
 * sample contributes nothing -- the sentinel it holds is a placeholder, and a
 * payload is entitled to choose a placeholder larger than any real datum.
 *
 * Returns 0 for a slice with no unmasked samples, which the callers below turn
 * into a uniform neutral rather than into a division by zero.
 */
export function sliceMaxAbs(payload: AnySlicePayload): number {
  const { resolution } = payload
  let extreme = 0
  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < resolution; col += 1) {
      const value = sliceValueAt(payload, row, col)
      if (value !== null) {
        extreme = Math.max(extreme, Math.abs(value))
      }
    }
  }
  return extreme
}

/**
 * The colour map for this payload's observable, with its normalisation already
 * bound.
 *
 * Chosen once per slice rather than per sample: the normalisation is a property
 * of the whole plane, and computing it inside the loop would be one `O(R^2)`
 * scan per texel. The `switch` is exhaustive over `SliceObservable` and throws
 * on anything else instead of falling through to a default map -- a fifth
 * observable added to the contract must be given a map here, not painted as a
 * signed field and shipped.
 */
function colorMapFor(payload: AnySlicePayload): (value: number) => Rgb {
  const observable = payload.slice_observable
  switch (observable) {
    case 'phase':
      // Absolute: a phase is an angle, not a magnitude, and normalising it by
      // anything on the plane would make the same physical phase render
      // differently depending on its neighbours.
      return phaseRgb
    case 'probability_density': {
      const rhoMax = sliceMaxAbs(payload)
      return (value) => sequentialRgb(rhoMax > 0 ? Math.sqrt(value / rhoMax) : 0)
    }
    case 'wavefunction_real':
    case 'wavefunction_imag': {
      const extreme = sliceMaxAbs(payload)
      return (value) => divergingRgb(extreme > 0 ? value / extreme : 0)
    }
    default:
      throw new Error(
        `sliceTexels: no colour map for slice_observable ${String(observable)}. An observable ` +
          'without a map is a missing decision, not a default colour.',
      )
  }
}

/**
 * The RGBA8 texels of a slice, row-major with `col` fastest: sample
 * `(row, col)` occupies bytes `4 * (row * resolution + col)` and the three
 * after it.
 *
 * That is the payload's declared layout (`row_major_v_rows_u_columns`, `row`
 * indexing `v` and `col` indexing `u`) carried straight into the texture, so a
 * `DataTexture` of width and height `resolution` reproduces the plane without a
 * flip. Transposing it here is undetectable on any symmetric slice and mirrors
 * every other one.
 */
export function sliceTexels(payload: AnySlicePayload): Uint8ClampedArray {
  const { resolution } = payload
  const colorOf = colorMapFor(payload)
  const texels = new Uint8ClampedArray(CHANNELS * resolution * resolution)
  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < resolution; col += 1) {
      const value = sliceValueAt(payload, row, col)
      if (value === null) {
        // Left as the zeros the array was allocated with: transparent AND
        // black. Alpha alone would leave a colour to bleed into the neighbours
        // under filtering or premultiplied blending -- a colour standing for a
        // phase that is undefined there.
        continue
      }
      const base = CHANNELS * (row * resolution + col)
      const rgb = colorOf(value)
      texels[base] = toByte(rgb[0])
      texels[base + 1] = toByte(rgb[1])
      texels[base + 2] = toByte(rgb[2])
      texels[base + 3] = 255
    }
  }
  return texels
}

/**
 * The world-space edge length of the quad these texels belong on, in Bohr.
 *
 * `resolution * spacing`, which is one whole spacing MORE than the span of the
 * samples themselves. The samples are nodes at
 * `spacing * (i - (resolution - 1) / 2)`, spanning `[-extent, +extent]` =
 * `(resolution - 1) * spacing`; a texture's texels are cells, and a cell's
 * CENTRE is what must land on its node, so the quad reaches half a spacing
 * beyond the end samples at each edge.
 *
 * Sizing the quad to `2 * extent` instead -- the obvious reading of "the slice
 * spans the extent" -- shrinks the image by one texel and pulls every feature
 * half a texel toward the centre. On a smooth density that is invisible; on any
 * radius measured off the plane it is a systematic bias.
 */
export function slicePlaneSize(payload: AnySlicePayload): number {
  return payload.resolution * payload.spacing_bohr
}

/**
 * Where sample `(row, col)` sits in space, in Bohr.
 *
 * The payload's own frame, applied as stated: `origin + u_axis * u + v_axis * v`
 * with `col` indexing `u` and `row` indexing `v`. Reading the frame from the
 * payload rather than from a per-plane table here is what makes this the
 * round-trip of what the server sent -- the frozen table is
 * `src/api/sliceContract.ts`'s business, and it has already checked this
 * payload against it (including the `xz` plane's `-y` normal, which is what
 * keeps a phase winding's sign meaningful).
 *
 * Bounds are `sliceValueAt`'s to enforce, and it is called for exactly that:
 * an out-of-range index must fail here rather than silently return the origin.
 */
export function sliceSamplePosition(payload: AnySlicePayload, row: number, col: number): Vec3 {
  sliceValueAt(payload, row, col)
  const { spacing_bohr: spacing, resolution } = payload
  const centre = (resolution - 1) / 2
  const u = (col - centre) * spacing
  const v = (row - centre) * spacing
  const [ox, oy, oz] = payload.origin_bohr
  const [ux, uy, uz] = payload.u_axis
  const [vx, vy, vz] = payload.v_axis
  return [ox + ux * u + vx * v, oy + uy * u + vy * v, oz + uz * u + vz * v]
}
