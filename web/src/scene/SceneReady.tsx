/**
 * The scene's own statement that it has stopped moving.
 *
 * A screenshot comparison is a test only if both screenshots were taken at the
 * same moment of the same animation. Three things in this scene are still in
 * motion after React has finished committing: drei's `Bounds` runs an 0.8s
 * camera fit, `OrbitControls` damps for a while after it, and the payload
 * itself arrives over the network. A visual harness that waited on a fixed
 * timeout would therefore be choosing between two failures -- too short on a
 * loaded CI box, and every diff it produced would be a race rather than a
 * regression; long enough to be safe, and every real regression would be
 * hiding behind a sleep that also has to be paid on every green run.
 *
 * So the scene says when it is settled, in the one currency a browser harness
 * can read: an attribute on the element the canvas lives in.
 *
 * "Settled" is defined here, deliberately narrowly:
 *
 *   - the camera's WORLD matrix is unchanged from the previous frame, for
 *     `STILL_FRAMES_REQUIRED` consecutive frames. One frame is not enough --
 *     an easing curve passes through near-stationary points on its way, and
 *     `Bounds` uses one. The world matrix rather than `position` because a fit
 *     also changes what the camera is looking at, and a camera that is
 *     rotating while it holds its distance is still moving.
 *
 *   - `fitKey` is not null, i.e. an asset has actually arrived. The camera is
 *     perfectly still before the first payload lands; a flag raised then would
 *     be telling the harness to screenshot an empty scene.
 *
 * The flag's VALUE is that `fitKey`, not a bare "true", so a harness waiting
 * for a particular scene cannot be satisfied by the previous scene's leftover
 * flag. For the same reason it is cleared on the render that changes `fitKey`
 * rather than on the next frame: between those two there is a moment where the
 * new scene is on screen, unsettled, under the old scene's flag.
 *
 * ALWAYS ON, with no environment gate. A readiness signal that only exists in
 * a "test build" is a signal that is not being exercised by the application
 * anyone actually runs, and the first time it breaks will be the first time CI
 * is asked to trust it. It costs one matrix comparison per frame.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'

/** What the visual harness waits for. Exported so the harness can name it once. */
export const SCENE_READY_ATTRIBUTE = 'data-scene-ready'

/**
 * Consecutive unchanged frames before the scene counts as settled.
 *
 * Three, not one: `Bounds`' easing and `OrbitControls`' damping both approach
 * their target asymptotically, and a single frame whose movement rounds to
 * nothing happens well before the motion is over. Three consecutive is cheap
 * (50ms at 60Hz) and is not something an easing curve does on the way.
 */
export const STILL_FRAMES_REQUIRED = 3

/**
 * How equal two frames' camera matrices have to be.
 *
 * The matrices are recomputed from the same inputs every frame, so a genuinely
 * stationary camera reproduces them bit for bit and the honest comparison is
 * exact equality. It is not written that way because these are float32-backed
 * values recomputed through `compose`, and a rounding difference from a
 * different evaluation route would stall the flag forever with no diagnostic.
 * 1e-9 bohr is far below any movement a viewer could see and far above any
 * rounding.
 */
export const STILL_MATRIX_TOLERANCE = 1e-9

interface SceneReadyProps {
  /**
   * The identity of the asset on screen, or null while there is none. The same
   * value `useSceneAsset` gives the camera fit, so the flag and the fit are
   * talking about the same scene by construction.
   */
  fitKey: string | null
}

/**
 * Where the flag goes: the element the canvas sits in, or the canvas itself.
 *
 * r3f's `<Canvas>` nests its canvas inside a container div, and that is the
 * element the page lays out and the harness queries. A canvas with no parent
 * -- which is what the test renderer creates, and what a canvas mounted
 * detached would be -- still has to be flagged SOMEWHERE the harness can see:
 * doing nothing in that case would show up only as a wait that times out with
 * no explanation.
 */
export function sceneReadyTarget(canvas: HTMLCanvasElement): HTMLElement {
  return canvas.parentElement ?? canvas
}

function matricesAgree(current: ArrayLike<number>, previous: readonly number[]): boolean {
  for (let index = 0; index < previous.length; index += 1) {
    if (Math.abs(current[index] - previous[index]) > STILL_MATRIX_TOLERANCE) {
      return false
    }
  }
  return true
}

export function SceneReady({ fitKey }: SceneReadyProps) {
  const canvas = useThree((state) => state.gl.domElement)
  /** The previous frame's camera matrix, COPIED -- see the copy below. */
  const previous = useRef<number[] | null>(null)
  const stillFrames = useRef(0)
  /** The fitKey already flagged, so the attribute is written once per scene. */
  const flagged = useRef<string | null>(null)

  useLayoutEffect(() => {
    // A new scene is by definition not settled: everything counted so far was
    // counted about the previous one, including the camera position the fit is
    // about to move away from.
    previous.current = null
    stillFrames.current = 0
    flagged.current = null
    const target = sceneReadyTarget(canvas)
    // The cleanup, not the body, is what clears the attribute: it runs on the
    // render that changes `fitKey` (and on unmount), which is exactly the
    // "before any frame of the new scene" the harness needs.
    return () => {
      target.removeAttribute(SCENE_READY_ATTRIBUTE)
    }
  }, [canvas, fitKey])

  useFrame((state) => {
    const elements = state.camera.matrixWorld.elements
    const last = previous.current
    // Copied, never aliased: `matrixWorld.elements` is one array that three
    // mutates in place, so holding a reference to it would compare the frame
    // against itself and report every frame as still.
    previous.current = Array.from(elements)
    if (last === null || !matricesAgree(elements, last)) {
      stillFrames.current = 0
      return
    }
    stillFrames.current += 1
    if (stillFrames.current < STILL_FRAMES_REQUIRED) return
    if (fitKey === null || flagged.current === fitKey) return
    sceneReadyTarget(canvas).setAttribute(SCENE_READY_ATTRIBUTE, fitKey)
    flagged.current = fitKey
  })

  return null
}
