<div class="hero" markdown>

# QuViz

**从薛定谔方程、波函数与概率流，到浏览器中的可信三维科学可视化。**

QuViz 将科学计算与前端渲染分开：Python 负责状态、observable、采样与验证；
React/Three.js 负责点云、等值面、相位和交互。任何图形都必须保留它所代表的物理量、
坐标约定、单位、归一化和来源键。

[Phase 0 教程](tutorials/phase-0-walkthrough.md){ .md-button .md-button--primary }
[安装与启动](getting-started/installation.md){ .md-button }
[查看真实状态](project/status.md){ .md-button }

</div>

## 项目目标

QuViz 不是“轨道图片生成器”，而是一套可扩展的量子可视化实验平台：

$$
\boxed{
\text{Quantum State}
\rightarrow
\begin{cases}
\text{intrinsic observable},\\
\text{Measurement Model}\rightarrow\text{detector observable}
\end{cases}
\rightarrow
\text{Representation}
\rightarrow
\text{Renderer}
}
$$

密度、相位和概率流可以直接作为内禀 observable；与探测器图样比较时，measurement model
必须先把量子态映射为探测器 observable，再进入 representation 和 renderer。渲染后的图片
不能反过来充当测量模型。

当前 Alpha 基线覆盖解析氢样轨道、实/复球谐、概率密度、相位、定态与解析含时叠加态概率流、单一可分离态的独立采样、$\psi$/相位平面切片，以及受验证范围约束的三维等值面和浏览器场景。1D/2D/3D TISE/TDSE、一般叠加态与多电子采样、完整点群与 SALC、分子轨道和实验前向模型仍属于路线图。

## 三条不可违反的原则

1. **物理对象和画法分离。** `probability_density` 不是 `isosurface`，前者是 observable，后者只是 representation。
2. **约定必须可追溯。** 球坐标角度、Condon–Shortley 相位、长度单位、归一化和截断概率都进入元数据。
3. **漂亮不能以失真为代价。** Bloom、透明度和相机运动只能改善阅读，不允许改变节点、尺度关系或概率含义。

## 为什么使用浏览器原生 3D

Python 可视化适合研究原型，但持续交互、GPU shader、响应式布局和可发布产品更适合 WebGL/WebGPU。
React Three Fiber 把 Three.js 场景纳入 React 的组件和状态体系，而 Three.js 的 `BufferGeometry`
可以直接消费 Python 返回的连续 Float32 数据 [@react-three-fiber; @threejs]。

## 从哪里开始

- [Phase 0 交互工作流](tutorials/phase-0-walkthrough.md)：按当前界面复现点云、等密度面、切片、概率流与解析含时叠加态；
- [安装与启动](getting-started/installation.md)：从锁文件复现开发模式或单服务预览；
- [愿景与边界](project/vision.md)：长期问题域与不可混淆的概念；
- [当前状态](project/status.md)：逐项实现、验证与缺陷账本；
- [量子可视化模型地图](concepts/model-map.md)：维度、动力学、observable 和 representation；
- [HTTP API](reference/api.md) 与 [Python API](reference/physics-api.md)：端点契约和 Phase 0 公共模块；
- [用户提供资料审计](references/source-audit.md)：逐条材料判定；
- [开发路线图](project/roadmap.md)：按科学依赖关系排序的里程碑。
