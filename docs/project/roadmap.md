# 开发路线图

QuViz 按科学依赖关系推进：先定义状态和 observable，再决定离散化与 representation，最后才优化视觉效果。每个里程碑都必须同时满足公式、数值、契约和视觉四类验收。

## M0R：修复解析轨道基线（2026-08-23 完成）

- 让 Python lint、format、mypy、pytest、文档和前端构建全部通过；
- 修复等值面节面融合、分辨率、质量估计和法向；
- 重写点云曝光、相机 fit、相位图例与警告显示；
- 让点云和等值面都消费同一份语义完整的 metadata；
- 把本次审计脚本转成可重复的几何、统计和视觉测试。

已完成工程门禁、1s 密度阈值、2p 节点连通性、3p 径向/角向节点、网格质量、面绕向、复基完整相位周期，以及前端相位和相机复核。自动截图回归继续作为 M1 前的加固项，而不据此扩大当前 $n\le4$ 的声明范围。

## M1：解析叠加态与时间演化（2026-08-23 完成）

先处理有限个已知本征态的叠加：

$$
\Psi(\mathbf r,t)=\sum_k c_k\psi_k(\mathbf r)e^{-iE_kt/\hbar}.
$$

交付 $|\Psi|^2$、相位、$\mathbf j$ 和 continuity residual；流线只标为概率输运，不标为实验电子轨迹 [@griffiths2018qm; @science-asylum2020-orbitals]。

演化是**解析**的：每一项只乘一个相位因子，没有时间步进，因此不存在传播误差需要报告。这也是把它排在数值 TDSE（M2）之前的原因——先有一个精确解作为后续求解器的基准。

三个独立判据钉住实现，没有一个是对实现的复述：

1. **1s–2p Bohr 振荡。** 对 $(\psi_{100}+\psi_{210})/\sqrt2$，偶极为

    $$
    \langle z\rangle(t)=\frac{2^7\sqrt2}{3^5}\cos\omega t,
    \qquad \omega=E_2-E_1=\tfrac38\ \text{hartree},
    $$

    振幅 $128\sqrt2/243\approx0.744937\,a_0$ 就是教科书里的 1s–2p 跃迁偶极矩。

2. **简并negative control。** 氢的能量只依赖 $n$，所以 2s + 2p 叠加的密度**根本不动**。任何让它动起来的画面都是 bug，UI 会为这类态显示 stationary 警告。

3. **连续性。** $\partial\rho/\partial t+\nabla\cdot\mathbf j=0$ 此时不再退化——变异测试显示，把时间因子整体写成 $e^{+iEt}$（自洽的时间反演）**只有连续性残差这一个测试**能抓住。

尚未交付：叠加态的点云采样。一般线性组合需要对完整密度做校正采样，属于 M5，本里程碑不假装已经解决。

## M2：1D TISE / TDSE 数值实验室

- 有限势阱、谐振子、势垒与隧穿；
- 明确 Dirichlet/periodic 边界与网格收敛；
- Crank--Nicolson 和 split-operator/spectral 路径；
- 范数、能量与连续性残差随时间展示 [@crank1947; @feit1982-spectral]。

局部 stencil 可以用数组切片、卷积或稀疏算子表达，但任何加速倍数都必须在 QuViz 自己的尺寸、边界和硬件上 benchmark。教学博客只提供优化思路，不提供性能结论 [@mocquin2022-fdm; @numpy-sliding-window]。

## M3：2D、径向与受控 3D 求解

顺序为 2D 波包/双缝/散射、球对称径向 Coulomb，再到确有必要的 3D Cartesian 网格。每一步都要求盒长、分辨率、吸收边界和收敛报告；不以更大的网格掩盖错误的边界条件。

## M4：对称性、杂化与分子轨道

- 机器可读点群与特征标表，自动检查群阶、类顺序和正交关系；
- 投影算符、SALC、$sp$、$sp^2$、$sp^3$；
- 明确基变换、局域化轨道与 observable 的区别；
- 导入 Gaussian Cube 等体数据，记录来源程序、基组和单位。

## M5：高维采样与多电子 observable

- 单一可分离态继续使用逆 CDF；
- 线性组合使用完整密度的校正采样；
- 数值场研究 alias、MALA/HMC、SMC 与 flow proposal；
- 多电子态在 $\mathbb R^{3N}$ 采样，再约化为一体密度、pair correlation 等可视 observable。

“流形采样”不是 Born 体密度采样的通用替代品。它适用于 $S^2$ 角变量、节点面、等值面或显式约束流形；普通三维电子位置仍然分布在体积测度上。

## M6：实验前向模型

把态、实验算子和探测器分开：

$$
I(\mathbf R)=|\mathcal M[\Psi](\mathbf R)|^2*\operatorname{PSF}+\epsilon.
$$

首个案例可复现 Stark 态光电离显微成像的节点映射，但不得把二维探测器投影描述成自由氢原子的三维密度照片 [@stodolna2013stark]。
