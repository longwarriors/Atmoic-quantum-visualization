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
  "state": {"n": 3, "l": 2, "m": 2, "z": 1.0, "basis": "complex"},
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
- `seed_count` 是最终保留下来的输出流线数；`seed_density_floor` / `arc_step_bohr` / `integration_rule` 报告主要离散化尺度。候选 lattice 与请求 seed budget 尚未进入 payload，因此这些字段不足以单独重算整束流线；
- `max_speed`：当前 payload 内的着色归一化基准。颜色表达同一状态内的相对速度；跨状态比较应读取数值 `max_speed`，不能直接比较颜色。

默认离散化按物理尺度定义。单态以 $L=n^2/Z$，叠加态分别以最紧致与最宽的 $L_k=n_k^2a_\mu/Z$：`arc_step_bohr` 为最紧致尺度的 0.03，播种下限满足 $\rho_{\min}L_{\max}^3=10^{-4}$；连续性差分则用更短的 $L_d=\min(n_ka_\mu/Z)$。显式传入 `arc_step` 时它仍是 bohr。

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

`SuperpositionMetadata` 必须同时携带 `z`、`a_mu` 与 `reduced_mass_ratio=1/a_mu`。空间长度用 $a_\mu/Z$，相位能量用 $-(Z^2/a_\mu)/(2n^2)$；两者来自同一个质量输入。
