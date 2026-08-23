import { AlertTriangle, Box, Database, Gauge, Sigma } from 'lucide-react'

import type { SceneStatus } from '../api/types'

interface InspectorProps {
  status: SceneStatus
}

export function Inspector({ status }: InspectorProps) {
  const metadata = status.metadata
  const mixture = status.superposition
  const state = metadata?.state
  // An eigenstate and a superposition carry different metadata shapes on
  // purpose, but the contract panel must describe whichever one is on screen.
  const label = metadata?.label ?? mixture?.label
  const observable = metadata?.observable ?? mixture?.observable
  const representation = metadata?.representation ?? mixture?.representation
  const energy = metadata?.energy_hartree ?? mixture?.energy_expectation_hartree
  const subtitle = state
    ? `ψ(${state.n}, ${state.l}, ${state.m}) · ${state.basis} basis`
    : mixture
      ? `${mixture.terms.length}-term superposition · ${mixture.basis} basis`
      : 'Awaiting verified metadata'

  return (
    <aside className="panel inspector-panel">
      <span className="eyebrow">SCENE CONTRACT</span>
      <div className="state-title-row">
        <div>
          <h2>{label ?? (status.loading ? 'Computing…' : 'No asset')}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="energy-pill">
          {energy !== undefined ? `${energy.toFixed(6)} Ha` : '—'}
        </span>
      </div>

      <div className="inspector-grid">
        <div className="metric-card">
          <Sigma size={15} />
          <span>Observable</span>
          <strong>{observable ?? '—'}</strong>
        </div>
        <div className="metric-card">
          <Box size={15} />
          <span>Representation</span>
          <strong>{representation ?? '—'}</strong>
        </div>
        <div className="metric-card">
          <Database size={15} />
          <span>Asset size</span>
          <strong>
            {status.pointCount !== undefined ? `${status.pointCount.toLocaleString()} pts` : null}
            {status.triangleCount !== undefined ? `${status.triangleCount.toLocaleString()} tris` : null}
            {status.lineCount !== undefined ? `${status.lineCount.toLocaleString()} lines` : null}
            {status.pointCount === undefined &&
            status.triangleCount === undefined &&
            status.lineCount === undefined
              ? '—'
              : null}
          </strong>
        </div>
        <div className="metric-card">
          <Gauge size={15} />
          <span>Extent</span>
          <strong>{Number.isFinite(status.extentBohr) ? `${status.extentBohr?.toFixed(2)} bohr` : '—'}</strong>
        </div>
      </div>

      <dl className="contract-list">
        <div><dt>Coordinates</dt><dd>{metadata?.coordinate_convention ?? mixture?.coordinate_convention ?? '—'}</dd></div>
        <div><dt>Normalization</dt><dd>{metadata?.normalization ?? mixture?.normalization ?? '—'}</dd></div>
        <div><dt>Length unit</dt><dd>{metadata?.length_unit ?? mixture?.length_unit ?? '—'}</dd></div>
        <div><dt>Geometry</dt><dd>{metadata?.geometry_semantics ?? mixture?.geometry_semantics ?? '—'}</dd></div>
        <div><dt>Color</dt><dd>{metadata?.color_semantics ?? mixture?.color_semantics ?? '—'}</dd></div>
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
        {status.timeAu !== undefined ? (
          <div><dt>Time</dt><dd>{status.timeAu.toFixed(2)} a.u.</dd></div>
        ) : null}
        {status.superposition ? (
          <div>
            <dt>Coefficients</dt>
            <dd>
              {status.superposition.terms
                .map((term) => {
                  const magnitude = Math.hypot(term.coefficient_real, term.coefficient_imag)
                  return `${magnitude.toFixed(3)}|${term.n},${term.l},${term.m}⟩`
                })
                .join('  +  ')}
            </dd>
          </div>
        ) : null}
        {status.superposition ? (
          <div>
            <dt>⟨H⟩</dt>
            <dd>
              {status.superposition.energy_expectation_hartree.toFixed(6)} Ha
              {status.superposition.is_stationary ? ' · degenerate (static)' : ''}
            </dd>
          </div>
        ) : null}
        {status.lineCount !== undefined ? (
          <div><dt>Streamlines</dt><dd>{status.lineCount}</dd></div>
        ) : null}
        {status.maxSpeed !== undefined ? (
          <div><dt>Max |j|/ρ</dt><dd>{status.maxSpeed.toExponential(3)} a.u.</dd></div>
        ) : null}
        {status.continuityResidual !== undefined ? (
          <div><dt>∇·j residual</dt><dd>{status.continuityResidual.toExponential(2)}</dd></div>
        ) : null}
        {status.densityLevel !== undefined ? (
          <div><dt>Density level</dt><dd>{status.densityLevel.toExponential(3)}</dd></div>
        ) : null}
      </dl>

      {(metadata ?? mixture)?.references.length ? (
        <div className="reference-block">
          <span>Reference keys</span>
          {(metadata ?? mixture)!.references.map((reference) => (
            <code key={reference}>{reference}</code>
          ))}
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
