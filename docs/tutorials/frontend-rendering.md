# 3D 前端渲染

QuViz 的前端目标不是“加一个 Three.js 画布”，而是让科学数据在 GPU 上保持清晰、层次和可解释性。

## 技术栈

- React + TypeScript：页面、状态和组件边界；
- Vite：开发服务器与生产构建；
- React Three Fiber：React 与 Three.js 场景桥接；
- Drei：相机控制、网格与辅助组件；
- Three.js `BufferGeometry`：连续顶点、索引和自定义 attribute；
- `ShaderMaterial`：点云 soft sprite、相位色轮和密度透明度；
- react-postprocessing：克制使用 Bloom、SMAA 和 Vignette。

Three.js 的 `BufferGeometry` 将位置、法向、颜色及自定义属性存入 GPU buffer，适合数万到数十万点的电子云 [@threejs]。React Three Fiber 的 `Canvas` 负责 renderer、scene、camera 和 React 生命周期 [@react-three-fiber]。

## “漂亮”来自四层设计

### 1. 几何层

- 点云使用 `THREE.Points`，不要为每个电子点创建 sphere mesh；
- 等值面使用 indexed geometry；
- 节点面和概率流作为独立 layer；
- 大数据使用 Float32 binary transport，避免巨大 JSON。

### 2. 材质层

点云 shader：

- `gl_PointCoord` 生成圆形 soft sprite；
- 点大小随透视衰减；
- intensity 控制亮度与 alpha；
- phase 控制周期色相；
- 关闭不必要的深度写入以减少透明点云的硬切片。

等值面：

- 密度几何和相位颜色分开；
- 使用透明 PBR + Fresnel rim；
- 真实法向来自 marching cubes；
- 正负实相位使用两端色，相位连续态使用色轮。

### 3. 场景层

- 深蓝黑背景而不是纯黑；
- 轻微雾化提供深度；
- 坐标网格保持低对比度；
- 主物体居中，自动按 bounding sphere fit camera；
- 自动旋转必须可关闭，并且只旋转相机/对象，不改变态。

### 4. 信息层

始终显示：

- 轨道标签与 $n,\ell,m$；
- real/complex basis；
- 当前 observable 和 representation；
- 单位与归一化；
- 点数或网格分辨率；
- 截断概率或包围概率；
- 相位图例与引用键。

## 性能预算

| 资产 | 首版预算 | 扩展策略 |
|---|---:|---|
| 点云 | 20k–80k 点 | LOD、worker、二进制流 |
| 等值面 | 10k–150k triangles | decimation、GLB/Draco |
| 标量体 | $64^3$ | 3D texture + ray marching |
| 流线 | 200–2000 条 | GPU integration / WebGPU |

## WebGL 与 WebGPU

首版坚持 WebGL 2，以获得稳定兼容性。WebGPU 适合后续的体渲染、流线积分和 GPU sampling，但不应让基础功能依赖实验性能力。前端通过 renderer adapter 保留升级路径。

## 反例

- 用彩虹色表示实数大小，却不标明相位；
- 对每个点加很强 Bloom，造成节点被光晕填平；
- 透明等值面前后排序错误，导致假结构；
- 为了“更饱满”而非线性移动点的位置；
- 不同轨道使用不同自动尺度却假装能比较物理大小；
- 把点云慢速旋转描述成电子运动。
