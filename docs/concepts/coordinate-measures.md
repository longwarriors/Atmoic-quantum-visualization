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
