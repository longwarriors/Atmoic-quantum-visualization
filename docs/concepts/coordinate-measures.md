# 坐标与概率测度

Born 密度是相对于物理体积元的密度：

$$
dP=|\psi(\mathbf r)|^2d^3r.
$$

球坐标下：

$$
\boxed{
dP=|\psi(r,\theta,\phi)|^2r^2\sin\theta\,dr\,d\theta\,d\phi
}
$$

因此，直接把 $|\psi(r,\theta,\phi)|^2$ 当成 $(r,\theta,\phi)$ 的联合密度是错误的。

## 氢样轨道的分离

$$
\psi_{n\ell m}=R_{n\ell}(r)Y_\ell^m(\theta,\phi)
$$

使概率测度分解为：

$$
dP=
\underbrace{r^2|R_{n\ell}(r)|^2dr}_{p_r(r)dr}
\underbrace{|Y_\ell^m|^2\sin\theta\,d\theta\,d\phi}_{p_\Omega d\Omega}.
$$

令 $x=\cos\theta$ 后，$\sin\theta d\theta=-dx$，极角采样变成 $x\in[-1,1]$ 上的一维 CDF 反演。QuViz 的点云采样器正是按这一测度构造，而不是在大立方体内低效地均匀拒绝采样。

## 径向函数与径向概率分布

必须区分：

$$
R_{n\ell}(r),\qquad |R_{n\ell}(r)|^2,
\qquad p_r(r)=r^2|R_{n\ell}(r)|^2.
$$

“最可能半径”应从 $p_r(r)$ 求，而不是从 $|R|^2$ 求。

### 中心最密不等于最可能半径

对球对称的氢样 $1s$ 态，局域三维概率密度与径向壳层分布分别是：

$$
\rho_{1s}(r)=|\psi_{1s}(r)|^2\propto e^{-2Zr/a_\mu},
\qquad
p_r(r)=4\pi r^2\rho_{1s}(r)\propto r^2e^{-2Zr/a_\mu}.
$$

因此 $\rho_{1s}$ 在原点最大，而 $p_r$ 在原点为零、在 $r=a_\mu/Z$ 达到最大值。二者回答的是不同问题：

- 三维点云在一个很小的物理体积内有多拥挤，估计的是 $\rho$；
- 把样本按半径分箱后，每个薄球壳内有多少点，估计的是 $p_r$。

连续分布中，精确一点或精确一个半径的概率都为零；这里的“最可能”指相应密度的峰值。上述公式和球坐标测度依据量子力学教材 [@griffiths2018qm, chs. 1 and 4 (pp. 3--24, 131--197)]。

FloatHeadPhysics 在 06:06--10:00 用点云提出了“中心最亮为何不是最可能半径”的好问题，但叙述在两种测度之间切换，并把“点密度不重要”说成绝对结论。正确结论是两者都重要，只是不能混用；完整审计见[纠错账本](../references/corrections.md) [@floatheadphysics2025-orbitals, 06:06--10:00]。
