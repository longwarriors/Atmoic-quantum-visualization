# 氢与类氢轨道

## 总公式

QuViz 使用：

$$
\boxed{
\psi_{n\ell m}(r,\theta,\phi)
=
\left(\frac{2Z}{na_\mu}\right)^{3/2}
\sqrt{\frac{(n-\ell-1)!}{2n(n+\ell)!}}
 e^{-\rho/2}\rho^\ell
 L_{n-\ell-1}^{2\ell+1}(\rho)
 Y_\ell^m(\theta,\phi)
}
$$

其中：

$$
\sigma=\frac{Zr}{a_\mu},
\qquad
\rho=\frac{2\sigma}{n}=\frac{2Zr}{na_\mu}.
$$

归一化总式采用 Griffiths 的氢原子波函数形式，并把普通 Bohr 半径替换为约化质量尺度 $a_\mu$ [@griffiths2018qm, eq. (4.89), p. 151]。广义 Laguerre 多项式和球谐函数分别由 SciPy 的当前 API 计算 [@scipy-eval-genlaguerre; @scipy-sph-harm-y]；多项式与球谐的约定分别对照 DLMF 18.5.12 与 14.30.1 [@dlmf-laguerre, eq. 18.5.12; @dlmf-spherical-harmonics, eq. 14.30.1]。

## 节点计数

径向节点数与角向基选择无关：

$$
N_{\mathrm{radial}}=n-\ell-1.
$$

在常见的实球谐（tesseral）基中，若按独立节点面计数，则：

$$
N_{\mathrm{angular}}=\ell,
\qquad
N_{\mathrm{total}}=n-1.
$$

复基 $Y_\ell^m\propto P_\ell^{|m|}(\cos\theta)e^{im\phi}$ 的 $e^{im\phi}$ 没有零点；实基中的方位节点面在复基中表现为相位绕转。因此后两个计数不能脱离 `basis` 当成相同的节点面拓扑 [@dlmf-spherical-harmonics, §14.30]。

节点计数是高价值回归测试。图像看起来“像”并不够；错误的径向多项式通常会把节点放到错误半径。

!!! tip "节点直觉：先看拓扑，再回到方程"

    从一维驻波过渡到三维节点，是理解常见实 $s/p/d$ 外观的一条有效教学路线：在固定 $n$ 下，把节点面分成径向与角向两类，再观察零点集合如何分割空间。FloatHeadPhysics 的动画在 13:29--24:08 对这条路线给出了清晰演示 [@floatheadphysics2025-orbitals, 13:29--24:08]。

    但“角节点”不等于“平面节点”。例如：

    $$
    Y_2^0\propto 3\cos^2\theta-1
    $$

    的两个角节点满足 $\cos\theta=\pm1/\sqrt3$，是圆锥面；因此 $d_{z^2}$ 呈两瓣加环，而不是四瓣。节点的数量和位置必须由球谐函数与径向函数决定，不能由切蛋糕类比直接推出 [@dlmf-spherical-harmonics, eq. 14.30.3]。

!!! warning "节点更多不代表氢原子的平均动能更高"

    一维弦或无限深势阱中“节点更多、波长更短、动能更高”的直觉不能原样搬到库仑束缚态。氢样定态满足 virial 关系 $2\langle T\rangle=-\langle V\rangle$，所以 $E=\langle T\rangle+\langle V\rangle=-\langle T\rangle$。当 $n$ 增大时 $E_n$ 变得较不负，而 $\langle T\rangle=-E_n$ 反而减小 [@griffiths2018qm, problem 3.37, p. 125, and problem 4.48, eq. (4.218), p. 187]。视频 05:05--06:05 的不确定性论证越过了类比的适用边界；常见实基下总节点面数仍是 $n-1$，错误的是这条能量解释 [@floatheadphysics2025-orbitals, 05:05--06:05]。

## 已确认的资料纠错

!!! important "PDF 正确，动画源码错误"

    推导 PDF 附录中的 $3p$ 与 $4d$ 公式是正确的。下面纠正的是配套 `atomic_orbitals.py` 的硬编码式，不应把错误归因于 PDF 本身。

配套 Manim 源码曾硬编码：

$$
\psi_{31,-1}\propto(4\sigma-2\sigma^2)e^{-\sigma/3},
$$

它把径向节点放在 $\sigma=2$。正确 Laguerre 结构是：

$$
\rho L_1^3(\rho)=\rho(4-\rho)
\propto\sigma(6-\sigma),
$$

所以节点应在 $\sigma=6$。

同理，动画源码中的 $4d$ 示例把节点放在 $\sigma=3$；正确结构：

$$
\rho^2L_1^5(\rho)=\rho^2(6-\rho)
\propto\sigma^2(12-\sigma),
$$

节点应在 $\sigma=12$。原始推导路线仍有教学价值，但具体轨道必须由总公式生成，禁止手工维护高阶展开式 [@solara-hydrogen-derivation; @solara-atomic-orbitals]。PDF、Manim 源码和 `orbital_plot` 教程的完整边界见[用户提供资料审计](../references/source-audit.md)。

## Python 使用

```python
import numpy as np

from quviz.physics.hydrogenic import hydrogenic_wavefunction

r = np.linspace(0.0, 20.0, 2000)
theta = np.full_like(r, np.pi / 2)
phi = np.zeros_like(r)
psi = hydrogenic_wavefunction(3, 1, -1, r, theta, phi, basis="complex")
```

任何新公式实现都必须通过归一化、正交性、节点数和已知期望值测试。
