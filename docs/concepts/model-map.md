# 量子可视化模型地图

“1D/2D/3D”“定态/含时”“轨道/电子云”“采样/流形”属于不同分类轴。先把它们拆开，才能设计可扩展接口。

## 五个正交分类轴

| 轴 | 典型选项 | 它决定什么 |
|---|---|---|
| 配置空间 | $\mathbb R$、$\mathbb R^2$、$\mathbb R^3$、$\mathbb R^{3N}$ | 状态自变量和数值成本 |
| 方程 | TISE、TDSE、开放系统 | 状态如何求解或演化 |
| 坐标/基 | Cartesian、spherical、parabolic、能量基、实/复球谐 | 表达效率与标签，不自动改变物理态 |
| observable | $\psi$、$|\psi|^2$、相位、$\mathbf j$、期望值、约化密度 | 图中到底是什么量 |
| representation | 曲线、热图、切片、等值面、体渲染、点样本、流线 | 如何把量映射到视觉 |

同一个 3D 定态可以同时产生径向曲线、二维切片、三维等值面和 Monte Carlo 点云；同一张三维图也可能来自解析态、数值态或实验反演。视觉维度不能代替模型说明。

## 从物理到画面的最小记录

```text
State specification
  ├─ equation / Hamiltonian / boundary conditions
  ├─ coordinates, basis, units, normalization
  └─ source or numerical provenance
        ↓
Observable
  ├─ mathematical definition
  └─ discretization / estimator / uncertainty
        ↓
Representation
  ├─ sampling or geometry algorithm
  ├─ thresholds, truncation, resolution
  └─ color and opacity meaning
        ↓
Measurement model (optional)
```

## 原子轨道与化学视角的位置

氢样 $Y_\ell^m$、实 $p_x/p_y/p_z$、$sp^3$ 和分子轨道不是四种互不相干的物理定律：

- 复球谐是 $L_z$ 的标准本征基；
- 实轨道是简并 $m$ 子空间内的实线性组合；
- 杂化轨道是选定原子轨道子空间内的局域定向基；
- 分子轨道通常是多中心基函数的线性组合。

所以 UI 必须显示 basis 与系数，不能只显示一个化学昵称。

## 采样对象的几何

| 目标 | 测度 | 合适方法示例 |
|---|---|---|
| 单电子位置 | $|\psi|^2d^3r$ | 分离逆 CDF、拒绝采样、MCMC |
| 多电子构型 | $|\Psi|^2d^{3N}R$ | VMC、MALA/HMC、SMC、flow proposal |
| 角变量 | $|Y|^2d\Omega$ on $S^2$ | 球面 CDF、球面 MCMC |
| 密度等值面 | 面积测度 on $\rho=c$ | marching cubes 后的三角面面积采样 |
| 节点流形 | $\psi=0$ 的约束集合 | continuation、implicit-manifold 方法 |

这张表防止把“在流形上采样”泛化成所有电子云问题的默认答案。
