/** @vitest-environment jsdom */
import { createElement, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import App, { StatusBar } from './App'
import type { SceneStatus } from './api/types'
import { mount, type MountedTree } from './test/mount'

/**
 * The status the mocked canvas will report. Hoisted because `vi.mock` factories
 * run before the module body, and mutable because each test drives the shell
 * with a different one.
 */
const reported = vi.hoisted(() => ({ current: { loading: true } as SceneStatus }))

// The real canvas wants WebGL. What this file measures is the SHELL: what the
// status bar says about a status, and which of the two overlays that status
// produces -- so the canvas is reduced to the one thing App uses it for, a
// source of `SceneStatus` values.
vi.mock('./components/OrbitalCanvas', () => ({
  OrbitalCanvas: ({ onStatus }: { onStatus: (status: SceneStatus) => void }) => {
    useEffect(() => {
      onStatus(reported.current)
    }, [onStatus])
    return null
  },
}))

vi.mock('./components/ControlPanel', () => ({
  ControlPanel: () => null,
}))

vi.mock('./components/Inspector', () => ({
  Inspector: () => null,
}))

async function statusBar(status: SceneStatus): Promise<MountedTree> {
  return mount(createElement(StatusBar, { status }))
}

function line(tree: MountedTree): HTMLElement {
  const node = tree.container.querySelector<HTMLElement>('[data-status]')
  if (node === null) throw new Error('the status bar reports no status at all')
  return node
}

async function shell(status: SceneStatus): Promise<MountedTree> {
  reported.current = status
  return mount(createElement(App))
}

describe('StatusBar says which frame the numbers describe', () => {
  it('names the rendered time AND the in-flight time while refreshing', async () => {
    const tree = await statusBar({
      loading: false,
      refreshing: true,
      renderedTimeAu: 3.6,
      timeAu: 9.0,
      triangleCount: 4096,
    })
    try {
      expect(line(tree).dataset.status).toBe('refreshing')
      expect(line(tree).textContent).toContain('showing t=3.6 a.u.')
      expect(line(tree).textContent).toContain('computing t=9.0 a.u.')
      // The unqualified ready text would present the OLD frame's diagnostics
      // as the current ones.
      expect(line(tree).textContent).not.toContain('scientific asset ready')
    } finally {
      await tree.unmount()
    }
  })

  it('still says a stale frame is stale when it does not know the frame time', async () => {
    const tree = await statusBar({ loading: false, refreshing: true, timeAu: 9 })
    try {
      expect(line(tree).dataset.status).toBe('refreshing')
      expect(line(tree).textContent).toContain('computing t=9.0 a.u.')
      expect(line(tree).textContent).not.toContain('scientific asset ready')
    } finally {
      await tree.unmount()
    }
  })

  it('names the frame on screen even when the requested time is missing', async () => {
    const tree = await statusBar({ loading: false, refreshing: true, renderedTimeAu: 3.6 })
    try {
      expect(line(tree).dataset.status).toBe('refreshing')
      expect(line(tree).textContent).toContain('showing t=3.6 a.u.')
      expect(line(tree).textContent).toContain('computing the next')
    } finally {
      await tree.unmount()
    }
  })

  it('reports a standing refusal with its kind and its reason, not as an error', async () => {
    const reason = 'No route samples a time-dependent state as a point cloud.'
    const tree = await statusBar({
      loading: false,
      unavailable: { kind: 'point_cloud', reason },
    })
    try {
      expect(line(tree).dataset.status).toBe('unavailable')
      expect(line(tree).textContent).toContain('point_cloud')
      expect(line(tree).textContent).toContain(reason)
      expect(line(tree).textContent).not.toContain('scene error')
      expect(line(tree).textContent).not.toContain('scientific asset ready')
    } finally {
      await tree.unmount()
    }
  })

  it('reports an error with the message, not just the word', async () => {
    const tree = await statusBar({ loading: false, error: 'HTTP 422 from /api/orbitals/isosurface' })
    try {
      expect(line(tree).dataset.status).toBe('error')
      expect(line(tree).textContent).toContain('HTTP 422 from /api/orbitals/isosurface')
    } finally {
      await tree.unmount()
    }
  })

  it('says computing while there is nothing on screen', async () => {
    const tree = await statusBar({ loading: true })
    try {
      expect(line(tree).dataset.status).toBe('loading')
      expect(line(tree).textContent).toContain('computing')
    } finally {
      await tree.unmount()
    }
  })

  it('says the asset is ready only when it is the current one', async () => {
    const tree = await statusBar({ loading: false, renderedTimeAu: 12, pointCount: 28000 })
    try {
      expect(line(tree).dataset.status).toBe('ready')
      expect(line(tree).textContent).toContain('scientific asset ready')
    } finally {
      await tree.unmount()
    }
  })
})

describe('App wires the canvas status to the shell', () => {
  it('shows the loading overlay only while there is no frame to keep', async () => {
    const tree = await shell({ loading: true })
    try {
      expect(tree.container.querySelector('.loading-overlay')).not.toBeNull()
    } finally {
      await tree.unmount()
    }
  })

  it('keeps the last frame visible while refreshing: no overlay, but both times', async () => {
    const tree = await shell({
      loading: false,
      refreshing: true,
      renderedTimeAu: 3.6,
      timeAu: 9.0,
    })
    try {
      expect(tree.container.querySelector('.loading-overlay')).toBeNull()
      const text = tree.container.querySelector('[data-status]')?.textContent ?? ''
      expect(text).toContain('showing t=3.6 a.u.')
      expect(text).toContain('computing t=9.0 a.u.')
    } finally {
      await tree.unmount()
    }
  })

  it('passes a standing refusal through to the shell', async () => {
    const reason = 'nothing implements this cell yet'
    const tree = await shell({ loading: false, unavailable: { kind: 'point_cloud', reason } })
    try {
      expect(tree.container.querySelector('.loading-overlay')).toBeNull()
      expect(tree.container.querySelector('[data-status]')?.textContent).toContain(reason)
      // And the legend must not draw a phase wheel over an empty viewport.
      expect(tree.container.querySelector('.legend')?.textContent).toContain(reason)
    } finally {
      await tree.unmount()
    }
  })
})
