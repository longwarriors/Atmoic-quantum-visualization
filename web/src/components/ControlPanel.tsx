import {
  Atom,
  Clock,
  Cloud,
  Grid2x2,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  capabilityFor,
  planSceneRequest,
  Z_CONSTRAINT,
  type ParameterBound,
  type ParameterId,
} from '../api/capability'
import { fetchCatalog, fetchSuperpositionCatalog } from '../api/client'
import type {
  OrbitalPreset,
  PrincipalPlane,
  RepresentationKind,
  SliceObservable,
  SuperpositionPreset,
} from '../api/types'
import { useSceneStore } from '../state/useSceneStore'
import { nextTimeAu, selectSceneRequestInputs } from './sceneRequest'
import { REPRESENTATION_LABELS } from './sceneStatus'

/**
 * A slider bound to a request parameter.
 *
 * `min`, `max` and `step` are NOT arguments: they come from the
 * `ParameterBound` the capability matrix declares for this cell, so a slider
 * cannot offer a value the route rejects and cannot withhold one it accepts.
 * The panel used to spell its own numbers here (`max={160}` for a route that
 * takes 256, `max={40}` for a clock that runs to 1000) and each of those was a
 * second, quieter statement about what the server can do.
 */
function ParameterRow({
  parameter,
  label,
  bound,
  value,
  suffix,
  onChange,
}: {
  parameter: ParameterId
  label: string
  bound: ParameterBound
  value: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const displayedValue =
    bound.step === undefined
      ? String(value)
      : String(Number(value.toFixed(Math.min(12, Math.max(0, -Math.floor(Math.log10(bound.step)))))))
  return (
    <label className="range-row">
      <span className="control-label">{label}</span>
      <input
        type="range"
        data-parameter={parameter}
        min={bound.min}
        max={bound.max}
        step={bound.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="control-value">{displayedValue}{suffix ?? ''}</span>
    </label>
  )
}

/**
 * A slider over a purely local rendering choice -- opacity, exposure, fog.
 *
 * Deliberately a different component from `ParameterRow`: nothing here is sent
 * to a route, so there is no bound in the capability matrix to read and no
 * `data-parameter` for a test to confuse with one. Keeping the two kinds
 * visually alike but structurally distinct is what stops a display knob from
 * quietly acquiring the authority of a request parameter.
 */
function DisplayRow({
  control,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  control: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="range-row">
      <span className="control-label">{label}</span>
      <input
        type="range"
        data-display={control}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="control-value">{value}{suffix ?? ''}</span>
    </label>
  )
}

/**
 * A picker over an ENUMERATED request choice -- which plane, which field.
 *
 * The counterpart of `ParameterRow`, and deliberately built on the same rule:
 * `options` is not written here, it is the list the capability declares for this
 * cell, so a choice the route does not offer cannot be pressed and one it does
 * offer cannot be withheld. `planes` and `observables` are the matrix making the
 * same kind of statement a `ParameterBound` makes, with a list instead of an
 * interval, and treating them any other way would put a second opinion about
 * the routes back into the panel.
 */
function ChoiceRow<T extends string>({
  choice,
  label,
  options,
  labels,
  value,
  onChange,
}: {
  choice: string
  label: string
  options: readonly T[]
  labels: Readonly<Record<T, string>>
  value: T
  onChange: (value: T) => void
}) {
  return (
    // `range-row` is reused rather than duplicated: this is the same
    // label-then-control line a slider draws, and only the control differs.
    <div className="range-row">
      <span className="control-label">{label}</span>
      <div className="slice-choices" data-choice={choice} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option}
            data-choice-value={option}
            className={value === option ? 'active' : ''}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * How each plane and each observable is spelled on screen.
 *
 * Total records rather than a formatter, so a fifth observable added to the
 * contract stops this file compiling instead of rendering a raw wire name.
 */
const PLANE_LABEL: Readonly<Record<PrincipalPlane, string>> = {
  xy: 'xy',
  xz: 'xz',
  yz: 'yz',
}

const OBSERVABLE_LABEL: Readonly<Record<SliceObservable, string>> = {
  probability_density: '|ψ|²',
  wavefunction_real: 'Re ψ',
  wavefunction_imag: 'Im ψ',
  phase: 'arg ψ',
}

/**
 * The four representations, with the sentence each one is *for*.
 *
 * `purpose` is the title of an AVAILABLE button only. A refused button's title
 * is the matrix's own `reason`, verbatim -- not a paraphrase written here,
 * which is how "Isosurfaces are validated for n <= 4" came to be shown for a
 * state refused because l > 3.
 */
const REPRESENTATIONS: {
  id: RepresentationKind
  label: string
  icon: LucideIcon
  purpose: string
}[] = [
  {
    id: 'point_cloud',
    label: REPRESENTATION_LABELS.point_cloud,
    icon: Cloud,
    purpose: '从 |ψ|² d³r 采样位置；每个 marker 具有相同视觉权重',
  },
  {
    id: 'isosurface',
    label: REPRESENTATION_LABELS.isosurface,
    icon: Layers3,
    purpose: '包围指定概率质量的 |ψ|² level set',
  },
  {
    id: 'slice',
    label: REPRESENTATION_LABELS.slice,
    // A 2-D sampled section, which is what this icon says and what the route
    // returns: `resolution**2` samples on one principal plane.
    icon: Grid2x2,
    purpose: '在过原子核的主平面上采样一个标量场',
  },
  {
    id: 'streamlines',
    label: REPRESENTATION_LABELS.streamlines,
    icon: Waves,
    purpose: 'j/ρ 的 streamlines（概率流，不是电子轨迹）',
  },
]

/** Chinese UI copy for the fixed server catalogue; formulas stay untouched. */
const MIXTURE_COPY: Readonly<Record<string, { label: string; note: string }>> = {
  '1s-2pz': {
    label: '1s + 2p_z · Bohr 振荡',
    note: 'ω = 3/8 Ha；偶极矩随 t 振荡。',
  },
  '2s-2pz': {
    label: '2s + 2p_z · 简并定态',
    note: '两项能量相同，density 不随 t 变化。',
  },
  '1s-3dz2': {
    label: '1s + 3d_z²',
    note: 'ω = 4/9 Ha；无 dipole coupling，呈 quadrupole 呼吸。',
  },
  '2pplus-2pminus': {
    label: '2p(+1) + 2p(−1)',
    note: '简并叠加；等价于实 p orbital，净 current 为 0。',
  },
}

/**
 * How each request parameter is labelled and where its value lives.
 *
 * The ORDER is this list's; the MEMBERSHIP is the capability matrix's. A row
 * renders exactly when the cell declares a bound for it, so a route that stops
 * taking `seed_count` removes the Seeds slider by itself.
 */
const PARAMETER_ROWS: {
  id: ParameterId
  label: string
  suffix?: string
}[] = [
  { id: 'samples', label: '样本数' },
  { id: 'seed', label: '随机 seed' },
  { id: 'resolution', label: '网格' },
  { id: 'probabilityMass', label: '概率质量' },
  { id: 'seedCount', label: '流线种子' },
  { id: 'timeAu', label: 't', suffix: ' a.u.' },
]

export function ControlPanel() {
  const store = useSceneStore()
  const [presets, setPresets] = useState<OrbitalPreset[]>([])
  const lOptions = useMemo(
    () => Array.from({ length: store.orbital.n }, (_, index) => index),
    [store.orbital.n],
  )
  const mOptions = useMemo(
    () => Array.from({ length: 2 * store.orbital.l + 1 }, (_, index) => index - store.orbital.l),
    [store.orbital.l],
  )
  const [mixtures, setMixtures] = useState<SuperpositionPreset[]>([])

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(controller.signal).then(setPresets).catch(() => setPresets([]))
    fetchSuperpositionCatalog(controller.signal)
      .then((catalogue) => {
        setMixtures(catalogue)
        const terms = useSceneStore.getState().superpositionTerms
        const selected = catalogue.find((mixture) => mixture.terms === terms)
        if (selected !== undefined) {
          useSceneStore
            .getState()
            .syncSuperpositionCapabilities(
              selected.terms,
              selected.slice_resolution_floor,
            )
        }
      })
      .catch(() => setMixtures([]))
    return () => controller.abort()
  }, [])

  const { mode, playing } = store

  // Exactly the inputs `useSceneAsset` plans from, so the panel and the fetch
  // layer cannot describe two different requests.
  const requestInputs = selectSceneRequestInputs(store)

  const current = capabilityFor(requestInputs)
  const bounds = current.status === 'available' ? current.parameters : {}
  /**
   * The enumerated choices this cell declares, on exactly the terms `bounds`
   * is on: undefined means the route reads no such choice, and the picker for
   * it is not rendered at all.
   */
  const planes = current.status === 'available' ? current.planes : undefined
  const observables = current.status === 'available' ? current.observables : undefined
  /** What the request will actually carry, or a refusal that carries nothing. */
  const plan = planSceneRequest(requestInputs)
  const currentServerValidation =
    current.status === 'available' ? current.serverValidation : undefined

  const parameterValue: Record<ParameterId, number> = {
    samples: store.samples,
    seed: store.seed,
    resolution: store.resolution,
    probabilityMass: store.probabilityMass,
    seedCount: store.seedCount,
    timeAu: store.timeAu,
    // Not in PARAMETER_ROWS on purpose: a_mu has no slider (changing it makes
    // the state not-hydrogen while every label still says hydrogenic); the map
    // stays total so a request can still carry the store's value.
    aMu: store.aMu,
  }
  const parameterSetter: Record<ParameterId, (value: number) => void> = {
    samples: store.setSamples,
    seed: store.setSeed,
    resolution: store.setResolution,
    probabilityMass: store.setProbabilityMass,
    seedCount: store.setSeedCount,
    timeAu: store.setTimeAu,
    aMu: store.setAMu,
  }

  /**
   * A clock exists for this cell iff the route takes a time. Derived rather
   * than tested as `mode === 'superposition'`, so a stationary route that grew
   * a time parameter would get playback without an edit here -- and, more to
   * the point, so playback can never be offered for a request that would send
   * the same query on every tick.
   */
  const hasClock = bounds.timeAu !== undefined
  const selectedMixture = mixtures.find(
    (mixture) => mixture.terms === store.superpositionTerms,
  )
  const plannedZ =
    plan.status === 'available' && typeof plan.params.z === 'number' ? plan.params.z : null
  const plannedAMu =
    plan.status === 'available' && typeof plan.params.a_mu === 'number'
      ? plan.params.a_mu
      : null
  const playbackPeriodAu =
    selectedMixture === undefined
      ? null
      : selectedMixture.period_au === 0
        ? 0
        : plannedZ === null || plannedAMu === null
          ? null
          : (selectedMixture.period_au * plannedAMu) / plannedZ ** 2
  const canPlay = hasClock && playbackPeriodAu !== null && playbackPeriodAu > 0
  const playbackUnavailableReason =
    playbackPeriodAu === 0
      ? '该叠加态的能量简并，概率密度严格不随时间变化。'
      : canPlay
        ? null
        : '等待叠加态目录提供物理周期。'

  // Stepping time re-requests the asset. A round trip slower than the interval
  // does not pile requests up: the canvas keeps only the newest pending time.
  //
  // The tick reads the clock from the store rather than from this render's
  // closure, so the only things that can restart the interval are the two that
  // decide whether it runs at all. Depending on `store` (a fresh object on
  // every write) and on `store.timeAu` tore the timer down and rebuilt it on
  // every unrelated store write -- time stopped advancing for as long as the
  // user held any slider, and each tick restarted the interval it ran in.
  useEffect(() => {
    if (!playing || !canPlay || playbackPeriodAu === null) return undefined
    const timer = window.setInterval(() => {
      const state = useSceneStore.getState()
      state.setTimeAu(nextTimeAu(state.timeAu, playbackPeriodAu))
    }, 420)
    return () => window.clearInterval(timer)
  }, [playing, canPlay, playbackPeriodAu])

  return (
    <aside className="panel controls-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">态制备</span>
          <h2>轨道与表示设置</h2>
        </div>
        <button
          type="button"
          className="round-button"
          title="恢复 2p_z 默认值"
          aria-label="恢复 2p_z 默认值"
          onClick={() => store.applyPreset({ n: 2, l: 1, m: 0, z: 1, basis: 'real' })}
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="preset-strip">
        {presets.slice(0, 6).map((preset) => {
          const active =
              preset.n === store.orbital.n &&
              preset.l === store.orbital.l &&
              preset.m === store.orbital.m &&
              preset.basis === store.orbital.basis
          return (
            <button
              type="button"
              key={preset.id}
              onClick={() => store.applyPreset(preset)}
              className={active ? 'preset active' : 'preset'}
              aria-pressed={active}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <section className="control-section">
        <div className="section-title"><Atom size={15} /> 量子数</div>
        <div className="quantum-grid">
          <label>
            <span>n</span>
            <select value={store.orbital.n} onChange={(event) => store.setOrbital({ n: Number(event.target.value) })}>
              {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>ℓ</span>
            <select value={store.orbital.l} onChange={(event) => store.setOrbital({ l: Number(event.target.value) })}>
              {lOptions.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>m</span>
            <select value={store.orbital.m} onChange={(event) => store.setOrbital({ m: Number(event.target.value) })}>
              {mOptions.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Z</span>
            <input
              type="number"
              min={Z_CONSTRAINT.uiBound.min}
              max={Z_CONSTRAINT.uiBound.max}
              step={Z_CONSTRAINT.uiBound.step}
              value={store.orbital.z}
              onChange={(event) => store.setOrbital({ z: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="segmented two">
          {(['real', 'complex'] as const).map((basis) => (
            <button
              type="button"
              key={basis}
              className={store.orbital.basis === basis ? 'active' : ''}
              aria-pressed={store.orbital.basis === basis}
              onClick={() => store.setOrbital({ basis })}
            >
              {basis === 'real' ? '实基 · chemistry' : '复基 · Lz'}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-title"><Clock size={15} /> 态构成</div>
        <div className="representation-switch">
          <button
            type="button"
            className={store.mode === 'eigenstate' ? 'active' : ''}
            aria-pressed={store.mode === 'eigenstate'}
            onClick={() => store.setMode('eigenstate')}
          >
            <Atom size={17} /> 本征态
          </button>
          <button
            type="button"
            className={store.mode === 'superposition' ? 'active' : ''}
            aria-pressed={store.mode === 'superposition'}
            title="解析含时 eigenstate 叠加"
            onClick={() => store.setMode('superposition')}
          >
            <Clock size={17} /> 叠加态
          </button>
        </div>

        {store.mode === 'superposition' ? (
          <>
            <div className="mixture-list">
              {mixtures.map((mixture) => (
                <button
                  key={mixture.id}
                  type="button"
                  title={MIXTURE_COPY[mixture.id]?.note ?? mixture.note}
                  className={`preset${store.superpositionTerms === mixture.terms ? ' active' : ''}`}
                  aria-pressed={store.superpositionTerms === mixture.terms}
                  onClick={() =>
                    store.setSuperposition(
                      mixture.terms,
                      mixture.label,
                      mixture.slice_resolution_floor,
                    )
                  }
                >
                  {MIXTURE_COPY[mixture.id]?.label ?? mixture.label}
                </button>
              ))}
            </div>
            {plan.status === 'available' ? (
              /*
               * The two fields the superposition request states explicitly so
               * the server cannot default them. Read from the PLAN, not from
               * the store, so this read-out cannot name a basis or a charge
               * different from the one the query carries.
               *
               * a_mu used to be the third entry here, and being HERE was its
               * only gate -- see the read-out below, which is gated on the plan
               * carrying the parameter instead.
               */
              <dl className="readout" data-readonly-group="superposition">
                <div>
                  <dt>basis</dt>
                  <dd data-readonly="basis">{String(plan.params.basis)}</dd>
                </div>
                <div>
                  <dt>Z</dt>
                  <dd data-readonly="z">{String(plan.params.z)}</dd>
                </div>
              </dl>
            ) : null}
          </>
        ) : null}

        {hasClock ? (
          <button
            type="button"
            className="toggle-row"
            data-control="playback"
            aria-pressed={store.playing}
            aria-disabled={!canPlay}
            aria-describedby={!canPlay ? 'playback-availability-notice' : undefined}
            title={
              canPlay
                ? `按物理周期 ${playbackPeriodAu?.toPrecision(6)} a.u. 循环`
                : (playbackUnavailableReason ?? undefined)
            }
            onClick={() => {
              if (canPlay) store.setPlaying(!store.playing)
            }}
          >
            {store.playing ? <Pause size={15} /> : <Play size={15} />}
            <span>随 t 演化</span>
            <span className={store.playing ? 'switch on' : 'switch'} />
          </button>
        ) : null}
        {hasClock && playbackUnavailableReason !== null ? (
          <p
            id="playback-availability-notice"
            className="capability-notice"
            role="note"
            data-playback-notice
          >
            {playbackUnavailableReason}
          </p>
        ) : null}
      </section>

      <section className="control-section">
        <div className="section-title"><Layers3 size={15} /> 表示法</div>
        <div className="representation-switch">
          {REPRESENTATIONS.map(({ id, label, icon: Icon, purpose }) => {
            const capability = capabilityFor({
              mode,
              orbital: requestInputs.orbital,
              representation: id,
              superpositionSliceResolutionFloor:
                requestInputs.superpositionSliceResolutionFloor,
            })
            const available = capability.status === 'available'
            const serverValidation = available ? capability.serverValidation : undefined
            return (
              <button
                type="button"
                key={id}
                data-representation={id}
                data-server-validation={serverValidation === undefined ? undefined : 'required'}
                className={store.representation === id ? 'active' : ''}
                aria-pressed={store.representation === id}
                aria-disabled={!available}
                aria-label={
                  !available
                    ? `${label}暂不可用：${capability.reason}`
                    : serverValidation === undefined
                      ? label
                      : `${label}；需服务端数值验证：${serverValidation.reason}`
                }
                aria-describedby={
                  available && store.representation === id && serverValidation !== undefined
                    ? 'representation-server-validation-notice'
                    : undefined
                }
                title={
                  !available
                    ? capability.reason
                    : serverValidation === undefined
                      ? purpose
                      : `${purpose}；需服务端数值验证：${serverValidation.reason}`
                }
                onClick={() => {
                  if (available) store.setRepresentation(id)
                }}
              >
                <Icon size={17} /> {label}
              </button>
            )
          })}
        </div>

        {currentServerValidation === undefined ? null : (
          <p
            id="representation-server-validation-notice"
            className="capability-notice server-validation-notice"
            role="note"
            data-server-validation-notice={store.representation}
          >
            <strong>需服务端数值验证：</strong>
            {currentServerValidation.reason}
          </p>
        )}

        {planes === undefined ? null : (
          <ChoiceRow
            choice="plane"
            label="平面"
            options={planes}
            labels={PLANE_LABEL}
            value={store.plane}
            onChange={store.setPlane}
          />
        )}

        {observables === undefined ? null : (
          <ChoiceRow
            choice="observable"
            label="场"
            options={observables}
            labels={OBSERVABLE_LABEL}
            value={store.sliceObservable}
            onChange={store.setSliceObservable}
          />
        )}

        {PARAMETER_ROWS.map(({ id, label, suffix }) => {
          const bound = bounds[id]
          if (bound === undefined) return null
          return (
            <ParameterRow
              key={id}
              parameter={id}
              label={label}
              bound={bound}
              suffix={suffix}
              value={parameterValue[id]}
              onChange={parameterSetter[id]}
            />
          )
        })}

        {plan.status === 'available' && plan.params.a_mu !== undefined ? (
          /*
           * The reduced-mass ratio, read out iff the REQUEST CARRIES ONE.
           *
           * Read-only by decision: a_mu has no slider because changing it makes
           * the state not-hydrogen while every label on screen still says
           * hydrogenic. But read-only is not the same as invisible, and the gate
           * used to be "is the mode superposition?" -- written when a_mu reached
           * only the two superposition routes. It reaches four now, so an
           * eigenstate slice was sending a reduced mass nothing on screen
           * stated. The plan is the one thing that knows whether this request
           * has an `a_mu` at all, so it is what decides.
           *
           * The value comes from the plan too, which is the clamped one: a
           * read-out of the store's raw number would name a length scale the
           * wire never carried.
           */
          <dl className="readout" data-readonly-group="request">
            <div>
              <dt>a<sub>μ</sub></dt>
              <dd data-readonly="a_mu">{String(plan.params.a_mu)}</dd>
            </div>
          </dl>
        ) : null}

      </section>

      {/*
        Display controls are representation-specific. A slider is shown only
        when the current renderer consumes it; that keeps this compact panel
        from offering a polished-looking control over nothing. Exposure stays
        internal until the composer path owns an audited tone-mapping policy.
      */}
      <section className="control-section compact display-section">
        <div className="section-title"><SlidersHorizontal size={15} /> 显示</div>
        {store.representation === 'point_cloud' ? (
          <DisplayRow control="pointSize" label="点尺寸" value={store.pointSize} min={1.5} max={7} step={0.1} onChange={store.setPointSize} />
        ) : null}
        {store.representation !== 'slice' ? (
          <DisplayRow control="opacity" label="透明度" value={Math.round(store.opacity * 100)} min={25} max={100} step={1} suffix="%" onChange={(value) => store.setOpacity(value / 100)} />
        ) : null}
        {store.representation === 'streamlines' ? (
          <DisplayRow control="fog" label="雾强度" value={Math.round(store.fogStrength * 100)} min={0} max={70} step={2} suffix="%" onChange={(value) => store.setFogStrength(value / 100)} />
        ) : null}
        {store.representation === 'slice' || store.representation === 'streamlines' ? (
          <DisplayRow control="bloom" label="Bloom" value={Math.round(store.bloom * 100)} min={0} max={50} step={1} suffix="%" onChange={(value) => store.setBloom(value / 100)} />
        ) : null}
        <button
          type="button"
          className="toggle-row"
          aria-pressed={store.autoRotate}
          onClick={() => store.setAutoRotate(!store.autoRotate)}
        >
          {store.autoRotate ? <Pause size={15} /> : <Play size={15} />}
          <span>自动旋转</span>
          <span className={store.autoRotate ? 'switch on' : 'switch'} />
        </button>
        <button
          type="button"
          className="toggle-row"
          aria-pressed={store.showGrid}
          onClick={() => store.setShowGrid(!store.showGrid)}
        >
          <Layers3 size={15} />
          <span>参考网格</span>
          <span className={store.showGrid ? 'switch on' : 'switch'} />
        </button>
      </section>
    </aside>
  )
}
