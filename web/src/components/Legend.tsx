import type { ReactElement } from 'react'

import type { SceneStatus, SliceObservable } from '../api/types'

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
  phase: 'Wavefunction phase',
  wavefunction_real: 'Re ψ on the plane',
  wavefunction_imag: 'Im ψ on the plane',
  probability_density: 'Probability density',
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
          Transparent texels are masked: |ψ| below the threshold, where the phase is undefined
          {' — not nodes. '}
          {amountWithUnit((status.phaseMaskedFraction ?? Number.NaN) * 100, '%', '')} of this plane
          is masked.
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
          A = {extreme}, the largest |value| on this plane; colour is linear in the signed value and
          normalised to it, so cyan and red are equal amplitudes of opposite sign.
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
          max = {extreme}; brightness proportional to |ψ|/max|ψ| (square root of density), not to
          the density itself.
        </p>
      </>
    )
  }

  // No ramp is drawn for an observable that was never reported: a legend that
  // guessed one would name a colour scheme the texture may not be using.
  return <p>This slice reported no observable, so its colours cannot be named.</p>
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
        <div className="legend-title">Nothing drawn</div>
        <p>
          <strong>{status.unavailable.kind}</strong> is not available for this state.{' '}
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
            ? 'Plane section'
            : SLICE_TITLES[status.sliceObservable]}
        </div>
        {sliceKey(status)}
        <p>
          Sampled on the {status.plane ?? 'unreported'} plane through the origin; nearest-sample
          colour, no interpolation.
        </p>
      </div>
    )
  }

  if (representation === 'streamlines') {
    return (
      <div className="legend">
        <div className="legend-title">Probability flow speed</div>
        <div className="speed-ramp" />
        <div className="phase-labels">
          <span>0</span>
          <span>
            {status.maxSpeed !== undefined ? `${status.maxSpeed.toPrecision(3)} a.u.` : 'max'}
          </span>
        </div>
        <p>
          Streamlines of <strong>j</strong>/ρ, evenly spaced in arc length; colour is speed, not
          phase. These are probability-flow lines, not electron trajectories.
        </p>
      </div>
    )
  }

  return (
    <div className="legend">
      <div className="legend-title">Wavefunction phase</div>
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
          ? 'Positions sample |ψ|²d³r; every marker has equal visual weight.'
          : representation === 'isosurface'
            ? 'Geometry is a |ψ|² level set; color carries phase.'
            : 'Waiting for asset metadata.'}
      </p>
    </div>
  )
}
