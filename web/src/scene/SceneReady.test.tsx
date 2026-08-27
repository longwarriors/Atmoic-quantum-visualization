/** @vitest-environment jsdom */
/**
 * `SceneReady`: the one signal the visual CI is allowed to wait on.
 *
 * WHY THIS EXISTS AT ALL. A screenshot comparison is only a test if the two
 * screenshots were taken at the same moment of the same animation. This scene
 * has three things still moving after React has finished: drei's `Bounds` runs
 * an 0.8s camera fit, `OrbitControls` has damping, and the payload arrives over
 * the network. A fixed `waitForTimeout` in the harness would either be shorter
 * than that on a loaded CI box -- producing a diff that is really a race -- or
 * long enough to hide a genuine regression behind a sleep. So the SCENE says
 * when it has settled, and it says it in the only currency a browser harness
 * can read: an attribute in the DOM.
 *
 * WHAT "SETTLED" MEANS HERE, precisely, because the definition is the whole
 * value of the module: three CONSECUTIVE frames whose camera world matrix is
 * unchanged, and a `fitKey` that is not null. Not "the fetch resolved" (the fit
 * is still animating), not one still frame (an easing curve passes through
 * near-stationary points), and not a timer.
 *
 * WHAT IT DOES NOT CLAIM. That the picture is right, or that a pixel exists.
 * There is no GPU in this process. This file pins WHEN the flag is raised and
 * lowered; whether the frame under it looks correct is the screenshot's job.
 *
 * Harness facts this file depends on: specs cannot use JSX (vitest.config.ts
 * declares no React plugin, so esbuild compiles with the classic runtime and
 * JSX dies with "React is not defined"); `renderer.advanceFrames(n)` invokes
 * every `useFrame` subscriber n times WITHOUT rendering, so the spec updates
 * `camera.matrixWorld` itself where a real loop would have done it; and `jsdom`
 * rather than the default `node` environment because this component writes to a
 * real DOM element -- under `node` the test renderer's canvas is a plain object
 * with no `setAttribute` at all.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SCENE_READY_ATTRIBUTE, SceneReady, STILL_FRAMES_REQUIRED } from './SceneReady'

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

/* -------------------------------------------------------------- harness */

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

interface Scene {
  renderer: Renderer
  camera: THREE.PerspectiveCamera
  /** Where the flag is expected to land: the canvas's container, or the canvas. */
  target: HTMLElement
  /** Move the camera the way a fit animation or an orbit drag would. */
  moveCamera: (x: number, y: number, z: number) => void
  readyValue: () => string | null
  advance: (frames: number) => Promise<void>
}

/**
 * Mount `SceneReady` over a camera this spec owns.
 *
 * r3f keeps its camera OUT of the scene graph, so a spec that wants to move the
 * camera has to hand one in. `wrapped` decides whether the canvas gets a parent
 * element, which is the difference between the two targets the component has to
 * cope with: the real `<Canvas>` puts its canvas inside a container div, and the
 * test renderer's canvas is created detached.
 */
async function mountReady(fitKey: string | null, wrapped = true): Promise<Scene> {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500)
  camera.position.set(10, 6, 12)
  camera.updateMatrixWorld(true)

  let canvas: HTMLCanvasElement | null = null
  const renderer = await ReactThreeTestRenderer.create(
    createElement(SceneReady, { fitKey }),
    {
      camera,
      beforeReturn: (created: HTMLCanvasElement) => {
        canvas = created
        if (wrapped) {
          const container = document.createElement('div')
          document.body.appendChild(container)
          container.appendChild(created)
        }
      },
    },
  )
  const element = canvas as unknown as HTMLCanvasElement
  const target = (wrapped ? element.parentElement : element) as HTMLElement

  return {
    renderer,
    camera,
    target,
    moveCamera(x, y, z) {
      camera.position.set(x, y, z)
      // The real loop renders between frames, and `WebGLRenderer.render`
      // refreshes the camera's world matrix. `advanceFrames` renders nothing,
      // so the spec does the one thing the loop would have done.
      camera.updateMatrixWorld(true)
    },
    readyValue: () => target.getAttribute(SCENE_READY_ATTRIBUTE),
    advance: (frames) => renderer.advanceFrames(frames, 1 / 60),
  }
}

/**
 * The number of `advanceFrames` calls a scene that never moves needs before the
 * flag goes up.
 *
 * One more than the still-frame requirement: the first frame has nothing to
 * compare against, so it can only record the matrix. Spelled out rather than
 * hard-coded so that the arithmetic, not a magic 4, is what the cases below
 * assert.
 */
const FRAMES_TO_READY = STILL_FRAMES_REQUIRED + 1

/* ---------------------------------------------------------------- tests */

describe('SceneReady', () => {
  it('raises no flag before the camera has held still long enough', async () => {
    const scene = await mountReady('scene-a')

    expect(scene.readyValue()).toBeNull()
    await scene.advance(FRAMES_TO_READY - 1)

    // One frame short. A harness that screenshotted here would catch the fit
    // animation mid-flight, and the diff it produced would be a race, not a
    // regression.
    expect(scene.readyValue()).toBeNull()

    await scene.renderer.unmount()
  })

  it('raises it, carrying the fitKey of the scene it settled on', async () => {
    const scene = await mountReady('scene-a')

    await scene.advance(FRAMES_TO_READY)

    // The VALUE is the identity of the scene, not a bare "true": the harness
    // asks for the scene it requested, so a stale flag left over from the
    // previous scene cannot be mistaken for this one having settled.
    expect(scene.readyValue()).toBe('scene-a')

    await scene.renderer.unmount()
  })

  it('starts the count over the moment the camera moves again', async () => {
    const scene = await mountReady('scene-a')

    await scene.advance(FRAMES_TO_READY - 1)
    scene.moveCamera(0, 0, 30)
    await scene.advance(FRAMES_TO_READY - 1)

    // Damping and the 0.8s fit both produce long runs of small movements.
    // Frames that were still BEFORE a move say nothing about the frames after
    // it, so the run has to restart rather than accumulate.
    expect(scene.readyValue()).toBeNull()

    await scene.advance(1)
    expect(scene.readyValue()).toBe('scene-a')

    await scene.renderer.unmount()
  })

  it('says nothing at all while there is no scene to be ready for', async () => {
    const scene = await mountReady(null)

    await scene.advance(FRAMES_TO_READY * 3)

    // A null fitKey means no asset has arrived yet. The camera is perfectly
    // still at that point -- it is sitting at its initial position over an
    // empty scene -- and a flag raised here would tell the harness to
    // screenshot nothing.
    expect(scene.readyValue()).toBeNull()

    await scene.renderer.unmount()
  })

  it('lowers the flag the instant the scene changes, before any frame runs', async () => {
    const scene = await mountReady('scene-a')
    await scene.advance(FRAMES_TO_READY)
    expect(scene.readyValue()).toBe('scene-a')

    await scene.renderer.update(createElement(SceneReady, { fitKey: 'scene-b' }))

    // Not on the next frame: on the render that changed the scene. A harness
    // polling for `[data-scene-ready]` between the two would otherwise sample
    // the old scene's flag over the new scene's first, unsettled frame.
    expect(scene.readyValue()).toBeNull()

    await scene.advance(FRAMES_TO_READY)
    expect(scene.readyValue()).toBe('scene-b')

    await scene.renderer.unmount()
  })

  it('takes the flag with it when it unmounts', async () => {
    const scene = await mountReady('scene-a')
    await scene.advance(FRAMES_TO_READY)
    expect(scene.readyValue()).toBe('scene-a')

    await scene.renderer.unmount()

    expect(scene.readyValue()).toBeNull()
  })

  it('falls back to the canvas itself when it has no container', async () => {
    const scene = await mountReady('scene-a', false)

    await scene.advance(FRAMES_TO_READY)

    // The real `<Canvas>` nests its canvas in a container div and the flag
    // belongs there, on the element the page lays out. A detached canvas still
    // has to be flagged somewhere the harness can see rather than nowhere at
    // all -- silently doing nothing is the one behaviour that would make the
    // wait time out with no explanation.
    expect(scene.target.tagName.toLowerCase()).toBe('canvas')
    expect(scene.readyValue()).toBe('scene-a')

    await scene.renderer.unmount()
  })
})
