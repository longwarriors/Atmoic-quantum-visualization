# 物理与数值约定

## 球坐标

QuViz 使用：

$$
r\ge 0,\qquad
\theta\in[0,\pi],\qquad
\phi\in[0,2\pi),
$$

其中 $\theta$ 是极角，$\phi$ 是方位角。这与当前 SciPy `sph_harm_y` 的参数语义一致，并包含 Condon–Shortley 相位 [@scipy-sph-harm-y]。

$$
x=r\sin\theta\cos\phi,\quad
y=r\sin\theta\sin\phi,\quad
z=r\cos\theta.
$$

## 单位

解析氢样模块默认使用原子单位：

- 长度：普通 Bohr 半径 $a_0$；
- 能量：Hartree；
- $\hbar=e=m_e=4\pi\epsilon_0=1$。

`z` 表示核电荷数。`SuperpositionState` 以及 scene/API 的有限核质量契约只接受一个无量纲输入
`a_mu=m_e/\mu`，它表示约化 Bohr 半径相对 $a_0$ 的倍率；该链路由此唯一
推导 `reduced_mass_ratio=\mu/m_e=1/a_mu`。因此空间尺度是
$a_\mu/Z$（数值上为 `a_mu/Z` 个 $a_0$），能量是
$E_n=-Z^2/(2a_\mu n^2)$ Hartree。该链路不得把两者作为独立旋钮分别设置。
低层 `hydrogenic_energy_hartree` 仍显式接收 `reduced_mass_ratio`，供解析门禁与独立调用；
调用者若同时构造空间波函数，必须自行按 `1/a_mu` 传入，不能借此制造不一致状态。

## 复球谐与实球谐

标准复基为 $Y_\ell^m$。实基采用：

$$
Y_{\ell m}^{\mathrm{real}}=
\begin{cases}
\sqrt2(-1)^m\operatorname{Re}Y_\ell^m,&m>0,\\
Y_\ell^0,&m=0,\\
\sqrt2(-1)^m\operatorname{Im}Y_\ell^{|m|},&m<0.
\end{cases}
$$

在该约定下：

- $\ell=1,m=1\rightarrow p_x$；
- $\ell=1,m=-1\rightarrow p_y$；
- $\ell=1,m=0\rightarrow p_z$。

实基便于化学直观；复基保留 $L_z$ 本征值和非零方位概率流。二者是同一简并子空间中的不同基，不是两套不同物理定律。
