# 已确认纠错

## Solara570 Manim 源码中的 $3p$ 径向多项式

源码硬编码：

$$
(4\sigma-2\sigma^2)e^{-\sigma/3},
$$

节点为 $\sigma=2$。由 $L_1^3(\rho)=4-\rho$ 与 $\rho=2\sigma/3$ 得：

$$
R_{31}\propto\sigma(6-\sigma)e^{-\sigma/3},
$$

节点应为 $\sigma=6$。

## Solara570 Manim 源码中的 $4d$ 径向多项式

源码硬编码节点为 $\sigma=3$。由 $L_1^5(\rho)=6-\rho$ 与 $\rho=\sigma/2$ 得：

$$
R_{42}\propto\sigma^2(12-\sigma)e^{-\sigma/4},
$$

节点应为 $\sigma=12$。

## Evanescence 拒绝采样包络

拒绝采样要求：

$$
M\ge\sup_{\mathbf r}|\psi(\mathbf r)|^2.
$$

其实现对数值估计的最大值使用小于 1 的 modifier。低阶径向 KS 测试提供经验支持，但不能证明任意高节点态的最终包络仍是严格上界。因此 QuViz 不复制该采样器，而采用可分离逆 CDF。

## qmsolve 2.0.0 网格间距

坐标若由包含端点的 $N$ 点 `linspace` 构造，则：

$$
\Delta x=\frac{L}{N-1},
$$

不能同时在动能和归一化中使用 $L/N$。QuViz 的 `DirichletGrid1D` 和 `PeriodicGrid1D` 将坐标、间距和边界条件绑定为同一对象。

## PRL DOI

正确 DOI 是：

```text
10.1103/PhysRevLett.110.213001
```

期刊影响因子不是 DOI 的一部分，也不是单篇论文结论的证据。
