# 点群与轨道杂化

## $T_d$ 中的 $sp^3$

四个正四面体方向函数构成：

$$
\Gamma_{\mathrm{tetrahedral}}=A_1\oplus T_2.
$$

在 $T_d$ 中：

$$
s\sim A_1,
\qquad
(p_x,p_y,p_z)\sim T_2.
$$

因此可构造：

$$
\begin{pmatrix}
h_1\\h_2\\h_3\\h_4
\end{pmatrix}
=
\frac12
\begin{pmatrix}
1&1&1&1\\
1&1&-1&-1\\
1&-1&1&-1\\
1&-1&-1&1
\end{pmatrix}
\begin{pmatrix}
s\\p_x\\p_y\\p_z
\end{pmatrix}.
$$

四个 p 空间方向的任意两向量满足：

$$
\widehat{\mathbf n}_i\cdot\widehat{\mathbf n}_j=-\frac13,
$$

所以夹角为 $109.47^\circ$ [@maksic1986hybridization; @jacobs-character-tables]。

## 群论能决定什么

- 表示如何分解；
- 哪些原子轨道具有匹配对称性；
- 如何构造 SALC 与正交定向基。

## 群论不能独自决定什么

- 实际 $s/p$ 混合比例；
- 能量最优性；
- 径向收缩；
- 某套局域轨道的唯一性；
- 真实多电子分子中的电子关联。

杂化轨道是占据子空间中的基变换，不是直接可观测量。传统 `sp3d`、`sp3d2` 应标为局域化解释模型，而不是唯一现代成键图景。

## QuViz 实现原则

- 系数矩阵必须满足 $U^TU=I$；
- 先线性组合波函数，再取模方；
- 图中显示 basis 与系数；
- 总密度与子空间不变量单独验证；
- 化学标签不能覆盖物理量子数和来源基。
