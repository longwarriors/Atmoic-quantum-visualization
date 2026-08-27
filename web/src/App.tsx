import { useCallback, useState } from 'react'

import type { SceneStatus } from './api/types'
import { ControlPanel } from './components/ControlPanel'
import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { Legend } from './components/Legend'
import { LoadingOverlay } from './components/LoadingOverlay'
import { OrbitalCanvas } from './components/OrbitalCanvas'

/** A clock reading, always with its unit and always to the same precision. */
const timeText = (timeAu: number): string => `t=${timeAu.toFixed(1)} a.u.`

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
    return { kind: 'error', text: `scene error · ${status.error}` }
  }
  if (status.unavailable !== undefined) {
    return {
      kind: 'unavailable',
      text: `${status.unavailable.kind} unavailable · ${status.unavailable.reason}`,
    }
  }
  if (status.loading) {
    return { kind: 'loading', text: 'computing' }
  }
  if (status.refreshing === true) {
    // Both times, always. Reporting only the requested one labels the frame on
    // screen with a moment it does not show; reporting only the rendered one
    // hides that a newer moment is on its way. The rendered time can be absent
    // (a frame that arrived before the clock existed), and saying so is better
    // than printing a number we do not have.
    const showing =
      status.renderedTimeAu !== undefined
        ? `showing ${timeText(status.renderedTimeAu)}`
        : 'showing the previous frame'
    const computing =
      status.timeAu !== undefined ? `computing ${timeText(status.timeAu)}` : 'computing the next'
    return { kind: 'refreshing', text: `${showing} · ${computing}` }
  }
  return { kind: 'ready', text: 'scientific asset ready' }
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
  const [status, setStatus] = useState<SceneStatus>({ loading: true })
  const handleStatus = useCallback((value: SceneStatus) => setStatus(value), [])

  return (
    <div className="app-shell">
      <Header />
      <main className="workspace">
        <ControlPanel />
        <section className="viewport-card">
          <div className="viewport-copy">
            <span className="eyebrow">LIVE QUANTUM FIELD</span>
            <h1>Hydrogenic state explorer</h1>
            <p>Drag to orbit · scroll to zoom · phase is color, not charge</p>
          </div>
          <OrbitalCanvas onStatus={handleStatus} />
          <Legend status={status} />
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
        <Inspector status={status} />
      </main>
      <StatusBar status={status} />
    </div>
  )
}
