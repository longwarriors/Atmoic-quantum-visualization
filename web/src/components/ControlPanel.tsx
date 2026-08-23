import { Atom, Clock, Cloud, Layers3, Pause, Play, RotateCcw, Waves } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { fetchCatalog, fetchSuperpositionCatalog } from '../api/client'
import type { OrbitalPreset, RepresentationKind, SuperpositionPreset } from '../api/types'
import { useSceneStore } from '../state/useSceneStore'

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
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
  const minimumResolution = Math.max(49, 16 * store.orbital.n + 17)
  const [mixtures, setMixtures] = useState<SuperpositionPreset[]>([])
  const surfaceAvailable = store.orbital.n <= 4
  // A real stationary orbital carries identically zero current, so offering
  // the flow view there would promise a picture that cannot exist.
  const currentAvailable = store.orbital.basis === 'complex' && store.orbital.m !== 0

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(controller.signal).then(setPresets).catch(() => setPresets([]))
    fetchSuperpositionCatalog(controller.signal)
      .then(setMixtures)
      .catch(() => setMixtures([]))
    return () => controller.abort()
  }, [])

  // Stepping time re-requests the asset, so the interval is slow enough that
  // requests do not pile up behind each other.
  useEffect(() => {
    if (!store.playing || store.mode !== 'superposition') return undefined
    const timer = window.setInterval(() => {
      store.setTimeAu(Number(((store.timeAu + 0.6) % 40).toFixed(3)))
    }, 420)
    return () => window.clearInterval(timer)
  }, [store, store.playing, store.mode, store.timeAu])

  const setRepresentation = (value: RepresentationKind) => store.setRepresentation(value)

  return (
    <aside className="panel controls-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">STATE LAB</span>
          <h2>Orbital controls</h2>
        </div>
        <button
          type="button"
          className="round-button"
          title="Restore 2pz defaults"
          onClick={() => store.applyPreset({ n: 2, l: 1, m: 0, z: 1, basis: 'real' })}
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="preset-strip">
        {presets.slice(0, 6).map((preset) => (
          <button
            type="button"
            key={preset.id}
            onClick={() => store.applyPreset(preset)}
            className={
              preset.n === store.orbital.n &&
              preset.l === store.orbital.l &&
              preset.m === store.orbital.m &&
              preset.basis === store.orbital.basis
                ? 'preset active'
                : 'preset'
            }
          >
            {preset.label}
          </button>
        ))}
      </div>

      <section className="control-section">
        <div className="section-title"><Atom size={15} /> Quantum numbers</div>
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
              min={0.1}
              max={20}
              step={0.1}
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
              onClick={() => store.setOrbital({ basis })}
            >
              {basis === 'real' ? 'Real / chemistry' : 'Complex / Lz'}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-title"><Clock size={15} /> State kind</div>
        <div className="representation-switch">
          <button
            type="button"
            className={store.mode === 'eigenstate' ? 'active' : ''}
            onClick={() => store.setMode('eigenstate')}
          >
            <Atom size={17} /> Eigenstate
          </button>
          <button
            type="button"
            className={store.mode === 'superposition' ? 'active' : ''}
            title="Analytic time-dependent superposition of eigenstates"
            onClick={() => store.setMode('superposition')}
          >
            <Clock size={17} /> Superposition
          </button>
        </div>

        {store.mode === 'superposition' ? (
          <>
            <div className="mixture-list">
              {mixtures.map((mixture) => (
                <button
                  key={mixture.id}
                  type="button"
                  title={mixture.note}
                  className={`preset${store.superpositionTerms === mixture.terms ? ' active' : ''}`}
                  onClick={() => store.setSuperposition(mixture.terms, mixture.label)}
                >
                  {mixture.label}
                </button>
              ))}
            </div>
            <RangeRow
              label="Time"
              value={store.timeAu}
              min={0}
              max={40}
              step={0.2}
              suffix=" a.u."
              onChange={store.setTimeAu}
            />
            <button
              type="button"
              className="toggle-row"
              onClick={() => store.setPlaying(!store.playing)}
            >
              {store.playing ? <Pause size={15} /> : <Play size={15} />}
              <span>Evolve in time</span>
              <span className={store.playing ? 'switch on' : 'switch'} />
            </button>
          </>
        ) : null}
      </section>

      <section className="control-section">
        <div className="section-title"><Layers3 size={15} /> Representation</div>
        <div className="representation-switch">
          <button
            type="button"
            className={store.representation === 'point_cloud' ? 'active' : ''}
            onClick={() => setRepresentation('point_cloud')}
          >
            <Cloud size={17} /> Electron cloud
          </button>
          <button
            type="button"
            className={store.representation === 'isosurface' ? 'active' : ''}
            disabled={!surfaceAvailable}
            title={surfaceAvailable ? 'Render a validated density isosurface' : 'Isosurfaces are validated for n ≤ 4'}
            onClick={() => setRepresentation('isosurface')}
          >
            <Layers3 size={17} /> Density surface
          </button>
          <button
            type="button"
            className={store.representation === 'streamlines' ? 'active' : ''}
            disabled={!currentAvailable}
            title={
              currentAvailable
                ? 'Probability-flow streamlines (not electron trajectories)'
                : 'Stationary current is zero unless the basis is complex and m ≠ 0'
            }
            onClick={() => setRepresentation('streamlines')}
          >
            <Waves size={17} /> Probability flow
          </button>
        </div>

        {store.representation === 'point_cloud' ? (
          <>
            <RangeRow label="Samples" value={store.samples} min={4000} max={80000} step={2000} onChange={store.setSamples} />
            <RangeRow label="Point size" value={store.pointSize} min={1.5} max={7} step={0.1} onChange={store.setPointSize} />
          </>
        ) : store.representation === 'streamlines' ? (
          <RangeRow label="Seeds" value={store.seedCount} min={8} max={160} step={8} onChange={store.setSeedCount} />
        ) : (
          <>
            <RangeRow label="Grid" value={store.resolution} min={minimumResolution} max={81} step={8} onChange={store.setResolution} />
            <RangeRow label="Mass" value={Math.round(store.probabilityMass * 100)} min={50} max={99} step={1} suffix="%" onChange={(value) => store.setProbabilityMass(value / 100)} />
          </>
        )}
        <RangeRow label="Opacity" value={Math.round(store.opacity * 100)} min={25} max={100} step={1} suffix="%" onChange={(value) => store.setOpacity(value / 100)} />
        <RangeRow label="Exposure" value={Math.round(store.exposure * 100)} min={50} max={140} step={2} suffix="%" onChange={(value) => store.setExposure(value / 100)} />
        <RangeRow label="Fog" value={Math.round(store.fogStrength * 100)} min={0} max={70} step={2} suffix="%" onChange={(value) => store.setFogStrength(value / 100)} />
        <RangeRow label="Bloom" value={Math.round(store.bloom * 100)} min={0} max={50} step={1} suffix="%" onChange={(value) => store.setBloom(value / 100)} />
      </section>

      <section className="control-section compact">
        <button type="button" className="toggle-row" onClick={() => store.setAutoRotate(!store.autoRotate)}>
          {store.autoRotate ? <Pause size={15} /> : <Play size={15} />}
          <span>Auto rotate</span>
          <span className={store.autoRotate ? 'switch on' : 'switch'} />
        </button>
        <button type="button" className="toggle-row" onClick={() => store.setShowGrid(!store.showGrid)}>
          <Layers3 size={15} />
          <span>Reference grid</span>
          <span className={store.showGrid ? 'switch on' : 'switch'} />
        </button>
      </section>
    </aside>
  )
}
