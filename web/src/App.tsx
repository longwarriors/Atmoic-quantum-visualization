import { Atom, Eye, ListTree, PanelRightOpen, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SceneStatus } from './api/types'
import { ControlPanel, type ControlContext } from './components/ControlPanel'
import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { Legend } from './components/Legend'
import { LoadingOverlay } from './components/LoadingOverlay'
import { OrbitalCanvas } from './components/OrbitalCanvas'
import { representationLabel } from './components/sceneStatus'

/** A clock reading, always with its unit and always to the same precision. */
const timeText = (timeAu: number): string => `t=${timeAu.toFixed(1)} a.u.`

/** The breakpoint where the permanent analysis rail becomes an overlay. */
const COMPACT_WORKSPACE_QUERY = '(max-width: 1180px)'

function compactWorkspaceQuery(): MediaQueryList | null {
  if (typeof globalThis.matchMedia !== 'function') return null
  return globalThis.matchMedia(COMPACT_WORKSPACE_QUERY)
}

/**
 * Whether the analysis rail has become an on-demand overlay -- live.
 *
 * CSS decides the geometry at this breakpoint, but JavaScript owns whether the
 * overlay is open. Subscribing to the same query keeps those two facts aligned
 * when a window is resized or desktop zoom crosses the breakpoint; without it,
 * a rail that was open on a wide screen can become an invisible, still-focusable
 * overlay on the next layout.
 */
function useCompactWorkspace(): boolean {
  const [compact, setCompact] = useState(() => compactWorkspaceQuery()?.matches === true)

  useEffect(() => {
    const query = compactWorkspaceQuery()
    if (query === null) return undefined
    const onChange = (event: MediaQueryListEvent): void => setCompact(event.matches)
    query.addEventListener('change', onChange)
    setCompact(query.matches)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return compact
}

/**
 * What the status bar says, as one place rather than a nested ternary inside
 * the footer.
 *
 * The five cases are ordered by how much they invalidate: an error and a
 * standing refusal both mean the numbers elsewhere on screen are not about a
 * current frame, `loading` means there is no frame at all, and `refreshing`
 * means there IS one but it is the previous one. Only the last case may say
 * the asset is ready, because only there is the asset on screen the one that
 * was asked for.
 */
function statusLine(status: SceneStatus): { kind: string; text: string } {
  if (status.error !== undefined) {
    return { kind: 'error', text: `场景错误 · ${status.error}` }
  }
  if (status.unavailable !== undefined) {
    return {
      kind: 'unavailable',
      text: `${representationLabel(status.unavailable.kind)}暂不可用 · ${status.unavailable.reason}`,
    }
  }
  if (status.loading) {
    return { kind: 'loading', text: '正在计算' }
  }
  if (status.refreshing === true) {
    // Both times, always. Reporting only the requested one labels the frame on
    // screen with a moment it does not show; reporting only the rendered one
    // hides that a newer moment is on its way. The rendered time can be absent
    // (a frame that arrived before the clock existed), and saying so is better
    // than printing a number we do not have.
    const showing =
      status.renderedTimeAu !== undefined
        ? `正在显示 ${timeText(status.renderedTimeAu)}`
        : '正在显示上一帧'
    const computing =
      status.timeAu !== undefined ? `正在计算 ${timeText(status.timeAu)}` : '正在计算下一帧'
    return { kind: 'refreshing', text: `${showing} · ${computing}` }
  }
  return { kind: 'ready', text: '科学资产已就绪' }
}

/**
 * The footer line. Exported so its five cases can be driven directly: reaching
 * them through the whole shell would need a canvas, and the branch that matters
 * most (`refreshing`) only ever occurs mid-flight.
 */
export function StatusBar({ status }: { status: SceneStatus }) {
  const { kind, text } = statusLine(status)
  return (
    <footer className="statusbar">
      <span data-status={kind}>
        <i className={kind === 'ready' ? 'status-dot' : `status-dot ${kind}`} /> {text}
      </span>
      <span>QVPC/1 · Float32 · WebGL 2</span>
      <span>QuViz 0.1.0</span>
    </footer>
  )
}

export default function App() {
  const compactWorkspace = useCompactWorkspace()
  const [status, setStatus] = useState<SceneStatus>({ loading: true })
  const [controlContext, setControlContext] = useState<ControlContext>('state')
  // The wide rail is useful on first load; a compact overlay must wait for an
  // explicit request so it does not cover the canvas merely because it exists.
  const [inspectorOpen, setInspectorOpen] = useState(() => !compactWorkspace)
  const [mobileSurface, setMobileSurface] = useState<'controls' | 'inspector' | null>('controls')
  const inspectorOpenerRef = useRef<HTMLButtonElement | null>(null)
  const stageInspectorOpenerRef = useRef<HTMLButtonElement | null>(null)
  const mobileInspectorOpenerRef = useRef<HTMLButtonElement | null>(null)
  const restoreInspectorFocusRef = useRef(false)
  const previousCompactWorkspaceRef = useRef(compactWorkspace)
  const handleStatus = useCallback((value: SceneStatus) => setStatus(value), [])

  const openControls = (context: ControlContext): void => {
    restoreInspectorFocusRef.current = false
    setInspectorOpen(false)
    setControlContext(context)
    setMobileSurface('controls')
  }

  const openInspector = (opener: HTMLButtonElement): void => {
    inspectorOpenerRef.current = opener
    restoreInspectorFocusRef.current = false
    setInspectorOpen(true)
    setMobileSurface('inspector')
  }

  const closeInspector = useCallback((): void => {
    restoreInspectorFocusRef.current = true
    setInspectorOpen(false)
    setMobileSurface((surface) => (surface === 'inspector' ? null : surface))
  }, [])

  useEffect(() => {
    const enteredCompactWorkspace = compactWorkspace && !previousCompactWorkspaceRef.current
    previousCompactWorkspaceRef.current = compactWorkspace
    if (!enteredCompactWorkspace) return

    // A permanent rail must not silently turn into a canvas-covering overlay
    // when a window narrows. Leave a visible opener and wait for intent.
    restoreInspectorFocusRef.current = false
    setInspectorOpen(false)
    setMobileSurface((surface) => (surface === 'inspector' ? null : surface))
  }, [compactWorkspace])

  useEffect(() => {
    if (inspectorOpen || !restoreInspectorFocusRef.current) return
    restoreInspectorFocusRef.current = false

    const isRendered = (element: HTMLElement | null): element is HTMLElement => {
      if (element === null || !element.isConnected) return false
      for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || node.inert) return false
      }
      return true
    }
    const opener = [
      inspectorOpenerRef.current,
      stageInspectorOpenerRef.current,
      mobileInspectorOpenerRef.current,
    ].find(isRendered)
    opener?.focus()
  }, [inspectorOpen])

  useEffect(() => {
    if (!inspectorOpen) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeInspector()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeInspector, inspectorOpen])

  return (
    <div className="app-shell">
      <Header stateLabel={status.metadata?.label ?? status.superposition?.label} />
      <main className="workspace" data-inspector-open={inspectorOpen}>
        <ControlPanel
          activeContext={controlContext}
          onContextChange={setControlContext}
          mobileOpen={mobileSurface === 'controls'}
          onRequestClose={() => setMobileSurface(null)}
        />
        <section className="viewport-card" aria-label="量子态三维视口">
          <div className="viewport-copy">
            <span className="viewport-signal"><i />实时量子场</span>
            <h1>氢样量子态</h1>
            <p>拖动旋转 · 滚轮缩放 · 色彩表示 arg ψ，不表示电荷</p>
          </div>
          <OrbitalCanvas onStatus={handleStatus} />
          <Legend status={status} />
          <button
            type="button"
            className="stage-inspector-toggle"
            ref={stageInspectorOpenerRef}
            data-inspector-visible={inspectorOpen}
            onClick={(event) => openInspector(event.currentTarget)}
            aria-controls="science-inspector"
            aria-expanded={inspectorOpen}
            aria-label="打开科学详情"
            title="打开科学详情"
          >
            <PanelRightOpen size={18} />
            <span>科学详情</span>
          </button>
          {/*
            Keyed to `loading` alone, deliberately. `refreshing` means a frame
            is still on screen and still true; covering it with "Computing
            quantum scene" would throw away the keep-last-frame behaviour the
            fetch layer exists to provide. The status bar is what says a newer
            frame is on its way.
          */}
          <LoadingOverlay visible={status.loading} />
          <div className="corner-mark top-left" />
          <div className="corner-mark bottom-right" />
        </section>
        <Inspector
          status={status}
          open={inspectorOpen}
          mobileOpen={inspectorOpen && mobileSurface === 'inspector'}
          onClose={closeInspector}
        />
      </main>
      <nav className="mobile-actionbar" aria-label="移动端工作区">
        <button
          type="button"
          className={mobileSurface === 'controls' && controlContext === 'state' ? 'active' : ''}
          aria-pressed={mobileSurface === 'controls' && controlContext === 'state'}
          onClick={() => openControls('state')}
        >
          <Atom size={20} />
          <span>态</span>
        </button>
        <button
          type="button"
          className={
            mobileSurface === 'controls' && controlContext === 'representation' ? 'active' : ''
          }
          aria-pressed={mobileSurface === 'controls' && controlContext === 'representation'}
          onClick={() => openControls('representation')}
        >
          <SlidersHorizontal size={20} />
          <span>参数</span>
        </button>
        <button
          type="button"
          className={mobileSurface === 'controls' && controlContext === 'display' ? 'active' : ''}
          aria-pressed={mobileSurface === 'controls' && controlContext === 'display'}
          onClick={() => openControls('display')}
        >
          <Eye size={20} />
          <span>显示</span>
        </button>
        <button
          type="button"
          ref={mobileInspectorOpenerRef}
          className={inspectorOpen && mobileSurface === 'inspector' ? 'active' : ''}
          aria-pressed={inspectorOpen && mobileSurface === 'inspector'}
          aria-controls="science-inspector"
          aria-expanded={inspectorOpen && mobileSurface === 'inspector'}
          onClick={(event) => openInspector(event.currentTarget)}
        >
          <ListTree size={20} />
          <span>详情</span>
        </button>
      </nav>
      <StatusBar status={status} />
    </div>
  )
}
