# 电子云采样

## 单一氢样轨道：优先分离采样

概率测度严格分离：

$$
dP=
\underbrace{r^2|R_{n\ell}(r)|^2dr}_{\text{radial}}
\underbrace{|Y_\ell^m|^2\sin\theta d\theta d\phi}_{\text{angular}}.
$$

当前 QuViz 实现的流程是：

1. 在有限径向区间上构造离散 CDF，并计算该区间捕获的概率质量；
2. 令 $x=\cos\theta$，构造 $[-1,1]$ 上的角向 CDF；
3. 复基中的 $\phi$ 均匀采样；
4. 实基中的 $\cos^2(m\phi)$ 或 $\sin^2(m\phi)$ 用一维拒绝采样；
5. 转为 Cartesian 坐标并重新计算相位。

这产生近似独立同分布样本，避免三维大球拒绝采样的低接受率。有限区间、网格离散和数值逆变换意味着它不是“解析精确采样”；接口必须报告捕获质量和离散分辨率。当前自适应扩展路径还需要专门的尾部回归测试，不能只因默认状态恰好落在初始区间内就宣称已经覆盖。随机数使用 NumPy `Generator/default_rng`，并由显式 seed 控制实验复现 [@numpy-rng]。

## 为什么点云不是轨迹

点集合：

$$
\{\mathbf r_i\}_{i=1}^N,
\qquad
\mathbf r_i\overset{iid}{\sim}|\psi|^2d^3r,
$$

表示重复制备和位置测量的统计结果。点的顺序没有时间含义，不能连线成电子路径。点云式轨道可视化在教学中已有成熟先例 [@tully2013pointillist; @evanescence]。

## 线性组合必须保留干涉项

若：

$$
\psi=\sum_kc_k\phi_k,
$$

则：

$$
|\psi|^2=\sum_k|c_k|^2|\phi_k|^2+
\sum_{i\ne j}c_ic_j^*\phi_i\phi_j^*.
$$

错误方法是先按 $|c_k|^2$ 选择一个分量，再从 $|\phi_k|^2$ 采样；这会丢失产生定向叶瓣和节点的干涉项。

可以把分量密度混合用作 proposal，再对完整 $|\psi|^2$ 做拒绝校正。

## 何时使用 MCMC/HMC/flow

| 状态 | 推荐方法 |
|---|---|
| 单一氢样轨道 | 分离逆 CDF |
| 少量线性组合 | mixture proposal + rejection |
| 数值网格波函数 | alias / adaptive rejection / MCMC |
| 分子轨道 | mixture、MALA 或 HMC |
| 多电子 $3N$ 维波函数 | VMC、MALA/HMC、SMC、flow proposal |

节点附近：

$$
\nabla\log|\psi|^2=2\operatorname{Re}\frac{\nabla\psi}{\psi}
$$

可能奇异，且节点面会分割 nodal pockets。高维采样必须报告链相关性、跨 pocket 混合和有效样本量，不能只展示漂亮点云。
