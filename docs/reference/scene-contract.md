# Scene Contract

## 目的

Scene Contract 是 Python 科学层与前端渲染层之间的边界。它回答：

- 状态是什么；
- 所画物理量是什么；
- 几何如何构造；
- 使用什么单位、约定和归一化；
- 有哪些截断和警告；
- 证据来自哪里。

## 元数据示例

```json
{
  "state": {"n": 3, "l": 2, "m": 2, "z": 1.0, "a_mu": 1.0, "basis": "complex"},
  "label": "3d, m=2",
  "energy_hartree": -0.0555555556,
  "length_unit": "bohr",
  "observable": "probability_density",
  "representation": "isosurface",
  "normalization": "integral(|psi|^2 dV)=1",
  "coordinate_convention": "theta=polar[0,pi], phi=azimuth[0,2pi)",
  "geometry_semantics": "level set of probability density |psi|^2",
  "color_semantics": "principal wavefunction phase in [-pi, pi]",
  "references": ["dlmf-spherical-harmonics", "scipy-sph-harm-y"],
  "warnings": ["surface geometry represents density; color carries phase"]
}
```

## 点云二进制格式 `QVPC/1`

Little-endian：

| Offset | 类型 | 含义 |
|---:|---|---|
| 0 | 4 bytes | magic `QVPC` |
| 4 | uint16 | version = 1 |
| 6 | uint16 | flags |
| 8 | uint32 | point count |
| 12 | uint32 | stride = 5 |
| 16 | float32[] | interleaved `x,y,z,intensity,phase` |

`intensity` 是向后兼容的渲染辅助字段。当前值恒为 1：位置分布本身已经编码抽样密度，不能再用局部 $|\psi|^2$ 改变点大小、亮度或 alpha。

## 概率流字段 `CurrentFieldPayload`

- `lines` / `speed`：逐条流线的顶点与逐顶点 $|\mathbf j|/\rho$。顶点按**弧长**等间距，速度只由 `speed` 承载——不得再用顶点疏密表示速度，否则同一个量被编码两次；
- `continuity_absolute_residual` / `continuity_scale` / `continuity_residual`：分别为连续性方程残差的绝对值、同量纲参照尺度和二者之比。非定态先把相同能隙的 transition coherence 相干合并，再把不同能隙作平方和开根，形成时间无关的参照尺度，并对每个不同能隙取四个辅助相位的最大残差；该尺度是严格定义的 reference，不宣称是多频瞬时和的上包络。定态非零流使用 $\max|\mathbf j|/L_d$，解析零流则明确标成 `analytic_zero_current`，不拿零分母伪造一个“通过”；
- `continuity_scale_kind` / `continuity_probe_count`（叠加态另有 `continuity_phase_count`）：说明上述判据实际使用哪条路径、多少空间探针和多少辅助相位；若由实基共相位关系，或复基的 $c_m=\kappa(-1)^m c_{-m}^*$ 共轭关系解析证明零流，探针数与相位数都为 0。`density_rate_scale` 只报告画面时刻的 $\max|\partial_t\rho|$，不再作为归一化分母；
- `seed_count` 是最终保留下来的输出流线数；`seed_density_floor` / `arc_step_bohr` / `integration_rule` 报告主要离散化尺度。候选 lattice 与请求 seed budget 尚未进入 payload，因此这些字段不足以单独重算整束流线。API 预检使用的是**请求** seed 数和保守 `max_points`，不是这里的输出数；
- `max_speed`：当前 payload 内的着色归一化基准。颜色表达同一状态内的相对速度；跨状态比较应读取数值 `max_speed`，不能直接比较颜色。

默认离散化按物理尺度定义。单态以 $L=n^2/Z$，叠加态分别以最紧致与最宽的 $L_k=n_k^2a_\mu/Z$：`arc_step_bohr` 为最紧致尺度的 0.03，播种下限满足 $\rho_{\min}L_{\max}^3=10^{-4}$；连续性差分则用更短的 $L_d=\min(n_ka_\mu/Z)$。每条流线的默认停止阈值固定为该 seed 初始有限速度的 $10^{-12}$，所以批次重排、合并或拆分不改变慢线结果；密度遮罩随 $(Z/a_\mu)^3$ 缩放。速度与电流向量长度由稳定 `hypot` 归约计算，不先平方极小分量。payload 顶点按 $a_\mu/Z$ 无量纲化后保留六位小数，速度按 $Z$ 无量纲化后逐值保留 12 位有效数字再恢复单位；`max_speed` 从最终 `speed` 数组重算。弱相干速度可远小于 $10^{-6}$，因此速度绝不能使用固定六位小数。

显式传入 `arc_step` 时它仍是 bohr，但必须满足 $1/4096\leq\texttt{arc\_step}/L_{\min}\leq1/8$：下界绑定 4096 点的**单路径**硬上限，上界使半径为一个最紧致支撑尺度的圆周仍约有 50 步；超界请求 fail-safe 为 HTTP 422。API 还用请求 seed 数预估总成本：`active_terms × seed_count × [1+5(max_points−1)] ≤ 2,000,000`，并要求 `seed_count × max_points ≤ 100,000`。所以落在弧长窗口内仍不等于组合请求必然被接受。`lines` 的实际顶点数会直接暴露是否触及单路径上限，payload 不声称走完某个预设物理弧长。

对单一本征态，实基或 $m=0$ 时 `lines` 为空且 `max_speed` 为 0，并附 warning。这是**物理上正确的答案**（实定态概率流恒为零），不是错误。叠加态不能套用这一捷径：实基分量若带相对复相位仍可有流，必须按上面的共相位/共轭关系判定。

## 等值面质量字段

- `requested_probability_mass`：用户要求的绝对 superlevel-set 质量；
- `captured_probability_mass`：离散阈值实际包含的 Simpson 加权质量；
- `finite_grid_density_integral`：有限网格上的数值 $\int\rho dV$，可能因求积误差略高于 1；
- `grid_resolution` / `grid_spacing_bohr` / `integration_rule`：复现阈值与质量估计所需的离散化参数；
- 叠加态另报告 `finite_box_tail_mass_upper_bound` 与 `finite_box_mass_variation_upper_bound`：前者把有限阶 Laguerre 多项式平方后用整数阶不完全 Gamma 的终止级数求球外径向尾部解析上界，后者再用奇偶性、全空间正交性和 Cauchy–Schwarz 限制真实有限盒质量的时间变化；
- `finite_grid_phase_variation_bound` 是离散 Simpson Gram matrix 的相位变化上包络；相同能隙的交叉项必须先作复数相干求和。`finite_grid_aliasing_variation_lower_bound` 用反三角不等式扣除有限盒允许的真实变化，只有这个**下界**超过 `finite_grid_reporting_tolerance` 时才能标为 `phase_dependent_quadrature_error`；
- `finite_grid_mass_error_lower_bound` 是画面时刻的网格质量到物理允许区间 $[1-T,1]$ 的距离；`finite_grid_reporting_tolerance` 当前固定为 $2\times10^{-3}$，随 payload 明示，消费者无需猜 builder 常数；
- `finite_grid_mass_status` 只在证据允许的范围内区分相位相关 alias、由对称性证明的 `time_invariant_quadrature_error`、只在当前时刻确认的 `quadrature_error_at_reported_time` 与 `no_error_above_tolerance_proven`。最后一种只表示现有**误差下界**没有证明误差超过阈值，不表示网格误差已被上界证明小于阈值；单网格结果也不会被宣称成已证明的边界通量。

## 切片资产 `SlicePayload` / `SuperpositionSlicePayload`

切片在过原点的一张主平面上报告**一个**标量场：`probability_density`（`bohr^-3`）、`wavefunction_real` / `wavefunction_imag`（`bohr^-3/2`）或 `phase`（`radian`）。`value_unit` 由 `slice_observable` 唯一决定，写错即被 payload 自己的校验拒绝。

### 采样布局

`layout` 恒为 `row_major_v_rows_u_columns`，它是逐字写进 payload 的字面量，而不是留给读者猜的约定：

- 第 $k$ 个样本满足 `k = row * resolution + col`；**`row` 索引 $v$（慢轴），`col` 索引 $u$（快轴）**；
- 该样本的位置是 $P(\texttt{row},\texttt{col})=\texttt{origin}+\texttt{axis}[\texttt{col}]\,\hat u+\texttt{axis}[\texttt{row}]\,\hat v$，其中 `origin_bohr` 恒为 $(0,0,0)$；
- 采样轴不是 `np.linspace(-extent, extent, resolution)`。`linspace` 以 `start + step*i` 生成再修补端点，在一般 extent 下**两半在最低位上并不逐位互为相反数**，于是切片的对称性断言与节点位置会由舍入决定。轴的定义是 $\texttt{axis}=\texttt{spacing}\times(\texttt{arange}(R)-\texttt{half})$，其中 $\texttt{half}=(R-1)//2$、$\texttt{spacing}=2\,\texttt{extent}/(R-1)$；IEEE 取负是精确的，小整数 `arange` 也是精确的，因此该轴在任意 extent 下逐位反对称，且 $\texttt{axis}[\texttt{half}]$ 精确为 `0.0`。这也是 `resolution` 必须为奇数的原因：偶数轴根本不采样原点，而这里每一条对称性、节点与遮罩陈述都是关于**过原点的平面**说的；
- `extent_bohr` 是从状态**导出并报告**的（本征态用径向质量分位，叠加态用最宽 term），不是调用方参数。否则同一状态的两张切片可以对"状态到哪里为止"各执一词，masked fraction 与对称性陈述就都变成关于调用方裁剪框的陈述。

### 平面标架

三张主平面各有冻结的右手 $(u,v,n)$ 标架，满足 $\hat u\times\hat v=\hat n$：

| `plane` | 标架 |
|---|---|
| `xy` | $(u=x,\ v=y,\ n=+\hat z)$ |
| `xz` | $(u=x,\ v=z,\ n=-\hat y)$ |
| `yz` | $(u=y,\ v=z,\ n=+\hat x)$ |

`xz` 的法向是 **$-\hat y$** 而不是 $+\hat y$，因为 $\hat x\times\hat z=-\hat y$；写成 $+\hat y$ 会让这张平面的标架变成左手系，从而把每一条与手性有关的结论（概率流的环绕方向、相位缠绕的符号）整体镜像。`u_axis` / `v_axis` / `normal` 随 payload 一并给出，客户端不必知道服务端用的是哪套约定。

### 相位遮罩与它的六个数

波函数的相位在振幅消失处没有定义，而在一张恰好具有节面对称性的平面上，计算出的振幅不是零而是数值残渣：实基 $2p_z$ 在 `xy` 平面上的 $\max\lvert\psi\rvert$ 实测为 $4.4874712\times10^{-18}$，不是 `0`。因此阈值参照的是**状态自身**的振幅尺度 $L_{\mathrm{ref}}^{-3/2}$，而不是这张切片自己的最大值——后者会把阈值重新标定到那点残渣上，然后交回一整面毫无意义的相位。$L_{\mathrm{ref}}$ 对本征态是 $n^2a_\mu/Z$，对叠加态是 $\max_k n_k^2a_\mu/Z$。

规则本身：

$$
\texttt{amplitude\_scale}=L_{\mathrm{ref}}^{-3/2},\quad
\texttt{threshold}=\texttt{relative}\times\texttt{amplitude\_scale},\quad
\texttt{floor}=64\,\varepsilon\max_{\text{plane}}\lvert\psi\rvert,
$$

$\texttt{relative}=10^{-6}$，$\texttt{effective}=\max(\texttt{threshold},\texttt{floor})$，`valid_mask` 为 $\lvert\psi\rvert>\texttt{effective}$（**严格**大于）。floor 只在评估自身的抵消残渣超过状态参照阈值时才接管。被遮罩的样本携带有限的哨兵值 `masked_value_sentinel = 0.0`，因此忽略遮罩的客户端画出的是一个确定的占位值而不是残渣，payload 也能通过严格 JSON 解析器。

payload 报告下面六个数，读者据此可以看出是哪一项在起作用：

| 字段 | 含义 |
|---|---|
| `phase_mask_relative_amplitude` | `relative`，当前为 $10^{-6}$ |
| `phase_mask_amplitude_scale` | $L_{\mathrm{ref}}^{-3/2}$ |
| `phase_mask_amplitude_threshold` | `relative` 乘上振幅尺度 |
| `phase_mask_numeric_floor` | $64\varepsilon$ 乘上本平面的最大模 |
| `max_amplitude_on_plane` | 本平面的 $\max\lvert\psi\rvert$ |
| `phase_masked_fraction` | 被遮罩样本占 $R^2$ 的比例 |

四个 `phase_mask_*` 字段与 `valid_mask` 只在 `slice_observable = phase` 时非空；其余三个标量场不带遮罩。`effective` 不单列，因为它就是前两者取大，读者可以自己算，而两个分项才说明是谁在决定边界。

### 这个遮罩不宣称什么

**被遮罩的样本只表示：在这张平面上 $\lvert\psi\rvert\leq$ threshold。这个集合既包含节面，也包含指数尾部；它标记的是一个低振幅 / 相位未定义区域，而不是节点证书——没有任何东西证明一个被遮罩的点是节点，也没有任何东西证明一个未被遮罩的点远离节点。**

实测的例子正好说明这句话的两半：实基 $2p_z$ 的 `xy` 相位切片 `phase_masked_fraction = 1.0`，整张平面被遮罩（threshold $1.25\times10^{-7}$，floor $6.3770801\times10^{-32}$，$\max\lvert\psi\rvert=4.4874712\times10^{-18}$，故由 threshold 决定），并附带明确 warning：这张平面确实是 $2p_z$ 的节面，但**遮罩本身**不是那个结论的证据，同一个 `1.0` 也可以由一张完全落在指数尾部的切片产生。

`SuperpositionMetadata` 必须同时携带 `z`、`a_mu` 与 `reduced_mass_ratio=1/a_mu`。空间长度用 $a_\mu/Z$，相位能量用 $-(Z^2/a_\mu)/(2n^2)$；两者来自同一个质量输入。
