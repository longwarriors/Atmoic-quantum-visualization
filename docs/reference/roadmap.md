# 开发路线图

QuViz 不按“能画多少种轨道”扩张，而按 **状态 → observable → representation → measurement** 的能力层递进。每一阶段都必须先建立数学契约和验证，再增加视觉效果。

## Phase 0：解析氢与类氢轨道（当前版本）

已实现：

- 任意合法 $(n,\ell,m)$ 的解析波函数；
- 实球谐与复球谐；
- 概率密度、相位和定态概率流；
- 径向/角向分离的独立逆 CDF 采样；
- 固定绝对包围概率的等值面；
- 点云与 indexed mesh 的浏览器渲染；
- 物理约定、资料审查和引用索引。

验收核心是归一化、节点位置、角向方向、采样矩和 Scene Contract，而不是截图相似度。

## Phase 1：解析时间演化与概率流

首先实现有限本征态叠加：

$$
\Psi(\mathbf r,t)
=
\sum_k c_k\psi_k(\mathbf r)e^{-iE_kt/\hbar}.
$$

目标：

- 可视化 Bohr 频率与干涉项；
- 同时显示 $|\Psi|^2$、相位和 $\mathbf j$；
- 用 continuity residual 检查
  $\partial_t\rho+\nabla\cdot\mathbf j=0$；
- 将概率流线标注为输运可视化，不冒充实验轨迹。

## Phase 2：通用 TISE / TDSE 数值求解

从一维开始，再进入二维，最后处理真正需要三维网格的问题：

1. 1D 有限差分 TISE；
2. Crank--Nicolson 与 split-operator FFT；
3. 2D 波包、隧穿、双缝与散射；
4. 吸收边界和范数/能量监控；
5. 球对称径向 Coulomb 求解；
6. 经收敛审查后才开放 3D Cartesian 求解。

qmsolve 可作为交互和示例参考，但网格间距、Coulomb 原点与简并态标记必须由 QuViz 自己的契约控制 [@qmsolve]。

## Phase 3：对称性、杂化与分子轨道

- 点群和特征标表的机器可读导入；
- 表示正交性与投影算符测试；
- SALC 与 $sp$、$sp^2$、$sp^3$；
- 明确“基变换”“局域轨道”和“可观测量”的区别；
- Gaussian Cube / volumetric molecular-orbital 数据；
- 多中心网格与固定包围概率比较。

## Phase 4：高效采样与多电子扩展

按问题结构选择方法：

- 可分离态：逆 CDF；
- 少量轨道叠加：混合提议拒绝采样；
- 数值波函数：自适应重要性采样、MALA/HMC/SMC；
- 多电子态：在 $\mathbb R^{3N}$ 配置空间采样，再计算一体密度与 pair correlation；
- 节点面、等值面和 $S^2$：单独提供真正的流形采样模块。

任何 MCMC 展示都必须报告 ESS、链间诊断和 nodal-pocket mixing，不能只展示看起来均匀的点云。

## Phase 5：实验前向模型

将实验图样与状态本体解耦：

$$
I(\mathbf R)
=
\left|\mathcal M[\Psi](\mathbf R)\right|^2 * \operatorname{PSF}.
$$

第一案例可以复现氢原子 Stark 态的光电离显微成像逻辑，而不是把探测器图样误称为原空间三维密度照片 [@stodolna2013stark]。

## 前端演进

| 阶段 | 渲染能力 | 推荐实现 |
|---|---|---|
| 当前 | 点云、等值面、相位着色 | WebGL 2 + R3F + custom shader |
| 下一步 | 切片、节点面、流线 | worker + indexed geometry |
| 体数据 | 体渲染、transfer function | 3D texture + ray marching |
| 大规模动态 | GPU 流线、GPU 采样 | WebGPU renderer adapter |
| 对比研究 | 多视口、同步相机、差分图 | shared scene state + linked cameras |

前端升级时，Scene Contract 保持稳定；渲染器可以替换，物理语义不能漂移。
