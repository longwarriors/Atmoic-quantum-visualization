import type { SceneStatus } from '../api/types'

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
