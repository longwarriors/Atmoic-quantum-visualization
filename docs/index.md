<div class="hero" markdown>

# QuViz

**从薛定谔方程、波函数与概率流，到浏览器中的可信三维科学可视化。**

QuViz 将科学计算与前端渲染分开：Python 负责状态、observable、采样与验证；
React/Three.js 负责点云、等值面、相位和交互。任何图形都必须保留它所代表的物理量、
坐标约定、单位、归一化和来源键。

[开始运行](getting-started/installation.md){ .md-button .md-button--primary }
[理解架构](concepts/architecture.md){ .md-button }

</div>

## 项目目标

QuViz 不是“轨道图片生成器”，而是一套可扩展的量子可视化实验平台：

$$
\boxed{
\text{Quantum State}
\rightarrow
\text{Observable}
\rightarrow
\text{Representation}
\rightarrow
\text{Renderer}
\rightarrow
\text{Measurement Model}
}
$$

第一阶段提供解析氢与类氢轨道、电子云独立采样、概率密度等值面、实/复球谐基和概率流。
后续可扩展到一维/二维/三维 TISE、TDSE、杂化轨道、分子轨道、实验前向模型和多电子量子蒙特卡洛。

## 三条不可违反的原则

1. **物理对象和画法分离。** `probability_density` 不是 `isosurface`，前者是 observable，后者只是 representation。
2. **约定必须可追溯。** 球坐标角度、Condon–Shortley 相位、长度单位、归一化和截断概率都进入元数据。
3. **漂亮不能以失真为代价。** Bloom、透明度和相机运动只能改善阅读，不允许改变节点、尺度关系或概率含义。

## 为什么使用浏览器原生 3D

Python 可视化适合研究原型，但持续交互、GPU shader、响应式布局和可发布产品更适合 WebGL/WebGPU。
React Three Fiber 把 Three.js 场景纳入 React 的组件和状态体系，而 Three.js 的 `BufferGeometry`
可以直接消费 Python 返回的连续 Float32 数据 [@react-three-fiber; @threejs]。

## 当前可运行能力

- 任意合法 $n,\ell,m$ 的解析氢样轨道；
- chemistry-friendly 实球谐与标准复球谐；
- 基于径向/角向分离的独立电子云采样；
- 固定包围概率的密度等值面；
- GPU 相位着色点云与网格；
- FastAPI 科学数据服务；
- `uv`、`src` 布局、pytest、Ruff、mypy；
- MkDocs Material 教程、API 文档和 BibTeX 引用索引。
