import { BookOpen, Camera, Crosshair, Orbit } from 'lucide-react'

import { useSceneStore } from '../state/useSceneStore'

function saveScreenshot() {
  const canvas = document.querySelector('canvas')
  if (!(canvas instanceof HTMLCanvasElement)) return
  const link = document.createElement('a')
  link.download = `quviz-${new Date().toISOString().replaceAll(':', '-')}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function Header({ stateLabel }: { stateLabel?: string }) {
  const mode = useSceneStore((state) => state.mode)
  const orbital = useSceneStore((state) => state.orbital)
  const superpositionLabel = useSceneStore((state) => state.superpositionLabel)
  const stateSummary =
    mode === 'eigenstate'
      ? `Eigenstate · n=${orbital.n}, ℓ=${orbital.l}, m=${orbital.m}, Z=${orbital.z}`
      : superpositionLabel
  const compactStateSummary =
    stateLabel ?? (mode === 'eigenstate' ? `n${orbital.n} · ℓ${orbital.l} · m${orbital.m}` : '叠加态')

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><Orbit size={23} strokeWidth={1.6} /></span>
        <div>
          <div className="brand-name">QuViz</div>
          <div className="brand-subtitle">量子态 · 可观测量 · 表示法</div>
        </div>
      </div>
      <div className="topbar-context" aria-label="当前量子态">
        <Crosshair size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="topbar-context-type">氢原子</span>
        <span className="topbar-context-divider">/</span>
        <span className="topbar-context-value">{stateSummary}</span>
        <span className="topbar-context-compact">{compactStateSummary}</span>
      </div>
      <div className="topbar-actions">
        <a className="icon-button" href="/docs" target="_blank" rel="noreferrer" title="查看 OpenAPI" aria-label="查看 OpenAPI">
          <BookOpen size={17} />
          <span>OpenAPI</span>
        </a>
        <button className="icon-button primary" type="button" onClick={saveScreenshot} title="保存当前画布" aria-label="保存当前画布">
          <Camera size={17} />
          <span>保存图像</span>
        </button>
      </div>
    </header>
  )
}
