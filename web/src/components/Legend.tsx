import type { SceneStatus } from '../api/types'

export function Legend({ status }: { status: SceneStatus }) {
  const basis = status.metadata?.state.basis
  const representation = status.metadata?.representation
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
