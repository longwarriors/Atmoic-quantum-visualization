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
\rho=\frac{2Zr}{na_\mu}.
$$

广义 Laguerre 多项式和球谐函数分别由 SciPy 的当前 API 计算 [@scipy-eval-genlaguerre; @scipy-sph-harm-y]，公式依据可追溯到 DLMF [@dlmf-laguerre; @dlmf-spherical-harmonics]。

## 节点计数

$$
N_{\mathrm{radial}}=n-\ell-1,
\qquad
N_{\mathrm{angular}}=\ell,
\qquad
N_{\mathrm{total}}=n-1.
$$

节点计数是高价值回归测试。图像看起来“像”并不够；错误的径向多项式通常会把节点放到错误半径。

## 已确认的资料纠错

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

同理，源码中的 $4d$ 示例把节点放在 $\sigma=3$；正确结构：

$$
\rho^2L_1^5(\rho)=\rho^2(6-\rho)
\propto\sigma^2(12-\sigma),
$$

节点应在 $\sigma=12$。原始推导路线仍有教学价值，但具体轨道必须由总公式生成，禁止手工维护高阶展开式 [@solara-hydrogen-derivation; @solara-atomic-orbitals]。

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
