export function LoadingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="loading-overlay">
      <div className="loader-orbit"><i /><i /><i /></div>
      <strong>Computing quantum scene</strong>
      <span>sampling / meshing / GPU upload</span>
    </div>
  )
}
