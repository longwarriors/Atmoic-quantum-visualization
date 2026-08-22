<div class="hero" markdown>

# QuViz

**从薛定谔方程、波函数与概率流，到浏览器中的可信三维科学可视化。**

QuViz 将科学计算与前端渲染分开：Python 负责状态、observable、采样与验证；
React/Three.js 负责点云、等值面、相位和交互。任何图形都必须保留它所代表的物理量、
坐标约定、单位、归一化和来源键。

[开始运行](getting-started/installation.md){ .md-button .md-button--primary }
[查看真实状态](project/status.md){ .md-button }

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

当前科学内核已覆盖解析氢样轨道、实/复球谐、概率密度、相位、定态概率流和电子云独立采样。三维等值面与浏览器场景仍是有阻断缺陷的原型。1D/2D/3D TISE/TDSE、完整点群与 SALC、分子轨道、实验前向模型和多电子采样属于路线图，不是现有能力。

## 三条不可违反的原则

1. **物理对象和画法分离。** `probability_density` 不是 `isosurface`，前者是 observable，后者只是 representation。
2. **约定必须可追溯。** 球坐标角度、Condon–Shortley 相位、长度单位、归一化和截断概率都进入元数据。
3. **漂亮不能以失真为代价。** Bloom、透明度和相机运动只能改善阅读，不允许改变节点、尺度关系或概率含义。

## 为什么使用浏览器原生 3D

Python 可视化适合研究原型，但持续交互、GPU shader、响应式布局和可发布产品更适合 WebGL/WebGPU。
React Three Fiber 把 Three.js 场景纳入 React 的组件和状态体系，而 Three.js 的 `BufferGeometry`
可以直接消费 Python 返回的连续 Float32 数据 [@react-three-fiber; @threejs]。

## 从哪里开始

- [愿景与边界](project/vision.md)：长期问题域与不可混淆的概念；
- [当前状态](project/status.md)：逐项实现、验证与缺陷账本；
- [量子可视化模型地图](concepts/model-map.md)：维度、动力学、observable 和 representation；
- [用户提供资料审计](references/source-audit.md)：逐条材料判定；
- [开发路线图](project/roadmap.md)：按科学依赖关系排序的里程碑。
