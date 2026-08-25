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

不能同时在动能和归一化中使用 $L/N$。QuViz 的 `DirichletGrid1D` 和 `PeriodicGrid1D` 将坐标、间距和边界条件绑定为同一对象 [@qmsolve, v2.0.0]。

## PRL DOI

正确 DOI 是：

```text
10.1103/PhysRevLett.110.213001
```

期刊影响因子不是 DOI 的一部分，也不是单篇论文结论的证据。

## Jmol 点云论文作者元数据

正确作者包括 **Shane P. Tully** 与 **Przemyslaw Maslak**；旧索引中的 “Stephen P. Tully” 和 “Peter Maslak” 不是 DOI 注册元数据。BibTeX 已按 DOI `10.1021/ed300393s` 修正 [@tully2013pointillist]。

## FloatHeadPhysics 轨道形状视频

这段视频的节点动画仍有教学价值；以下纠正限定到具体时间段，不把局部错误扩散成对整段材料的否定 [@floatheadphysics2025-orbitals]。

### 局域密度与径向分布（06:06--10:00）

视频先把“从原子核向外的概率”描述成在原点为零、随后上升，又说视觉上的点密度不重要、每个半径上的总点数才重要。这里在没有稳定标明体积元的情况下切换了两个不同分布 [@floatheadphysics2025-orbitals, 06:06--10:00]：

$$
\rho_{1s}(r)=|\psi_{1s}(r)|^2,
\qquad
p_r(r)=4\pi r^2\rho_{1s}(r).
$$

$\rho_{1s}$ 是单位物理体积的局域密度，在原点最大；$p_r(r)dr$ 是整个薄球壳的概率，在原点为零。点云的局域拥挤程度与径向分箱计数都重要，只是不能互换。项目采用的完整球坐标测度见[坐标与概率测度](../concepts/coordinate-measures.md) [@griffiths2018qm, ch. 4 (pp. 131--197)]。

### 节点与平均动能（05:05--06:05）

视频借一维弦类比声称：节点更多使电子局限在更小区域，动量不确定度与动能随之增大 [@floatheadphysics2025-orbitals, 05:05--06:05]。对库仑氢样定态，这条推论不成立。写 $E_n=-C/n^2$（$C>0$），virial theorem 给出：

$$
2\langle T\rangle=-\langle V\rangle,
\qquad
\langle T\rangle=-E_n=\frac{C}{n^2}.
$$

因此 $n$ 增大时总能量变得较不负，但平均动能减小。常见实基下 $N_{\mathrm{total}}=n-1$ 仍然正确；错误的是用“更局限、动能更高”解释该节点计数 [@griffiths2018qm, p. 125 (virial theorem) and ch. 4 (pp. 131--197)]。

### $d_{z^2}$ 与磁量子数（21:58--30:18）

视频把“两个角节点”主要画成两个平面，并把 $d$ 轨道概括成四瓣 [@floatheadphysics2025-orbitals, 21:58--24:08]；但 $d_{z^2}$ 的角因子 $3\cos^2\theta-1$ 在 $\cos\theta=\pm1/\sqrt3$ 为零，节点是圆锥面，等值面呈两瓣加环。角节点数只规定零点集合的数量，不规定它们都是平面 [@dlmf-spherical-harmonics, eq. 14.30.3]。

视频随后用顺/逆时针旋转节点解释 $m=-\ell,\ldots,+\ell$ [@floatheadphysics2025-orbitals, 27:25--30:18]。这可以帮助记忆简并子空间的维数 $2\ell+1$，却不能把 $m$ 直接解释成实轨道朝向：复基中的 $m$ 是 $L_z/\hbar$ 本征值，$p_x,p_y$ 等定向实轨道是 $m=\pm1$ 态的线性组合。项目约定见[实轨道与复轨道](../tutorials/real-vs-complex.md) [@dlmf-spherical-harmonics, eqs. 14.30.3, 14.30.6, and 14.30.11_5]。

## QuViz 自身审计的纠错

纠错账本对本项目的审计输出同样适用。以下条目是 QuViz 写错、而不是来源写错。

### YouTube 字幕声明（已撤回）

本页曾在[资料审计](source-audit.md)中断言两段视频“都没有可导出的字幕”。2026-08-23 复核该声明为**假**：

- 两个视频各有**两条**英文字幕轨；
- 其中各有一条是**人工上传**轨（player response 中 `vssId` 为 `.en` / `.en-US`，且**没有** `"kind":"asr"` 字段——该字段的缺失正是人工轨的标记）；
- 另有一条 `a.en` 自动生成轨，并暴露 `translationLanguages` 与 `getTranscriptEndpoint`。

三重问题：事实为假；字幕可用性是**随时间变化**的平台状态，却用绝对句式陈述，违反本项目“网页记录访问日期”的规定；而且推论不成立——“没有字幕”不是“只能作教学入口”的理由，正确理由是信源层级为 C。

验证方法：抓取 watch 页的 `playerCaptionsTracklistRenderer`。注意匿名下载字幕字节会被 YouTube 的会话令牌限流，**“我抓不到”不等于“不存在”**——把二者混同正是原声明的错误根源。

### Jacobs 点群表“访问不稳定”（已修正）

原文写“当前站点访问不稳定”。实测该主机 http/https 均无法完成 TCP 连接，属于**整域退役**而非间歇性故障，且资源已迁至 `constructor.university`。原表述既低估了严重性，又掩盖了修复方法只是替换主机名 [@jacobs-character-tables]。
