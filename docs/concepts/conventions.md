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

- 长度：约化 Bohr 半径 $a_\mu$；
- 能量：Hartree；
- $\hbar=e=m_e=4\pi\epsilon_0=1$。

`z` 表示核电荷数。若使用有限核质量，应显式改变 $a_\mu$ 和能量中的约化质量比，而不是悄悄把电子质量写死。

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
