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

若把电离与传播合并成作用于振幅的前向算子，一个**示意性**探测器模型可以写成：

$$
I(\mathbf R)
=
\left(\left|\mathcal M[\psi]\right|^2*\mathrm{PSF}\right)(\mathbf R)
+\epsilon(\mathbf R),
$$

其中 $\mathcal M$ 包含电离、传播和从原子坐标到探测器坐标的映射，$*$ 表示卷积，PSF 表示探测器点扩散函数。这个式子只用来说明层次，不是所有实验的通用噪声模型；真实计数还可能服从 Poisson 统计，背景、效率与仪器响应也必须按具体装置建模。

## QuViz 中的建模边界

`MeasurementModel` 位于量子态和探测器 observable 之间，而不是位于 `Renderer` 之后。两条链路应明确分开：

```text
QuantumState ───────────────────→ direct observable ─┐
QuantumState → MeasurementModel → detector observable ├→ Representation → SceneContract → Renderer
                                                     ┘
```

- 原空间的 $|\psi(\mathbf r)|^2$ 是一个 observable；
- 探测器上的 $I(\mathbf R)$ 是经过实验算子的观测；
- 在 Stodolna 等人的特定氢 Stark / 光电离显微条件下，近核波函数沿束缚抛物坐标的节点数会保留到远场投影；这不是任意 measurement operator 都保持节点拓扑的一般定理；
- 即使节点得到映射，原空间密度与探测器强度也不能逐像素等同；
- 实验复现应同时展示理想态、前向模型和探测器结果。

论文的摘要、实验布局与结果讨论分别说明了这一坐标特定的节点映射、二维探测器和 TDSE 对照 [@stodolna2013stark, pp. 213001-1--213001-4, especially Figs. 2--3]。这一边界能避免将任何漂亮的实验图误标成“轨道本身”。
