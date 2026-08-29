/** @vitest-environment jsdom */
import { act, createElement, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  ControlPanel: ({
    activeContext,
    mobileOpen,
    onRequestClose,
  }: {
    activeContext?: string
    mobileOpen?: boolean
    onRequestClose?: () => void
  }) =>
    createElement(
      'section',
      {
        'data-mock-controls': true,
        'data-active-context': activeContext,
        'data-mobile-open': mobileOpen,
      },
      createElement(
        'button',
        { type: 'button', 'data-mock-close-controls': true, onClick: onRequestClose },
        'close controls',
      ),
    ),
}))

vi.mock('./components/Inspector', () => ({
  Inspector: ({
    open,
    mobileOpen,
    onClose,
  }: {
    open?: boolean
    mobileOpen?: boolean
    onClose?: () => void
  }) =>
    createElement(
      'aside',
      {
        'data-mock-inspector': true,
        'data-open': open,
        'data-mobile-open': mobileOpen,
      },
      createElement(
        'button',
        { type: 'button', 'data-mock-close-inspector': true, onClick: onClose },
        'close inspector',
      ),
    ),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

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

async function interact(body: () => void): Promise<void> {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const had = 'IS_REACT_ACT_ENVIRONMENT' in scope
  const previous = scope.IS_REACT_ACT_ENVIRONMENT
  scope.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => body())
  } finally {
    if (had) {
      scope.IS_REACT_ACT_ENVIRONMENT = previous
    } else {
      delete scope.IS_REACT_ACT_ENVIRONMENT
    }
  }
}

async function press(button: HTMLButtonElement): Promise<void> {
  await interact(() => button.click())
}

interface CompactWorkspaceStub {
  readonly asked: string[]
  readonly listeners: ReadonlySet<(event: MediaQueryListEvent) => void>
  change(matches: boolean): Promise<void>
}

function stubCompactWorkspace(matches: boolean): CompactWorkspaceStub {
  const asked: string[] = []
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches,
    media: '(max-width: 1180px)',
    addEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
      listeners.add(listener)
    },
    removeEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
      listeners.delete(listener)
    },
  }
  vi.stubGlobal('matchMedia', (value: string) => {
    asked.push(value)
    return query
  })
  return {
    asked,
    listeners,
    async change(next: boolean): Promise<void> {
      query.matches = next
      await interact(() => {
        for (const listener of [...listeners]) {
          listener({ matches: next } as MediaQueryListEvent)
        }
      })
    },
  }
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
      expect(line(tree).textContent).toContain('正在显示 t=3.6 a.u.')
      expect(line(tree).textContent).toContain('正在计算 t=9.0 a.u.')
      // The unqualified ready text would present the OLD frame's diagnostics
      // as the current ones.
      expect(line(tree).textContent).not.toContain('科学资产已就绪')
    } finally {
      await tree.unmount()
    }
  })

  it('still says a stale frame is stale when it does not know the frame time', async () => {
    const tree = await statusBar({ loading: false, refreshing: true, timeAu: 9 })
    try {
      expect(line(tree).dataset.status).toBe('refreshing')
      expect(line(tree).textContent).toContain('正在计算 t=9.0 a.u.')
      expect(line(tree).textContent).not.toContain('科学资产已就绪')
    } finally {
      await tree.unmount()
    }
  })

  it('names the frame on screen even when the requested time is missing', async () => {
    const tree = await statusBar({ loading: false, refreshing: true, renderedTimeAu: 3.6 })
    try {
      expect(line(tree).dataset.status).toBe('refreshing')
      expect(line(tree).textContent).toContain('正在显示 t=3.6 a.u.')
      expect(line(tree).textContent).toContain('正在计算下一帧')
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
      expect(line(tree).textContent).toContain('电子云暂不可用')
      expect(line(tree).textContent).not.toContain('point_cloud 暂不可用')
      expect(line(tree).textContent).toContain(reason)
      expect(line(tree).textContent).not.toContain('场景错误')
      expect(line(tree).textContent).not.toContain('科学资产已就绪')
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
      expect(line(tree).textContent).toContain('正在计算')
    } finally {
      await tree.unmount()
    }
  })

  it('says the asset is ready only when it is the current one', async () => {
    const tree = await statusBar({ loading: false, renderedTimeAu: 12, pointCount: 28000 })
    try {
      expect(line(tree).dataset.status).toBe('ready')
      expect(line(tree).textContent).toContain('科学资产已就绪')
    } finally {
      await tree.unmount()
    }
  })
})

describe('App wires the canvas status to the shell', () => {
  it('routes the arrived stationary or superposition label into the compact header', async () => {
    const stationary = await shell({
      loading: false,
      metadata: {
        state: { n: 2, l: 1, m: 0, z: 1, a_mu: 1, basis: 'real' },
        label: '2p_z',
        energy_hartree: -0.125,
        length_unit: 'bohr',
        observable: 'probability_density',
        representation: 'point_cloud',
        normalization: 'integral(|psi|^2 dV)=1',
        coordinate_convention: 'theta=polar, phi=azimuth',
        spherical_harmonic_convention: 'Condon-Shortley',
        geometry_semantics: 'independent samples',
        color_semantics: 'wave-function phase',
        references: [],
        warnings: [],
      },
    })
    try {
      expect(stationary.container.querySelector('.topbar-context-compact')?.textContent).toBe('2p_z')
    } finally {
      await stationary.unmount()
    }

    const superposition = await shell({
      loading: false,
      superposition: {
        terms: [],
        label: '1s + 2p_z',
        basis: 'real',
        z: 1,
        a_mu: 1,
        reduced_mass_ratio: 1,
        time_au: 0,
        energy_expectation_hartree: -0.3125,
        is_stationary: false,
        length_unit: 'bohr',
        observable: 'probability_density',
        representation: 'point_cloud',
        normalization: 'integral(|psi|^2 dV)=1',
        coordinate_convention: 'theta=polar, phi=azimuth',
        spherical_harmonic_convention: 'Condon-Shortley',
        geometry_semantics: 'independent samples',
        color_semantics: 'wave-function phase',
        references: [],
        warnings: [],
      },
    })
    try {
      expect(superposition.container.querySelector('.topbar-context-compact')?.textContent).toBe(
        '1s + 2p_z',
      )
    } finally {
      await superposition.unmount()
    }
  })

  it('coordinates the mobile control sheet, detail sheet, and compact inspector trigger', async () => {
    const tree = await shell({ loading: false })
    try {
      const mobileButtons = Array.from(
        tree.container.querySelectorAll<HTMLButtonElement>('.mobile-actionbar button'),
      )
      expect(mobileButtons.map((button) => button.textContent)).toEqual(['态', '参数', '显示', '详情'])

      await press(mobileButtons[2])
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-controls]')?.dataset.activeContext,
      ).toBe('display')
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-controls]')?.dataset.mobileOpen,
      ).toBe('true')
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-inspector]')?.dataset.open,
      ).toBe('false')

      const controlsClose = tree.container.querySelector<HTMLButtonElement>(
        '[data-mock-close-controls]',
      )
      if (controlsClose === null) throw new Error('the mocked controls have no close action')
      await press(controlsClose)
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-controls]')?.dataset.mobileOpen,
      ).toBe('false')

      await press(mobileButtons[0])
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-controls]')?.dataset.activeContext,
      ).toBe('state')

      await press(mobileButtons[1])
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-controls]')?.dataset.activeContext,
      ).toBe('representation')

      await press(mobileButtons[3])
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-inspector]')?.dataset.mobileOpen,
      ).toBe('true')

      const inspectorClose = tree.container.querySelector<HTMLButtonElement>(
        '[data-mock-close-inspector]',
      )
      if (inspectorClose === null) throw new Error('the mocked inspector has no close action')
      await press(inspectorClose)
      expect(document.activeElement).toBe(mobileButtons[3])

      const stageOpener = tree.container.querySelector<HTMLButtonElement>('.stage-inspector-toggle')
      if (stageOpener === null) throw new Error('the stage has no inspector opener')
      await press(stageOpener)
      await interact(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-inspector]')?.dataset.open,
      ).toBe('false')
      expect(document.activeElement).toBe(stageOpener)

      // If responsive layout hides the original mobile opener before the
      // sheet closes, focus falls back to the now-visible stage action.
      await press(mobileButtons[3])
      const actionbar = tree.container.querySelector<HTMLElement>('.mobile-actionbar')
      if (actionbar === null) throw new Error('the mobile actionbar disappeared')
      actionbar.style.display = 'none'
      stageOpener.style.display = 'inline-flex'
      await press(inspectorClose)
      expect(document.activeElement).toBe(stageOpener)
    } finally {
      await tree.unmount()
    }
  })

  it('keeps the compact overlay state aligned with the live 1180px layout query', async () => {
    const workspace = stubCompactWorkspace(false)
    const tree = await shell({ loading: false })
    try {
      const shellNode = tree.container.querySelector<HTMLElement>('.workspace')
      expect(shellNode?.dataset.inspectorOpen).toBe('true')
      expect(workspace.asked).toContain('(max-width: 1180px)')
      expect(workspace.listeners.size).toBe(1)

      await workspace.change(true)
      expect(shellNode?.dataset.inspectorOpen).toBe('false')

      // Widening again must not override the explicit closed state. The same
      // visible stage action can reopen either a rail or an overlay.
      await workspace.change(false)
      expect(shellNode?.dataset.inspectorOpen).toBe('false')
    } finally {
      await tree.unmount()
    }
    expect(workspace.listeners.size).toBe(0)
  })

  it('starts a compact workspace with a reachable opener instead of a hidden overlay', async () => {
    stubCompactWorkspace(true)
    const tree = await shell({ loading: false })
    try {
      expect(tree.container.querySelector<HTMLElement>('.workspace')?.dataset.inspectorOpen).toBe(
        'false',
      )
      expect(
        tree.container.querySelector<HTMLElement>('[data-mock-inspector]')?.dataset.open,
      ).toBe('false')
      const opener = tree.container.querySelector<HTMLButtonElement>('.stage-inspector-toggle')
      if (opener === null) throw new Error('the compact workspace has no inspector opener')
      await press(opener)
      expect(tree.container.querySelector<HTMLElement>('.workspace')?.dataset.inspectorOpen).toBe(
        'true',
      )
    } finally {
      await tree.unmount()
    }
  })

  it('shows the loading overlay only while there is no frame to keep', async () => {
    const tree = await shell({ loading: true })
    try {
      expect(tree.container.querySelector('.loading-overlay')).not.toBeNull()
      expect(tree.container.querySelector('.viewport-copy')?.textContent).toContain('实时量子场')
      expect(tree.container.querySelector('.viewport-copy')?.textContent).toContain('氢样量子态')
      expect(tree.container.querySelector('.viewport-copy')?.textContent).toContain('arg ψ')
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
      expect(text).toContain('正在显示 t=3.6 a.u.')
      expect(text).toContain('正在计算 t=9.0 a.u.')
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
