export function LoadingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="loading-overlay">
      <div className="loader-orbit"><i /><i /><i /></div>
      <strong>正在构建量子场</strong>
      <span>采样 · 网格构建 · GPU 上传</span>
    </div>
  )
}
