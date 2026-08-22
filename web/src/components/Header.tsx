import { BookOpen, Camera, Orbit } from 'lucide-react'

function saveScreenshot() {
  const canvas = document.querySelector('canvas')
  if (!(canvas instanceof HTMLCanvasElement)) return
  const link = document.createElement('a')
  link.download = `quviz-${new Date().toISOString().replaceAll(':', '-')}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function Header() {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Orbit size={22} /></span>
        <div>
          <div className="brand-name">QuViz</div>
          <div className="brand-subtitle">Quantum state · observable · representation</div>
        </div>
      </div>
      <div className="topbar-actions">
        <a className="icon-button" href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer" title="OpenAPI">
          <BookOpen size={17} />
          <span>API</span>
        </a>
        <button className="icon-button primary" type="button" onClick={saveScreenshot}>
          <Camera size={17} />
          <span>Capture</span>
        </button>
      </div>
    </header>
  )
}
