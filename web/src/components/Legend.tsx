import { useSceneStore } from '../state/useSceneStore'

export function Legend() {
  const { orbital, representation } = useSceneStore()
  return (
    <div className="legend">
      <div className="legend-title">Wavefunction phase</div>
      {orbital.basis === 'real' ? (
        <div className="real-legend">
          <span><i className="phase-dot cyan" /> phase 0</span>
          <span><i className="phase-dot violet" /> phase π</span>
        </div>
      ) : (
        <>
          <div className="phase-wheel" />
          <div className="phase-labels"><span>−π</span><span>0</span><span>π</span></div>
        </>
      )}
      <p>
        {representation === 'point_cloud'
          ? 'Point positions are samples from |ψ|²d³r. Brightness is local density.'
          : 'Geometry is a |ψ|² level set; color carries phase.'}
      </p>
    </div>
  )
}
