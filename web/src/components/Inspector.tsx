import { AlertTriangle, Box, Database, Gauge, Sigma } from 'lucide-react'

import type { SceneStatus } from '../api/types'
import { useSceneStore } from '../state/useSceneStore'

interface InspectorProps {
  status: SceneStatus
}

function orbitalName(n: number, l: number, m: number, basis: string): string {
  const letters = ['s', 'p', 'd', 'f', 'g', 'h', 'i']
  if (basis === 'real' && l === 1) return `${n}p${({ 1: 'ₓ', 0: '_z', [-1]: 'ᵧ' } as Record<number, string>)[m]}`
  if (basis === 'real' && l === 2) {
    const suffix = ({ 2: 'x²−y²', 1: 'xz', 0: 'z²', [-1]: 'yz', [-2]: 'xy' } as Record<number, string>)[m]
    return `${n}d(${suffix})`
  }
  return `${n}${letters[l] ?? `ℓ${l}`}, m=${m}`
}

export function Inspector({ status }: InspectorProps) {
  const { orbital, representation } = useSceneStore()
  const energy = -0.5 * orbital.z * orbital.z / (orbital.n * orbital.n)

  return (
    <aside className="panel inspector-panel">
      <span className="eyebrow">SCENE CONTRACT</span>
      <div className="state-title-row">
        <div>
          <h2>{orbitalName(orbital.n, orbital.l, orbital.m, orbital.basis)}</h2>
          <p>ψ<sub>{orbital.n}{orbital.l}{orbital.m}</sub> · {orbital.basis} basis</p>
        </div>
        <span className="energy-pill">{energy.toFixed(6)} Ha</span>
      </div>

      <div className="inspector-grid">
        <div className="metric-card">
          <Sigma size={15} />
          <span>Observable</span>
          <strong>|ψ|² + phase</strong>
        </div>
        <div className="metric-card">
          <Box size={15} />
          <span>Representation</span>
          <strong>{representation === 'point_cloud' ? 'Point cloud' : 'Isosurface'}</strong>
        </div>
        <div className="metric-card">
          <Database size={15} />
          <span>Asset size</span>
          <strong>
            {status.pointCount ? `${status.pointCount.toLocaleString()} pts` : null}
            {status.triangleCount ? `${status.triangleCount.toLocaleString()} tris` : null}
            {!status.pointCount && !status.triangleCount ? '—' : null}
          </strong>
        </div>
        <div className="metric-card">
          <Gauge size={15} />
          <span>Extent</span>
          <strong>{Number.isFinite(status.extentBohr) ? `${status.extentBohr?.toFixed(2)} a₀` : '—'}</strong>
        </div>
      </div>

      <dl className="contract-list">
        <div><dt>Coordinates</dt><dd>θ polar · φ azimuth</dd></div>
        <div><dt>Normalization</dt><dd>∫|ψ|²dV = 1</dd></div>
        <div><dt>Length unit</dt><dd>reduced Bohr radius</dd></div>
        <div><dt>Phase</dt><dd>{orbital.basis === 'real' ? '0 / π sign phase' : 'continuous [−π, π]'}</dd></div>
        {status.radialMass ? <div><dt>Radial mass</dt><dd>{(status.radialMass * 100).toFixed(5)}%</dd></div> : null}
        {status.densityLevel ? <div><dt>Density level</dt><dd>{status.densityLevel.toExponential(3)}</dd></div> : null}
      </dl>

      <div className="reference-block">
        <span>Reference keys</span>
        <code>dlmf-spherical-harmonics</code>
        <code>scipy-sph-harm-y</code>
      </div>

      {status.error ? (
        <div className="warning-card error"><AlertTriangle size={16} /><span>{status.error}</span></div>
      ) : null}
      {status.warnings?.map((warning) => (
        <div className="warning-card" key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>
      ))}
    </aside>
  )
}
