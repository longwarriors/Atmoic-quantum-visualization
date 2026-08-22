# 开发路线图

QuViz 按科学依赖关系推进：先定义状态和 observable，再决定离散化与 representation，最后才优化视觉效果。每个里程碑都必须同时满足公式、数值、契约和视觉四类验收。

## M0R：修复解析轨道基线（当前）

- 让 Python lint、format、mypy、pytest、文档和前端构建全部通过；
- 修复等值面节面融合、分辨率、质量估计和法向；
- 重写点云曝光、相机 fit、相位图例与警告显示；
- 让点云和等值面都消费同一份语义完整的 metadata；
- 把本次审计脚本转成可重复的几何、统计和视觉测试。

完成标准不是“能打开页面”，而是 1s、2p、3d、含径向节点态和复基相位都通过独立验证。

## M1：解析叠加态与时间演化

先处理有限个已知本征态的叠加：

$$
\Psi(\mathbf r,t)=\sum_k c_k\psi_k(\mathbf r)e^{-iE_kt/\hbar}.
$$

交付 $|\Psi|^2$、相位、$\mathbf j$ 和 continuity residual；流线只标为概率输运，不标为实验电子轨迹 [@griffiths2018qm; @science-asylum2020-orbitals]。

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
