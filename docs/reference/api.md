# HTTP API

FastAPI 自动生成 OpenAPI 文档 [@fastapi]。

## `GET /api/health`

返回版本和服务状态。

## `GET /api/orbitals/catalog`

返回常用状态预设。

## `GET /api/orbitals/metadata`

参数：`n,l,m,z,basis`。

返回 Scene metadata，不生成大数组。

## `GET /api/orbitals/point-cloud`

参数：

- `n,l,m,z,basis`；
- `samples`：1000–120000；
- `seed`。

返回 `application/vnd.quviz.point-cloud`，格式为 `QVPC/1`。响应头包含：

- `X-QuViz-Radial-Mass`；
- `X-QuViz-Extent-Bohr`；
- `X-QuViz-Format`。

## `GET /api/orbitals/isosurface`

参数：

- `resolution`：49–81，必须为奇数；最低值随 $n$ 增长为 $\max(49,16n+17)$；
- `probability_mass`：0.50–0.99。

当前等值面 API 保守限制为 $n\le4$，但这不表示已经穷举验证该范围的全部轨道。返回 typed OpenAPI schema，包括 indexed mesh、法向、逐顶点相位、阈值、superlevel-set 质量、有限网格 $\int\rho dV$、网格间距和 Scene metadata。当前使用 JSON，生产规模可升级为 GLB 或自定义 mesh binary。

## `GET /api/orbitals/slice`

参数：

- `n`：1–12，默认 2；`l`：0–11，默认 1；`m`：−11–11，默认 0；
- `z`：$0<z\le20$，默认 1.0；**`a_mu`：$0<a_\mu\le20$，默认 1.0**；
- `basis`：默认 `real`；
- `plane`：`xy` / `xz` / `yz`，默认 `xz`；
- `observable`：`probability_density`（默认）/ `wavefunction_real` / `wavefunction_imag` / `phase`；
- `resolution`：65–513，默认 **129**，必须为奇数；最低值随 $n$ 增长为 $\max(65,16n+17)$。

`extent_bohr` 由状态导出并随 payload 报告，**不是参数**。

这是**唯一暴露 `a_mu` 的本征态路由**——其余 `/api/orbitals/*` 只接受 `z`。这是刻意的不对称而不是遗漏：切片是约化质量长度唯一直接可读的地方，$a_\mu$ 同时改变导出的 extent 与相位遮罩所参照的振幅尺度 $L_{\mathrm{ref}}^{-3/2}$，两者都逐字出现在 payload 里。

422 条件分两层，报错文本能区分是哪一层：

- **签名层**（FastAPI 的 `Query` 边界）：`resolution` $<65$ 或 $>513$、`n`/`l`/`m`/`z`/`a_mu` 越界、`plane` 或 `observable` 不是枚举成员，返回 FastAPI 的结构化 `detail` 列表；
- **builder 层**（`quviz.scene.slices` 抛 `ValueError`，路由转成 422 并原样带上原因）：`resolution` 为偶数（`resolution must be odd so the origin lies on the grid`——偶数轴不采样原点，而每条对称性/遮罩陈述都是关于过原点的平面说的）；`resolution` 低于该 $n$ 的下限（$n=6$ 传 65 得到 `resolution must be at least 113 for n=6`）；以及量子数本身非法。

下限 $\max(65,16n+17)$ 随 $n$ **线性**增长，因为一个 $n$ 态有 $n-\ell$ 个径向腹点、而 extent 本身按 $n^2$ 增长。注意它与等值面的 $n\le4$ 上限不是同一回事：等值面的限制是关于 marching cubes 的（网格抽取、绕向修正与质量核算只在那几层壳上验证过），而切片不抽取任何网格，只在 $R^2$ 个点上求值并报告数字，所以高 $n$ 在这里花的是采样数，不是有效性——路由因此把 $n$ 开到 12。

payload 体积是这条路由唯一的实际约束，实测（`n=2, l=1, m=0`，`xz`）：`resolution=129` 时 `probability_density` 响应 364,210 B（约 356 KB），`resolution=513` 时 5,736,707 B（约 **5.5 MB**；`phase` 因遮罩后大量重复值为 4,209,037 B）。513 是硬上限，129 之所以是默认值，是因为它够画一张清楚的图、又比上限便宜 16 倍。

## `GET /api/superposition/slice`

参数：

- `terms`、`time`、`basis`（默认 `complex`）、`z`、`a_mu`：与 `/api/superposition/isosurface` 相同；
- `plane`、`observable`、`resolution`：与 `/api/orbitals/slice` 相同（默认同为 `xz`、`probability_density`、129）。

**最大的 term 同时决定 extent、`resolution` 下限与遮罩的参照长度 $L_{\mathrm{ref}}=\max_k n_k^2a_\mu/Z$**：一个对 1s 切片诚实的 resolution 在这里可能被拒，而报错会点名是哪一层壳要求更多采样。返回 `SuperpositionSlicePayload`：几何、布局与遮罩字段与单态切片完全一致，metadata 换成 `SuperpositionMetadata`。

## `GET /api/orbitals/current-field`

参数：

- `n`：1–6，默认 3；`l`：0–5，默认 2；`m`：−5–5，默认 2；`z`：$0<z\le20$，默认 1.0；
- `basis`：默认 `complex`；
- `seed_count`：1–256，默认 48；
- `arc_step`：可选，缺省时取 $0.03\,n^2/Z$；显式给出时，`arc_step` 与 $n^2/Z$ 之比必须落在 $[1/4096,\ 1/8]$ 内（含端点），越界返回 422。

返回 `CurrentFieldPayload`：等弧长采样的流线顶点、逐顶点 $|\mathbf j|/\rho$ 速率、`arc_step_bohr`、`seed_density_floor`、`extent_bohr`，以及连续性诊断 `continuity_residual`、`continuity_absolute_residual`、`continuity_scale`、`continuity_scale_kind`（`stationary_current` 或 `analytic_zero_current`）、`continuity_probe_count`。`seed_count` 字段是**实际返回的流线条数**，不是请求的种子数。

实基或 $m=0$ 的定态概率流恒为零，此时返回空的 `lines` 与 metadata 警告，而不是错误——“没有流动”是物理上正确的答案。

## `GET /api/superposition/catalog`

无参数。返回叠加态预设列表，每项含 `id`、`label`、`terms`（可直接传给下面两个端点的查询串）、`period_au` 与 `note`。其中简并预设的 `period_au` 为 0，用作 negative control：这类态的密度不应移动。

## `GET /api/superposition/isosurface`

参数：

- `terms`：分号分隔的 `n,l,m,re[,im]`，默认 `1,0,0,0.7071067811865476;2,1,0,0.7071067811865476`；任何无法解析或违反 $0\le\ell<n$、$|m|\le\ell$、$\sum|c_k|^2=1$ 的项返回 422；
- `time`：−1000–1000 原子单位，默认 0.0；
- `basis`：默认 `complex`；`z`：$0<z\le20$，默认 1.0；`a_mu`：$0<a_\mu\le20$，默认 1.0；
- `resolution`：49–81，默认 65，必须为奇数；最低值随最大 $n$ 增长为 $\max(49,16n+17)$；
- `probability_mass`：0.50–0.99，默认 0.90。

与单态等值面同样保守限制为 $n\le4$（超出返回 422）。返回 `SuperpositionIsosurfacePayload`：在 `SuperpositionMetadata` 之外，几何字段与单态一致，另加有限盒/渲染网格诊断 `finite_box_tail_mass_upper_bound`、`finite_box_mass_variation_upper_bound`、`finite_grid_phase_variation_bound`、`finite_grid_aliasing_variation_lower_bound`、`finite_grid_mass_error_lower_bound`、`finite_grid_reporting_tolerance` 与 `finite_grid_mass_status`。

## `GET /api/superposition/current-field`

参数：

- `terms`、`time`、`basis`、`z`、`a_mu`：同上；连续性诊断最多支持 8 个活跃项，超出返回 422；
- `seed_count`：1–128，默认 24；
- `arc_step`：可选，窗口同为 $1/4096$–$1/8$，但相对的是**最紧凑的活跃 support length**（而非 $n^2/Z$），越界返回 422。

返回 `SuperpositionCurrentPayload`：在单态流场字段之外，`continuity_residual` 是完整的 $\partial\rho/\partial t+\nabla\cdot\mathbf j=0$；`continuity_scale_kind` 多出 `transition_coherence` 一种，`continuity_phase_count` 报告每个不同能隙审计的相位数，`density_rate_scale` 只作透明度参考，不作非定态的归一化分母。
