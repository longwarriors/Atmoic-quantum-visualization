# 验证采样器

## 单一氢样轨道

至少验证三个层面。

### 径向边际

从点云计算 $r_i=\|\mathbf r_i\|$，与：

$$
F_r(r)=\int_0^r s^2|R_{n\ell}(s)|^2ds
$$

做 KS 或 Cramér–von Mises 检验。

### 角向边际

检查 $\cos\theta$ 与 $\phi$ 的理论分布。复基中 $\phi$ 应均匀；实基中应服从 $\cos^2(m\phi)$ 或 $\sin^2(m\phi)$。

### 三维矩与对称性

例如 $p_z$ 应满足：

$$
\mathbb E[x]\approx\mathbb E[y]\approx\mathbb E[z]\approx0,
$$

$$
\mathbb E[x^2]\approx\mathbb E[y^2],
$$

并在 $z=0$ 节点面附近表现出正确低密度。

## MCMC 额外指标

- burn-in；
- autocorrelation；
- ESS；
- 多链诊断；
- nodal pocket 占比；
- proposal 接受率；
- 跨 seed 稳定性。

只比较渲染图“看起来相似”不构成采样正确性证据。
