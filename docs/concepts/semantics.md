# 可视对象语义

同一量子态可以产生完全不同的可视对象。QuViz 强制使用下表中的名称。

表中的 `observable` 是 Scene Contract 对“被画出的物理量”的软件分类；它比教材中“由 Hermitian 算符表示的可观测量”更宽。尤其是 $\psi$ 与 $\arg\psi$ 属于状态场及其派生量，不能因为进入了 `observable` 字段就称为可直接测量的经典场。

| 对象 | 数学定义 | 典型画法 | 禁止的解释 |
|---|---|---|---|
| 波函数 | $\psi(\mathbf r,t)\in\mathbb C$ | 实部、虚部、振幅、相位 | “概率本身” |
| 概率密度 | $\rho=\lvert\psi\rvert^2$ | 切片、体渲染、热图 | 忽略体积元 |
| 相位 | $\arg\psi$ | 周期性色相 | 线性色条 |
| 概率流 | $\mathbf j$ | 箭头、流线、流管 | 默认等同实测轨迹 |
| 等值面 | $\rho=c$、$\lvert\psi\rvert=c$、$\operatorname{Re}\psi=c$ 或 $\operatorname{Im}\psi=c$ | 三维网格 | 唯一的轨道边界 |
| 随机样本 | $\mathbf r_i\sim\lvert\psi\rvert^2d^3r$ | 点云 | 单电子的历史路径 |
| 概率流线 | $\rho>0$ 处 $\mathbf v=\mathbf j/\rho$ 的积分曲线 | 弧长等距折线，颜色表速度 | 电子的实测轨迹 |
| 实验图样 | $I=\lvert\mathcal M[\psi]\rvert^2$ | 探测器强度 | 原空间三维密度照片 |

对复波函数，$\psi=c$ 同时约束实部与虚部，一般是两个实方程的交集，不能不加说明地称为三维空间中的二维等值面。相位 $\arg\psi=c$ 还会遇到支切与 $\psi=0$ 处相位未定义的问题；因此 QuViz 的等值面几何以 $\rho=c$ 为主，实部、虚部和相位目前通过切片表达。

## Observable 与 representation 的正交关系

`probability_density + isosurface` 和 `wavefunction_real_part + isosurface` 是两种不同场景：

- 密度等值面永远非负，可以用相位作为附加颜色；
- 实部正/负等值面直接显示波函数符号，但并不表示包围概率；
- 点云天然编码概率密度，却不能单靠点的位置显示连续相位。

因此，前端的“显示模式”不能只是换材质；有些切换必须重新请求不同的科学资产。

当前已实现的 observable × representation 组合：

!!! note "这是 route 并集，不是全状态笛卡尔积"

    一个格子为 ✅ 只表示至少有一条 Phase 0 route 能返回该组合，不表示每种 state 都支持。
    point cloud 当前只支持单一解析氢样本征态；一般叠加态 point cloud 尚未实现。

| | point cloud | isosurface | streamlines | slice |
|---|---|---|---|---|
| `probability_density` | ✅ | ✅ | — | ✅ |
| `probability_current` | — | — | ✅ | — |
| `wavefunction_real` / `wavefunction_imag` | — | — | — | ✅ |
| `phase` | — | — | — | ✅ |

定态与含时叠加态使用**不同的 metadata 契约**（`OrbitalMetadata` vs `SuperpositionMetadata`）：叠加态没有单一 $(n,\ell,m)$，硬塞一个会让契约声称一个并非画面所示的态。系数与时刻是叠加态物理身份的一部分，因此是必填字段。

`slice` 已同时支持定态与解析含时叠加态，并把波函数实部、虚部、相位和概率密度作为不同标量场返回。相位切片中的 `valid_mask` 只标识低振幅、相位未定义的样本；它不是节点证书。当前尚未实现的是独立的**节面几何 representation**，不能把低振幅遮罩写成已经提取出的节点面。
