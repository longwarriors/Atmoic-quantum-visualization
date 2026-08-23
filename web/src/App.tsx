import { useCallback, useState } from 'react'

import type { SceneStatus } from './api/types'
import { ControlPanel } from './components/ControlPanel'
import { Header } from './components/Header'
import { Inspector } from './components/Inspector'
import { Legend } from './components/Legend'
import { LoadingOverlay } from './components/LoadingOverlay'
import { OrbitalCanvas } from './components/OrbitalCanvas'

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
          <LoadingOverlay visible={status.loading} />
          <div className="corner-mark top-left" />
          <div className="corner-mark bottom-right" />
        </section>
        <Inspector status={status} />
      </main>
      <footer className="statusbar">
        <span><i className={status.error ? 'status-dot error' : status.loading ? 'status-dot loading' : 'status-dot'} /> {status.error ? 'scene error' : status.loading ? 'computing' : 'scientific asset ready'}</span>
        <span>QVPC/1 · Float32 · WebGL 2</span>
        <span>QuViz 0.1.0</span>
      </footer>
    </div>
  )
}
