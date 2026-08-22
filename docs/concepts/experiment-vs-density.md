# 实验图样与概率密度

Stodolna 等人的光电离显微实验观察到外电场中氢原子 Stark 态的节点结构 [@stodolna2013stark]。这是一项重要的波函数结构实验，但不能简化成“相机直接拍到了自由氢原子的三维电子云”。

实验链路更接近：

$$
\text{state preparation}
\rightarrow
\text{Stark state}
\rightarrow
\text{photoionization}
\rightarrow
\text{continuum propagation}
\rightarrow
\text{detector intensity}.
$$

因此探测器图样应写成：

$$
I(\mathbf R)=\left|\mathcal M[\psi](\mathbf R)\right|^2*\mathrm{PSF}+\epsilon,
$$

其中 $\mathcal M$ 包含电离、传播和坐标映射，PSF 表示探测器点扩散函数。

## QuViz 中的建模边界

`MeasurementModel` 必须是 `Renderer` 之后的独立层：

- 原空间的 $|\psi(\mathbf r)|^2$ 是一个 observable；
- 探测器上的 $I(\mathbf R)$ 是经过实验算子的观测；
- 二者可以共享节点拓扑，却不能逐像素等同；
- 实验复现应同时展示理想态、前向模型和探测器结果。

这一边界能避免将任何漂亮的实验图误标成“轨道本身”。
