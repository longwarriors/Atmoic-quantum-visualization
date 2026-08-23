import { AlertTriangle, Box, Database, Gauge, Sigma } from 'lucide-react'

import type { SceneStatus } from '../api/types'

interface InspectorProps {
  status: SceneStatus
}

export function Inspector({ status }: InspectorProps) {
  const metadata = status.metadata
  const state = metadata?.state

  return (
    <aside className="panel inspector-panel">
      <span className="eyebrow">SCENE CONTRACT</span>
      <div className="state-title-row">
        <div>
          <h2>{metadata?.label ?? (status.loading ? 'Computing…' : 'No asset')}</h2>
          <p>
            {state ? `ψ(${state.n}, ${state.l}, ${state.m}) · ${state.basis} basis` : 'Awaiting verified metadata'}
          </p>
        </div>
        <span className="energy-pill">
          {metadata ? `${metadata.energy_hartree.toFixed(6)} Ha` : '—'}
        </span>
      </div>

      <div className="inspector-grid">
        <div className="metric-card">
          <Sigma size={15} />
          <span>Observable</span>
          <strong>{metadata?.observable ?? '—'}</strong>
        </div>
        <div className="metric-card">
          <Box size={15} />
          <span>Representation</span>
          <strong>{metadata?.representation ?? '—'}</strong>
        </div>
        <div className="metric-card">
          <Database size={15} />
          <span>Asset size</span>
          <strong>
            {status.pointCount !== undefined ? `${status.pointCount.toLocaleString()} pts` : null}
            {status.triangleCount !== undefined ? `${status.triangleCount.toLocaleString()} tris` : null}
            {status.pointCount === undefined && status.triangleCount === undefined ? '—' : null}
          </strong>
        </div>
        <div className="metric-card">
          <Gauge size={15} />
          <span>Extent</span>
          <strong>{Number.isFinite(status.extentBohr) ? `${status.extentBohr?.toFixed(2)} bohr` : '—'}</strong>
        </div>
      </div>

      <dl className="contract-list">
        <div><dt>Coordinates</dt><dd>{metadata?.coordinate_convention ?? '—'}</dd></div>
        <div><dt>Normalization</dt><dd>{metadata?.normalization ?? '—'}</dd></div>
        <div><dt>Length unit</dt><dd>{metadata?.length_unit ?? '—'}</dd></div>
        <div><dt>Geometry</dt><dd>{metadata?.geometry_semantics ?? '—'}</dd></div>
        <div><dt>Color</dt><dd>{metadata?.color_semantics ?? '—'}</dd></div>
        {status.radialMass !== undefined ? (
          <div><dt>Radial mass</dt><dd>{(status.radialMass * 100).toFixed(5)}%</dd></div>
        ) : null}
        {status.capturedProbabilityMass !== undefined ? (
          <div><dt>Superlevel mass</dt><dd>{(status.capturedProbabilityMass * 100).toFixed(3)}%</dd></div>
        ) : null}
        {status.finiteGridDensityIntegral !== undefined ? (
          <div><dt>Finite-grid ∫ρdV</dt><dd>{status.finiteGridDensityIntegral.toFixed(6)}</dd></div>
        ) : null}
        {status.gridResolution !== undefined ? (
          <div><dt>Grid</dt><dd>{status.gridResolution}³ · Δ={status.gridSpacingBohr?.toFixed(3)} bohr</dd></div>
        ) : null}
        {status.densityLevel !== undefined ? (
          <div><dt>Density level</dt><dd>{status.densityLevel.toExponential(3)}</dd></div>
        ) : null}
      </dl>

      {metadata?.references.length ? (
        <div className="reference-block">
          <span>Reference keys</span>
          {metadata.references.map((reference) => <code key={reference}>{reference}</code>)}
        </div>
      ) : null}

      {status.error ? (
        <div className="warning-card error"><AlertTriangle size={16} /><span>{status.error}</span></div>
      ) : null}
      {status.warnings?.map((warning) => (
        <div className="warning-card" key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>
      ))}
    </aside>
  )
}
