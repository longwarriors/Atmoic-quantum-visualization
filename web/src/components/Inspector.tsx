import { AlertTriangle, Box, Database, Gauge, Sigma } from 'lucide-react'

import type { SceneStatus } from '../api/types'

interface InspectorProps {
  status: SceneStatus
}

function formatCoefficient(value: number): string {
  if (value === 0) return '0.000'
  const magnitude = Math.abs(value)
  return magnitude < 0.001 || magnitude >= 1_000 ? value.toExponential(2) : value.toFixed(3)
}

function formatSuperpositionTerms(terms: NonNullable<SceneStatus['superposition']>['terms']): string {
  let label = ''
  for (const term of terms) {
    const ket = `|${term.n},${term.l},${term.m}⟩`
    if (term.coefficient_imag === 0) {
      const body = `${formatCoefficient(Math.abs(term.coefficient_real))}${ket}`
      if (!label) {
        label = term.coefficient_real < 0 ? `-${body}` : body
      } else {
        label += term.coefficient_real < 0 ? `  -  ${body}` : `  +  ${body}`
      }
      continue
    }

    const real = term.coefficient_real === 0 ? 0 : term.coefficient_real
    const imag = term.coefficient_imag === 0 ? 0 : term.coefficient_imag
    const imagSign = imag >= 0 ? '+' : '-'
    const body = `(${formatCoefficient(real)}${imagSign}${formatCoefficient(Math.abs(imag))}i)${ket}`
    label += label ? `  +  ${body}` : body
  }
  return label
}

function formatFiniteGridMassStatus(status: NonNullable<SceneStatus['finiteGridMassStatus']>): string {
  const labels: Record<NonNullable<SceneStatus['finiteGridMassStatus']>, string> = {
    phase_dependent_quadrature_error: 'phase-dependent quadrature error',
    time_invariant_quadrature_error: 'time-invariant quadrature error',
    quadrature_error_at_reported_time: 'quadrature error at reported time',
    no_error_above_tolerance_proven:
      'no above-threshold error demonstrated (accuracy not certified)',
  }
  return labels[status]
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
        {status.finiteGridMassStatus !== undefined ? (
          <div>
            <dt>Grid mass status</dt>
            <dd>{formatFiniteGridMassStatus(status.finiteGridMassStatus)}</dd>
          </div>
        ) : null}
        {status.finiteGridReportingTolerance !== undefined ? (
          <div>
            <dt>Grid report threshold</dt>
            <dd>{status.finiteGridReportingTolerance.toExponential(3)}</dd>
          </div>
        ) : null}
        {status.finiteGridMassErrorLowerBound !== undefined ? (
          <div>
            <dt>Grid mass error ≥</dt>
            <dd>{status.finiteGridMassErrorLowerBound.toExponential(3)}</dd>
          </div>
        ) : null}
        {status.finiteGridAliasingVariationLowerBound !== undefined ? (
          <div>
            <dt>Grid alias variation ≥</dt>
            <dd>{status.finiteGridAliasingVariationLowerBound.toExponential(3)}</dd>
          </div>
        ) : null}
        {status.finiteBoxMassVariationUpperBound !== undefined ? (
          <div>
            <dt>Finite-box variation ≤</dt>
            <dd>{status.finiteBoxMassVariationUpperBound.toExponential(3)}</dd>
          </div>
        ) : null}
        {status.timeAu !== undefined ? (
          <div><dt>Time</dt><dd>{status.timeAu.toFixed(2)} a.u.</dd></div>
        ) : null}
        {status.superposition ? (
          <div>
            <dt>Coefficients</dt>
            <dd>
              {formatSuperpositionTerms(status.superposition.terms)}
            </dd>
          </div>
        ) : null}
        {status.superposition ? (
          <div>
            <dt>⟨H⟩</dt>
            <dd>
              {status.superposition.energy_expectation_hartree.toFixed(6)} Ha
              {status.superposition.is_stationary ? ' · stationary density' : ''}
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
          <div><dt>Continuity residual</dt><dd>{status.continuityResidual.toExponential(2)}</dd></div>
        ) : null}
        {status.continuityScaleKind !== undefined ? (
          <div>
            <dt>Continuity scale</dt>
            <dd>{status.continuityScaleKind.replaceAll('_', ' ')}</dd>
          </div>
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
