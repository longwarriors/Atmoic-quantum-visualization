import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * Minimal mount / update / unmount harness for React 19 components under a DOM
 * environment (specs opt in per file with a first-line `@vitest-environment
 * jsdom` docblock; the vitest default environment stays `node`).
 *
 * This module is compiled by tsconfig.app.json along with the rest of `src`,
 * so it imports nothing from vitest and asserts nothing: it is a helper, and
 * what it does is pinned by src/test/mount.test.tsx.
 *
 * Every render goes through React's `act`, so effects and their cleanups have
 * run by the time the returned promise settles. Without that, a spec would
 * observe the DOM before `useEffect` ever fired and pass or fail on timing.
 */

/** The global flag React 19 requires before `act` will flush anything. */
interface ActScope {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

/**
 * Run `body` inside an act environment, restoring the previous flag afterwards.
 *
 * The flag is set per call rather than once at import time so that importing
 * this helper cannot change how an unrelated spec in the same worker behaves.
 */
async function inActEnvironment(body: () => void): Promise<void> {
  const scope = globalThis as ActScope
  const had = 'IS_REACT_ACT_ENVIRONMENT' in scope
  const previous = scope.IS_REACT_ACT_ENVIRONMENT
  scope.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      body()
    })
  } finally {
    if (had) {
      scope.IS_REACT_ACT_ENVIRONMENT = previous
    } else {
      delete scope.IS_REACT_ACT_ENVIRONMENT
    }
  }
}

/** A mounted React tree, with the handles a spec needs to drive it. */
export interface MountedTree {
  /** The detached-on-unmount host element the tree was rendered into. */
  readonly container: HTMLDivElement
  /** Re-render the tree with a new element; effects are flushed before return. */
  update(node: ReactNode): Promise<void>
  /** Unmount the tree (running every cleanup) and remove the container. */
  unmount(): Promise<void>
}

/**
 * Mount `node` into a fresh container appended to `document.body`.
 *
 * The container is appended rather than left detached because layout-reading
 * and portal-using components behave differently outside the document, and
 * because `container.isConnected` then tells a spec whether unmount happened.
 */
export async function mount(node: ReactNode): Promise<MountedTree> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  await inActEnvironment(() => {
    root.render(node)
  })

  let unmounted = false

  return {
    container,
    async update(next: ReactNode): Promise<void> {
      if (unmounted) {
        throw new Error('mount(): update() called after unmount()')
      }
      await inActEnvironment(() => {
        root.render(next)
      })
    },
    /**
     * Idempotent by React's own doing: a second `root.unmount()` is a no-op
     * that re-runs no cleanup, and `Element.remove()` on a detached node does
     * nothing. An `if (unmounted) return` guard here would be unobservable --
     * removing it changed no test (measured), which is why there isn't one.
     */
    async unmount(): Promise<void> {
      unmounted = true
      await inActEnvironment(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
