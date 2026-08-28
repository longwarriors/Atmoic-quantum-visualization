import type { ReactElement } from 'react'

import type { SceneStatus, SliceObservable } from '../api/types'
import { representationLabel } from './sceneStatus'

/** What an absent or non-finite number is shown as. Never "NaN", never a guess. */
const PLACEHOLDER = '—'

/**
 * A reported number with its unit, or the placeholder.
 *
 * Three significant figures, matching the streamline legend's `toPrecision(3)`:
 * a legend labels a ramp, and a ramp labelled to fifteen digits claims a
 * precision the eye cannot read off it.
 */
function amountWithUnit(value: number, unit: string, separator = ' '): string {
  if (!Number.isFinite(value)) return PLACEHOLDER
  const text = value.toPrecision(3)
  return unit === '' ? text : `${text}${separator}${unit}`
}

/**
 * The title of a slice legend, by the field the plane carries.
 *
 * Keyed on the SLICE observable, never on `metadata.observable`: the server
 * maps `wavefunction_real` and `wavefunction_imag` onto the single
 * `wavefunction` observable, so metadata cannot tell a real section from an
 * imaginary one, and a phase section's metadata observable is `phase` only by
 * coincidence of the same mapping. `Record<SliceObservable, string>` also makes
 * a fifth observable a compile error here rather than an unnamed picture.
 */
const SLICE_TITLES: Record<SliceObservable, string> = {
  phase: '波函数 phase',
  wavefunction_real: '平面上的 Re ψ',
  wavefunction_imag: '平面上的 Im ψ',
  probability_density: '概率密度 |ψ|²',
}

/**
 * The ramp, its labels and the sentence naming what the colour means, for one
 * slice observable.
 *
 * Each arm names the map `scene/sliceTexture.ts` actually applies -- the phase
 * wheel, the diverging map normalised by the plane's own extreme, the
 * sequential map through a square root -- so the legend cannot drift into
 * describing a colouring the renderer does not perform.
 */
function sliceKey(status: SceneStatus): ReactElement {
  const observable = status.sliceObservable
  const unit = status.sliceValueUnit ?? ''
  const extreme = amountWithUnit(status.sliceMaxAbsValue ?? Number.NaN, unit)

  if (observable === 'phase') {
    return (
      <>
        <div className="phase-wheel" />
        <div className="phase-labels"><span>−π</span><span>0</span><span>π</span></div>
        <p>
          透明 texel 属于 mask：|ψ| 低于阈值，此处 arg ψ 未定义；这不是节点。该平面有{' '}
          {amountWithUnit((status.phaseMaskedFraction ?? Number.NaN) * 100, '%', '')} 被 mask。
        </p>
      </>
    )
  }

  if (observable === 'wavefunction_real' || observable === 'wavefunction_imag') {
    return (
      <>
        <div className="diverging-ramp" />
        <div className="phase-labels"><span>−A</span><span>0</span><span>+A</span></div>
        <p>
          A = {extreme}，即该平面最大的 |value|；颜色对有符号 value 线性映射并按 A
          归一化，因此青色与红色表示等振幅、反符号。
        </p>
      </>
    )
  }

  if (observable === 'probability_density') {
    return (
      <>
        <div className="density-ramp" />
        <div className="phase-labels"><span>0</span><span>max</span></div>
        <p>
          max = {extreme}；亮度 ∝ |ψ|/max|ψ|，即概率密度的平方根，不与 density 本身成正比。
        </p>
      </>
    )
  }

  // No ramp is drawn for an observable that was never reported: a legend that
  // guessed one would name a colour scheme the texture may not be using.
  return <p>该切片没有报告 observable，因此无法为其颜色命名。</p>
}

/**
 * The legend must describe the asset actually on screen. Showing a phase wheel
 * over streamlines, whose colour encodes flow speed, would misname the one
 * thing the legend exists to name.
 */
export function Legend({ status }: { status: SceneStatus }) {
  const basis = status.metadata?.state.basis ?? status.superposition?.basis
  const representation = status.metadata?.representation ?? status.superposition?.representation

  if (status.unavailable !== undefined) {
    // Nothing is drawn, so there is no colour to name. The legend says which
    // representation was asked for and why it produced nothing -- a phase wheel
    // here would describe a picture that does not exist, and "Waiting for asset
    // metadata" would promise one that is not coming.
    return (
      <div className="legend">
        <div className="legend-title">无可绘制资产</div>
        <p>
          <strong>{representationLabel(status.unavailable.kind)}</strong> 对当前量子态不可用。{' '}
          {status.unavailable.reason}
        </p>
      </div>
    )
  }

  // BEFORE the streamlines chain, and therefore before the trailing branch it
  // falls through to: that branch is the isosurface/point-cloud legend, and a
  // slice reaching it is shown a phase wheel over whatever field the plane
  // actually carries -- a density labelled as an angle.
  if (representation === 'slice') {
    return (
      <div className="legend">
        <div className="legend-title">
          {status.sliceObservable === undefined
            ? '平面切片'
            : SLICE_TITLES[status.sliceObservable]}
        </div>
        {sliceKey(status)}
        <p>
          在过原点的 {status.plane ?? '未报告'} 平面采样；使用 nearest-sample 颜色，无插值。
        </p>
      </div>
    )
  }

  if (representation === 'streamlines') {
    return (
      <div className="legend">
        <div className="legend-title">概率流速率 |j|/ρ</div>
        <div className="speed-ramp" />
        <div className="phase-labels">
          <span>0</span>
          <span>
            {status.maxSpeed !== undefined ? `${status.maxSpeed.toPrecision(3)} a.u.` : 'max'}
          </span>
        </div>
        <p>
          <strong>j</strong>/ρ 的 streamlines 按弧长等距采样；颜色表示速率，不表示 phase。
          这些是概率流线，不是电子轨迹。
        </p>
      </div>
    )
  }

  return (
    <div className="legend">
      <div className="legend-title">波函数 phase</div>
      {basis !== 'complex' ? (
        <div className="real-legend">
          <span><i className="phase-dot red" /> phase 0</span>
          <span><i className="phase-dot cyan" /> phase π</span>
        </div>
      ) : (
        <>
          <div className="phase-wheel" />
          <div className="phase-labels"><span>−π</span><span>0</span><span>π</span></div>
        </>
      )}
      <p>
        {representation === 'point_cloud'
          ? '位置从 |ψ|²d³r 采样；每个 marker 具有相同视觉权重。'
          : representation === 'isosurface'
            ? '几何是 |ψ|² level set；颜色承载 phase。'
            : '等待 asset metadata。'}
      </p>
    </div>
  )
}
