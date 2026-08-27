/**
 * Depth fog for the scene, in scene units.
 *
 * Fog here is a depth cue, not an effect: it has to sit relative to the object
 * on screen, and the object's size changes by two orders of magnitude between a
 * 1s and a 6h orbital. So both distances are multiples of the scene extent
 * rather than fixed numbers, and the strength slider slides them inwards
 * together.
 */
export interface FogRange {
  /** Distance at which fog starts, in scene units. */
  near: number
  /** Distance at which fog is total. */
  far: number
}

/** Below this the fog would be tighter than the camera's own orbit distance. */
const MINIMUM_SCALE = 4
/** Stand-in extent before the first asset has arrived and measured the scene. */
const FALLBACK_EXTENT = 8

/**
 * The fog distances for a scene of this extent, or null for no fog at all.
 *
 * Null rather than a range pushed out to infinity: the caller clears
 * `scene.fog`, and "no fog" is a different statement from "fog you cannot
 * reach".
 */
export function fogRangeFor(extent: number | undefined, fogStrength: number): FogRange | null {
  if (fogStrength <= 0) {
    return null
  }
  const scale = Math.max(extent ?? FALLBACK_EXTENT, MINIMUM_SCALE)
  return {
    near: scale * (3.0 - 1.5 * fogStrength),
    far: scale * (8.0 - 4.0 * fogStrength),
  }
}
