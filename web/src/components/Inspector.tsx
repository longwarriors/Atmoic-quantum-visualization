import { AlertTriangle, Box, Database, Gauge, Sigma } from 'lucide-react'

import type { SceneStatus } from '../api/types'

interface InspectorProps {
  status: SceneStatus
}

/** What a non-finite (or absent) number is displayed as. Never "NaN"/"Infinity". */
const PLACEHOLDER = '—'

type NumericStyle =
  /** Fixed decimals, for numbers whose scale is known (energies, extents, times). */
  | { kind: 'fixed'; digits: number }
  /** Scientific notation, for residuals and bounds that span many decades. */
  | { kind: 'exponential'; digits: number }
  /**
   * Fixed decimals near unity, scientific notation outside [1e-3, 1e3): the
   * amplitude/coefficient style, so a retained tiny amplitude never reads as
   * an exact zero.
   */
  | { kind: 'magnitude'; digits: number }
  /** Whole counts, grouped for readability. */
  | { kind: 'count' }

/**
 * The one numeric formatter this panel uses.
 *
 * Every numeric cell goes through it so a non-finite value cannot reach the
 * screen as "NaN" or "Infinity" dressed up in units — a NaN energy rendered as
 * "NaN Ha" reads like a measurement, and an "Infinity" bound reads like a
 * proven one. Both are the absence of a number, and are shown as such. Routing
 * every site here also means the guard exists in exactly one place: weaken it
 * and every non-finite case in Inspector.test.tsx fails at once.
 */
function formatFinite(value: number | undefined, style: NumericStyle): string {
  if (value === undefined || !Number.isFinite(value)) return PLACEHOLDER
  switch (style.kind) {
    case 'fixed':
      return value.toFixed(style.digits)
    case 'exponential':
      return value.toExponential(style.digits)
    case 'count':
      return value.toLocaleString()
    case 'magnitude': {
      const magnitude = Math.abs(value)
      return magnitude !== 0 && (magnitude < 0.001 || magnitude >= 1_000)
        ? value.toExponential(style.digits - 1)
        : value.toFixed(style.digits)
    }
  }
}

/**
 * `formatFinite` plus a unit, dropped when there is no number: "— Ha" would
 * still assert that a hartree value was measured.
 */
function formatFiniteUnit(
  value: number | undefined,
  style: NumericStyle,
  unit: string,
  separator = ' ',
): string {
  const text = formatFinite(value, style)
  return text === PLACEHOLDER ? text : `${text}${separator}${unit}`
}

function formatSuperpositionTerms(terms: NonNullable<SceneStatus['superposition']>['terms']): string {
  let label = ''
  for (const term of terms) {
    const ket = `|${term.n},${term.l},${term.m}⟩`
    if (term.coefficient_imag === 0) {
      const body = `${formatFinite(Math.abs(term.coefficient_real), { kind: 'magnitude', digits: 3 })}${ket}`
      if (!label) {
        label = term.coefficient_real < 0 ? `-${body}` : body
      } else {
        label += term.coefficient_real < 0 ? `  -  ${body}` : `  +  ${body}`
      }
      continue
    }

    // -0 would print as "-0.000" and read as a signed amplitude; the imaginary
    // part is non-zero here by construction, so it needs no such guard.
    const real = term.coefficient_real === 0 ? 0 : term.coefficient_real
    const imag = term.coefficient_imag
    const imagSign = imag >= 0 ? '+' : '-'
    const realText = formatFinite(real, { kind: 'magnitude', digits: 3 })
    const imagText = formatFinite(Math.abs(imag), { kind: 'magnitude', digits: 3 })
    const body = `(${realText}${imagSign}${imagText}i)${ket}`
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
          {formatFiniteUnit(energy, { kind: 'fixed', digits: 6 }, 'Ha')}
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
            {status.pointCount !== undefined
              ? formatFiniteUnit(status.pointCount, { kind: 'count' }, 'pts')
              : null}
            {status.triangleCount !== undefined
              ? formatFiniteUnit(status.triangleCount, { kind: 'count' }, 'tris')
              : null}
            {status.lineCount !== undefined
              ? formatFiniteUnit(status.lineCount, { kind: 'count' }, 'lines')
              : null}
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
          <strong>{formatFiniteUnit(status.extentBohr, { kind: 'fixed', digits: 2 }, 'bohr')}</strong>
        </div>
      </div>

      <dl className="contract-list">
        <div><dt>Coordinates</dt><dd>{metadata?.coordinate_convention ?? mixture?.coordinate_convention ?? '—'}</dd></div>
        <div><dt>Normalization</dt><dd>{metadata?.normalization ?? mixture?.normalization ?? '—'}</dd></div>
        <div><dt>Length unit</dt><dd>{metadata?.length_unit ?? mixture?.length_unit ?? '—'}</dd></div>
        <div><dt>Geometry</dt><dd>{metadata?.geometry_semantics ?? mixture?.geometry_semantics ?? '—'}</dd></div>
        <div><dt>Color</dt><dd>{metadata?.color_semantics ?? mixture?.color_semantics ?? '—'}</dd></div>
        {/*
          The scales the superposition was actually built with. a_mu = m_e/mu is
          the dimensionless reduced-Bohr scale in ordinary bohr, and the reduced
          mass ratio mu/m_e is its reciprocal: both are reported, read-only,
          because they set the length and energy scales of everything above.
        */}
        {mixture ? (
          <div><dt>Nuclear charge Z</dt><dd>{formatFinite(mixture.z, { kind: 'magnitude', digits: 3 })}</dd></div>
        ) : null}
        {mixture ? (
          <div><dt>Reduced-Bohr scale a_μ</dt><dd>{formatFinite(mixture.a_mu, { kind: 'magnitude', digits: 3 })}</dd></div>
        ) : null}
        {mixture ? (
          <div>
            <dt>Reduced mass ratio</dt>
            <dd>{formatFinite(mixture.reduced_mass_ratio, { kind: 'magnitude', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.radialMass !== undefined ? (
          <div>
            <dt>Radial mass</dt>
            <dd>{formatFiniteUnit(status.radialMass * 100, { kind: 'fixed', digits: 5 }, '%', '')}</dd>
          </div>
        ) : null}
        {status.capturedProbabilityMass !== undefined ? (
          <div>
            <dt>Superlevel mass</dt>
            <dd>
              {formatFiniteUnit(status.capturedProbabilityMass * 100, { kind: 'fixed', digits: 3 }, '%', '')}
            </dd>
          </div>
        ) : null}
        {status.finiteGridDensityIntegral !== undefined ? (
          <div>
            <dt>Finite-grid ∫ρdV</dt>
            <dd>{formatFinite(status.finiteGridDensityIntegral, { kind: 'fixed', digits: 6 })}</dd>
          </div>
        ) : null}
        {status.gridResolution !== undefined ? (
          <div>
            <dt>Grid</dt>
            <dd>
              {formatFinite(status.gridResolution, { kind: 'count' })}³ · Δ=
              {formatFiniteUnit(status.gridSpacingBohr, { kind: 'fixed', digits: 3 }, 'bohr')}
            </dd>
          </div>
        ) : null}
        {/*
          A plane section's own numbers, every one of them through
          `formatFinite`: these are the terms a reader would quote off the
          screen, and a NaN threshold shown as "NaN" reads like a measured one.

          Reported separately from the isosurface's `Grid` above, and never
          folded into it: that grid is a 3-D marching grid and this one is a
          plane, so `resolution × resolution` is written out rather than cubed.
          A slice buys `resolution**2` samples and saying otherwise overstates
          the evidence behind every number beside it.
        */}
        {status.plane !== undefined ? (
          <div><dt>Plane</dt><dd>{status.plane}</dd></div>
        ) : null}
        {status.sliceResolution !== undefined ? (
          <div>
            <dt>Slice grid</dt>
            <dd>
              {formatFinite(status.sliceResolution, { kind: 'count' })} ×{' '}
              {formatFinite(status.sliceResolution, { kind: 'count' })} · Δ=
              {formatFiniteUnit(status.sliceSpacingBohr, { kind: 'fixed', digits: 3 }, 'bohr')}
            </dd>
          </div>
        ) : null}
        {status.sliceValueUnit !== undefined ? (
          <div><dt>Value unit</dt><dd>{status.sliceValueUnit}</dd></div>
        ) : null}
        {/*
          The extreme the renderer normalises colour to -- the largest |value|
          among the samples whose value is DEFINED, recomputed from the data.
          Not `max_amplitude_on_plane`: for a real or imaginary component
          |Re ψ| ≤ |ψ| pointwise, so the two differ by a state-dependent amount
          and quoting one for the other silently mis-scales the ramp's label.
        */}
        {status.sliceMaxAbsValue !== undefined ? (
          <div>
            <dt>Max |value|</dt>
            <dd>{formatFinite(status.sliceMaxAbsValue, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {/*
          The mask rule in the order it is applied: the relative amplitude, the
          scale it is taken against, their product (the threshold), the numeric
          floor that takes over when the evaluation's own cancellation residue
          exceeds it, and the fraction that resulted. All five are shown because
          a bare fraction cannot be checked, and only a phase slice reports the
          first four -- every other observable omits them, so each is guarded.
        */}
        {status.phaseMaskRelativeAmplitude !== undefined ? (
          <div>
            <dt>Phase mask relative</dt>
            <dd>
              {formatFinite(status.phaseMaskRelativeAmplitude, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskAmplitudeScale !== undefined ? (
          <div>
            <dt>Phase mask scale</dt>
            <dd>
              {formatFinite(status.phaseMaskAmplitudeScale, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskAmplitudeThreshold !== undefined ? (
          <div>
            <dt>Phase mask threshold</dt>
            <dd>
              {formatFinite(status.phaseMaskAmplitudeThreshold, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskNumericFloor !== undefined ? (
          <div>
            <dt>Phase mask floor</dt>
            <dd>
              {formatFinite(status.phaseMaskNumericFloor, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskedFraction !== undefined ? (
          <div>
            <dt>Masked fraction</dt>
            <dd>
              {formatFiniteUnit(
                status.phaseMaskedFraction * 100,
                { kind: 'fixed', digits: 3 },
                '%',
                '',
              )}
            </dd>
          </div>
        ) : null}
        {/*
          The finite value a masked sample literally holds in `values`. Shown
          because it is a legal value of the field it sits in -- `0.0` reads as
          a positive real amplitude, and as phase 0 -- so a reader comparing
          numbers has to be told which zero means "undefined here".
        */}
        {status.maskedValueSentinel !== undefined ? (
          <div>
            <dt>Masked value sentinel</dt>
            <dd>{formatFinite(status.maskedValueSentinel, { kind: 'magnitude', digits: 3 })}</dd>
          </div>
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
            <dd>{formatFinite(status.finiteGridReportingTolerance, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteGridMassErrorLowerBound !== undefined ? (
          <div>
            <dt>Grid mass error ≥</dt>
            <dd>{formatFinite(status.finiteGridMassErrorLowerBound, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {/*
          Peak-to-peak upper envelope of the grid quadrature error over phase --
          the "≤" companion of the aliasing lower bound below it.
        */}
        {status.finiteGridPhaseVariationBound !== undefined ? (
          <div>
            <dt>Grid phase variation ≤</dt>
            <dd>{formatFinite(status.finiteGridPhaseVariationBound, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteGridAliasingVariationLowerBound !== undefined ? (
          <div>
            <dt>Grid alias variation ≥</dt>
            <dd>
              {formatFinite(status.finiteGridAliasingVariationLowerBound, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {/* Probability outside the render box, bounded from the component tails. */}
        {status.finiteBoxTailMassUpperBound !== undefined ? (
          <div>
            <dt>Finite-box tail mass ≤</dt>
            <dd>{formatFinite(status.finiteBoxTailMassUpperBound, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteBoxMassVariationUpperBound !== undefined ? (
          <div>
            <dt>Finite-box variation ≤</dt>
            <dd>
              {formatFinite(status.finiteBoxMassVariationUpperBound, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.timeAu !== undefined ? (
          <div>
            <dt>Time</dt>
            <dd>{formatFiniteUnit(status.timeAu, { kind: 'fixed', digits: 2 }, 'a.u.')}</dd>
          </div>
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
              {formatFiniteUnit(
                status.superposition.energy_expectation_hartree,
                { kind: 'fixed', digits: 6 },
                'Ha',
              )}
              {status.superposition.is_stationary ? ' · stationary density' : ''}
            </dd>
          </div>
        ) : null}
        {status.lineCount !== undefined ? (
          <div><dt>Streamlines</dt><dd>{formatFinite(status.lineCount, { kind: 'count' })}</dd></div>
        ) : null}
        {status.maxSpeed !== undefined ? (
          <div>
            <dt>Max |j|/ρ</dt>
            <dd>{formatFiniteUnit(status.maxSpeed, { kind: 'exponential', digits: 3 }, 'a.u.')}</dd>
          </div>
        ) : null}
        {/*
          The residual is a ratio, so its numerator (the absolute residual of
          ∂ρ/∂t + ∇·j), its denominator and the denominator's kind are shown
          next to it: a dimensionless 1e-6 means nothing without the scale it
          was divided by, and the probe/phase counts say how much of the domain
          the audit actually sampled.
        */}
        {status.continuityResidual !== undefined ? (
          <div>
            <dt>Continuity residual</dt>
            <dd>{formatFinite(status.continuityResidual, { kind: 'exponential', digits: 2 })}</dd>
          </div>
        ) : null}
        {status.continuityAbsoluteResidual !== undefined ? (
          <div>
            <dt>Continuity |residual|</dt>
            <dd>{formatFinite(status.continuityAbsoluteResidual, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.continuityScale !== undefined ? (
          <div>
            <dt>Continuity scale</dt>
            <dd>{formatFinite(status.continuityScale, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.continuityScaleKind !== undefined ? (
          <div>
            <dt>Continuity scale kind</dt>
            <dd>{status.continuityScaleKind.replaceAll('_', ' ')}</dd>
          </div>
        ) : null}
        {status.continuityProbeCount !== undefined ? (
          <div>
            <dt>Continuity probes</dt>
            <dd>{formatFinite(status.continuityProbeCount, { kind: 'count' })}</dd>
          </div>
        ) : null}
        {status.continuityPhaseCount !== undefined ? (
          <div>
            <dt>Continuity phase samples</dt>
            <dd>{formatFinite(status.continuityPhaseCount, { kind: 'count' })}</dd>
          </div>
        ) : null}
        {status.densityLevel !== undefined ? (
          <div>
            <dt>Density level</dt>
            <dd>{formatFinite(status.densityLevel, { kind: 'exponential', digits: 3 })}</dd>
          </div>
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
