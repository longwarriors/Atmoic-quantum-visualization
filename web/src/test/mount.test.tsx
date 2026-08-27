/** @vitest-environment jsdom */
import { createElement, useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import { mount } from './mount'

/**
 * The whole PR-8A frontend suite rests on two facts about this helper: an
 * effect runs when a component is mounted, and its cleanup runs when the tree
 * is unmounted. A helper that renders but never flushes effects, or that
 * "unmounts" without tearing the tree down, would let every assertion built on
 * it pass while testing nothing -- so those two facts are asserted directly and
 * from the component's own point of view (an effect log), not from the DOM.
 *
 * Elements are built with `createElement` rather than JSX, as the rest of this
 * suite does: vitest.config.ts declares no React plugin, so esbuild transforms
 * JSX with the CLASSIC runtime (`React.createElement`) while tsconfig.app.json
 * declares the automatic one -- a spec written in JSX compiles but dies at run
 * time with "React is not defined" (measured).
 */
describe('mount', () => {
  it('runs a component effect on mount and its cleanup on unmount', async () => {
    const events: string[] = []

    function Probe() {
      useEffect(() => {
        events.push('effect')
        return () => {
          events.push('cleanup')
        }
      }, [])
      return createElement('p', null, 'mounted')
    }

    const mounted = await mount(createElement(Probe))
    expect(events).toEqual(['effect'])
    expect(mounted.container.textContent).toBe('mounted')
    expect(mounted.container.isConnected).toBe(true)

    await mounted.unmount()
    expect(events).toEqual(['effect', 'cleanup'])
    expect(mounted.container.isConnected).toBe(false)
  })

  it('re-renders on update and re-runs an effect whose dependency changed', async () => {
    const events: string[] = []

    function Probe({ label }: { label: string }) {
      useEffect(() => {
        events.push(`effect:${label}`)
        return () => {
          events.push(`cleanup:${label}`)
        }
      }, [label])
      return createElement('p', null, label)
    }

    const mounted = await mount(createElement(Probe, { label: 'a' }))
    expect(mounted.container.textContent).toBe('a')
    expect(events).toEqual(['effect:a'])

    await mounted.update(createElement(Probe, { label: 'b' }))
    expect(mounted.container.textContent).toBe('b')
    expect(events).toEqual(['effect:a', 'cleanup:a', 'effect:b'])

    await mounted.unmount()
    expect(events).toEqual(['effect:a', 'cleanup:a', 'effect:b', 'cleanup:b'])
  })

  it('leaves no act environment flag behind for the next spec', async () => {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    expect(scope.IS_REACT_ACT_ENVIRONMENT).toBeUndefined()

    const mounted = await mount(createElement('p', null, 'x'))
    await mounted.unmount()

    expect(scope.IS_REACT_ACT_ENVIRONMENT).toBeUndefined()
  })

  it('restores an act environment flag the caller had already set', async () => {
    // @react-three/test-renderer warns unless IS_REACT_ACT_ENVIRONMENT is set,
    // so a scene spec sets it around the whole case and then calls mount().
    // Deleting the flag on the way out would silently break that spec.
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    scope.IS_REACT_ACT_ENVIRONMENT = true
    try {
      const mounted = await mount(createElement('p', null, 'x'))
      expect(scope.IS_REACT_ACT_ENVIRONMENT).toBe(true)
      await mounted.unmount()
      expect(scope.IS_REACT_ACT_ENVIRONMENT).toBe(true)
    } finally {
      delete scope.IS_REACT_ACT_ENVIRONMENT
    }
  })

  it('tolerates a second unmount without touching the torn-down root', async () => {
    const events: string[] = []

    function Probe() {
      useEffect(
        () => () => {
          events.push('cleanup')
        },
        [],
      )
      return createElement('p', null, 'x')
    }

    const mounted = await mount(createElement(Probe))
    await mounted.unmount()
    await mounted.unmount()

    // React warns and re-runs nothing on a double root.unmount(); the guard
    // keeps the second call from reaching it at all.
    expect(events).toEqual(['cleanup'])
  })

  it('refuses an update after unmount instead of rendering into a dead root', async () => {
    const mounted = await mount(createElement('p', null, 'x'))
    await mounted.unmount()

    await expect(mounted.update(createElement('p', null, 'y'))).rejects.toThrow(
      'mount(): update() called after unmount()',
    )
  })
})
