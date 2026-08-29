import { AlertTriangle, Box, Database, Gauge, Sigma, X } from 'lucide-react'
import { type KeyboardEvent, useId, useRef, useState } from 'react'

import type { SceneStatus } from '../api/types'
import { observableLabel, representationLabel } from './sceneStatus'

interface InspectorProps {
  status: SceneStatus
  open?: boolean
  mobileOpen?: boolean
  onClose?: () => void
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
    phase_dependent_quadrature_error: '检测到 phase-dependent quadrature error',
    time_invariant_quadrature_error: '检测到 time-invariant quadrature error',
    quadrature_error_at_reported_time: '当前 t 检测到 quadrature error',
    no_error_above_tolerance_proven: '未发现超过阈值的 error（不构成 accuracy 证明）',
  }
  return labels[status]
}

type InspectorTab = 'overview' | 'contract' | 'references'

const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'contract', label: '场景契约' },
  { id: 'references', label: '引用' },
]

export function Inspector({
  status,
  open = true,
  mobileOpen = false,
  onClose,
}: InspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview')
  const instanceId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const visible = open || mobileOpen
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
      ? `${mixture.terms.length} 项叠加 · ${mixture.basis} basis`
      : '等待已验证 metadata'

  const tabId = (tab: InspectorTab): string => `${instanceId}-${tab}-tab`
  const panelId = (tab: InspectorTab): string => `${instanceId}-${tab}-panel`
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % INSPECTOR_TABS.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = INSPECTOR_TABS.length - 1
    }
    if (nextIndex === undefined) return

    event.preventDefault()
    setActiveTab(INSPECTOR_TABS[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <aside
      id="science-inspector"
      className={`panel inspector-panel${visible ? ' is-open' : ''}${mobileOpen ? ' mobile-open' : ''}`}
      aria-label="科学详情"
      aria-hidden={!visible}
      inert={!visible}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || onClose === undefined) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="inspector-tabbar">
        <div className="inspector-tabs" role="tablist" aria-label="科学详情视图">
          {INSPECTOR_TABS.map((tab, index) => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              id={tabId(tab.id)}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              aria-selected={activeTab === tab.id}
              aria-controls={panelId(tab.id)}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {onClose === undefined ? null : (
          <button
            type="button"
            className="inspector-close"
            onClick={onClose}
            aria-label="关闭科学详情"
            title="关闭科学详情"
          >
            <X size={17} />
          </button>
        )}
      </div>

      <section
        id={panelId('overview')}
        className="inspector-tab-panel overview-panel"
        role="tabpanel"
        aria-labelledby={tabId('overview')}
        hidden={activeTab !== 'overview'}
      >
      <div className="state-title-row">
        <div>
          <h2>{label ?? (status.loading ? '计算中…' : '暂无资产')}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="energy-pill">
          {formatFiniteUnit(energy, { kind: 'fixed', digits: 6 }, 'Ha')}
        </span>
      </div>

      <div className="inspector-grid">
        <div className="metric-card">
          <Sigma size={15} />
          <span>可观测量</span>
          <strong>{observableLabel(observable)}</strong>
        </div>
        <div className="metric-card">
          <Box size={15} />
          <span>表示法</span>
          <strong>{representationLabel(representation)}</strong>
        </div>
        <div className="metric-card">
          <Database size={15} />
          <span>资产规模</span>
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
          <span>空间范围</span>
          <strong>{formatFiniteUnit(status.extentBohr, { kind: 'fixed', digits: 2 }, 'bohr')}</strong>
        </div>
      </div>
      </section>

      <section
        id={panelId('contract')}
        className="inspector-tab-panel contract-panel"
        role="tabpanel"
        aria-labelledby={tabId('contract')}
        hidden={activeTab !== 'contract'}
      >
      <dl className="contract-list">
        <div><dt>坐标约定</dt><dd>{metadata?.coordinate_convention ?? mixture?.coordinate_convention ?? '—'}</dd></div>
        <div><dt>归一化</dt><dd>{metadata?.normalization ?? mixture?.normalization ?? '—'}</dd></div>
        <div><dt>长度单位</dt><dd>{metadata?.length_unit ?? mixture?.length_unit ?? '—'}</dd></div>
        <div><dt>几何语义</dt><dd>{metadata?.geometry_semantics ?? mixture?.geometry_semantics ?? '—'}</dd></div>
        <div><dt>色彩语义</dt><dd>{metadata?.color_semantics ?? mixture?.color_semantics ?? '—'}</dd></div>
        {/*
          The scales the superposition was actually built with. a_mu = m_e/mu is
          the dimensionless reduced-Bohr scale in ordinary bohr, and the reduced
          mass ratio mu/m_e is its reciprocal: both are reported, read-only,
          because they set the length and energy scales of everything above.
        */}
        {mixture ? (
          <div><dt>核电荷 Z</dt><dd>{formatFinite(mixture.z, { kind: 'magnitude', digits: 3 })}</dd></div>
        ) : null}
        {mixture ? (
          <div><dt>约化 Bohr 尺度 a_μ</dt><dd>{formatFinite(mixture.a_mu, { kind: 'magnitude', digits: 3 })}</dd></div>
        ) : null}
        {mixture ? (
          <div>
            <dt>约化质量比 μ/mₑ</dt>
            <dd>{formatFinite(mixture.reduced_mass_ratio, { kind: 'magnitude', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.radialMass !== undefined ? (
          <div>
            <dt>径向质量</dt>
            <dd>{formatFiniteUnit(status.radialMass * 100, { kind: 'fixed', digits: 5 }, '%', '')}</dd>
          </div>
        ) : null}
        {status.capturedProbabilityMass !== undefined ? (
          <div>
            <dt>超水平集质量</dt>
            <dd>
              {formatFiniteUnit(status.capturedProbabilityMass * 100, { kind: 'fixed', digits: 3 }, '%', '')}
            </dd>
          </div>
        ) : null}
        {status.finiteGridDensityIntegral !== undefined ? (
          <div>
            <dt>有限网格 ∫ρdV</dt>
            <dd>{formatFinite(status.finiteGridDensityIntegral, { kind: 'fixed', digits: 6 })}</dd>
          </div>
        ) : null}
        {status.gridResolution !== undefined ? (
          <div>
            <dt>3D 网格</dt>
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
          <div><dt>切片平面</dt><dd>{status.plane}</dd></div>
        ) : null}
        {status.sliceResolution !== undefined ? (
          <div>
            <dt>2D 网格</dt>
            <dd>
              {formatFinite(status.sliceResolution, { kind: 'count' })} ×{' '}
              {formatFinite(status.sliceResolution, { kind: 'count' })} · Δ=
              {formatFiniteUnit(status.sliceSpacingBohr, { kind: 'fixed', digits: 3 }, 'bohr')}
            </dd>
          </div>
        ) : null}
        {status.sliceValueUnit !== undefined ? (
          <div><dt>数值单位</dt><dd>{status.sliceValueUnit}</dd></div>
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
            <dt>max |value|</dt>
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
            <dt>phase mask 相对阈值</dt>
            <dd>
              {formatFinite(status.phaseMaskRelativeAmplitude, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskAmplitudeScale !== undefined ? (
          <div>
            <dt>phase mask 振幅尺度</dt>
            <dd>
              {formatFinite(status.phaseMaskAmplitudeScale, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskAmplitudeThreshold !== undefined ? (
          <div>
            <dt>phase mask 振幅阈值</dt>
            <dd>
              {formatFinite(status.phaseMaskAmplitudeThreshold, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskNumericFloor !== undefined ? (
          <div>
            <dt>phase mask 数值下限</dt>
            <dd>
              {formatFinite(status.phaseMaskNumericFloor, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.phaseMaskedFraction !== undefined ? (
          <div>
            <dt>mask 占比</dt>
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
            <dt>mask 哨兵值</dt>
            <dd>{formatFinite(status.maskedValueSentinel, { kind: 'magnitude', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteGridMassStatus !== undefined ? (
          <div>
            <dt>网格质量状态</dt>
            <dd>{formatFiniteGridMassStatus(status.finiteGridMassStatus)}</dd>
          </div>
        ) : null}
        {status.finiteGridReportingTolerance !== undefined ? (
          <div>
            <dt>网格报告阈值</dt>
            <dd>{formatFinite(status.finiteGridReportingTolerance, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteGridMassErrorLowerBound !== undefined ? (
          <div>
            <dt>网格质量 error ≥</dt>
            <dd>{formatFinite(status.finiteGridMassErrorLowerBound, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {/*
          Peak-to-peak upper envelope of the grid quadrature error over phase --
          the "≤" companion of the aliasing lower bound below it.
        */}
        {status.finiteGridPhaseVariationBound !== undefined ? (
          <div>
            <dt>网格 phase 变化 ≤</dt>
            <dd>{formatFinite(status.finiteGridPhaseVariationBound, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteGridAliasingVariationLowerBound !== undefined ? (
          <div>
            <dt>网格 alias 变化 ≥</dt>
            <dd>
              {formatFinite(status.finiteGridAliasingVariationLowerBound, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {/* Probability outside the render box, bounded from the component tails. */}
        {status.finiteBoxTailMassUpperBound !== undefined ? (
          <div>
            <dt>有限盒尾部质量 ≤</dt>
            <dd>{formatFinite(status.finiteBoxTailMassUpperBound, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.finiteBoxMassVariationUpperBound !== undefined ? (
          <div>
            <dt>有限盒变化 ≤</dt>
            <dd>
              {formatFinite(status.finiteBoxMassVariationUpperBound, { kind: 'exponential', digits: 3 })}
            </dd>
          </div>
        ) : null}
        {status.timeAu !== undefined ? (
          <div>
            <dt>t</dt>
            <dd>{formatFiniteUnit(status.timeAu, { kind: 'fixed', digits: 2 }, 'a.u.')}</dd>
          </div>
        ) : null}
        {status.superposition ? (
          <div>
            <dt>系数</dt>
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
              {status.superposition.is_stationary ? ' · 定态 density' : ''}
            </dd>
          </div>
        ) : null}
        {status.lineCount !== undefined ? (
          <div><dt>流线数</dt><dd>{formatFinite(status.lineCount, { kind: 'count' })}</dd></div>
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
            <dt>连续性 residual</dt>
            <dd>{formatFinite(status.continuityResidual, { kind: 'exponential', digits: 2 })}</dd>
          </div>
        ) : null}
        {status.continuityAbsoluteResidual !== undefined ? (
          <div>
            <dt>连续性 |residual|</dt>
            <dd>{formatFinite(status.continuityAbsoluteResidual, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.continuityScale !== undefined ? (
          <div>
            <dt>连续性尺度</dt>
            <dd>{formatFinite(status.continuityScale, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
        {status.continuityScaleKind !== undefined ? (
          <div>
            <dt>连续性尺度类型</dt>
            <dd>{status.continuityScaleKind.replaceAll('_', ' ')}</dd>
          </div>
        ) : null}
        {status.continuityProbeCount !== undefined ? (
          <div>
            <dt>连续性 probe 数</dt>
            <dd>{formatFinite(status.continuityProbeCount, { kind: 'count' })}</dd>
          </div>
        ) : null}
        {status.continuityPhaseCount !== undefined ? (
          <div>
            <dt>连续性 phase 样本</dt>
            <dd>{formatFinite(status.continuityPhaseCount, { kind: 'count' })}</dd>
          </div>
        ) : null}
        {status.densityLevel !== undefined ? (
          <div>
            <dt>density level</dt>
            <dd>{formatFinite(status.densityLevel, { kind: 'exponential', digits: 3 })}</dd>
          </div>
        ) : null}
      </dl>
      </section>

      <section
        id={panelId('references')}
        className="inspector-tab-panel references-panel"
        role="tabpanel"
        aria-labelledby={tabId('references')}
        hidden={activeTab !== 'references'}
      >
        {(metadata ?? mixture)?.references.length ? (
          <div className="reference-block">
            <span>参考文献 key</span>
            {(metadata ?? mixture)!.references.map((reference) => (
              <code key={reference}>{reference}</code>
            ))}
          </div>
        ) : (
          <p className="inspector-empty">当前资产尚未报告参考文献 key。</p>
        )}
      </section>

      {status.error ? (
        <div className="warning-card error"><AlertTriangle size={16} /><span>场景错误 · {status.error}</span></div>
      ) : null}
      {status.warnings?.map((warning) => (
        <div className="warning-card" key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>
      ))}
    </aside>
  )
}
