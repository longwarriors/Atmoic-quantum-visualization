# 已确认纠错

本页记录“错误在哪里”，不把一个文件的局部错误扩散成对整组材料的否定。

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

!!! note "推导 PDF 无此错误"

    `hydrogen_ao_derivation.pdf` 附录中的对应 $3p$、$4d$ 表达式是正确的；错误只出现在 revision `a351de1` 的动画源码 [@solara-hydrogen-derivation; @solara-atomic-orbitals]。

## Solara570 `orbital_plot` 的坐标与阈值

- `np.meshgrid` 默认 `indexing="xy"` 会交换前两个数组轴，后续手动换轴是调用约定的补偿，不是 marching cubes 固有规则；
- `theta=arccos(z/r)` 在原点产生 `0/0`，应遮罩原点或以安全分支定义角度；
- 固定 `iso_value=4e-4` 不能保证不同轨道表面包围相同概率质量。

QuViz 应使用一致的 `indexing="ij"`、显式 spacing 和按目标包围质量求阈值 [@solara-orbital-plot; @numpy-meshgrid; @skimage-marching-cubes]。

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

## Jmol 点云论文作者元数据

正确作者包括 **Shane P. Tully** 与 **Przemyslaw Maslak**；旧索引中的 “Stephen P. Tully” 和 “Peter Maslak” 不是 DOI 注册元数据。BibTeX 已按 DOI `10.1021/ed300393s` 修正 [@tully2013pointillist]。
