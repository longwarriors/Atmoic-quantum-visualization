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

QVPC 坐标是 float32。若正的 $Z$ 仍小到使径向表范围超出 float32 坐标可表示域，端点会在采样和强制转换前返回 422；库级采样器还会拒绝小于最小 float32 subnormal 的特征长度，并在 cast 后检查任何非零三维样本是否整体塌缩到原点。不会返回含 `Infinity` 或静默全零坐标的二进制体。

## `GET /api/orbitals/isosurface`

参数：

- `resolution`：49–81，必须为奇数；最低值随 $n$ 增长为 $\max(49,16n+17)$；
- `probability_mass`：0.50–0.99。

当前等值面 API 保守限制为 $n\le4$，但这不表示已经穷举验证该范围的全部轨道。对含径向节点的单一 s 态，builder 会先用高分辨率一维径向 oracle 得到所选 density level 的正确边界分量数，再在内部把请求网格提高到不超过 129 的奇数分辨率并复核 marching-cubes 连通分量；`grid_resolution` 报告的是这个**实际**值。若需求超过 129 或最终拓扑不匹配，请求以 422 fail-closed。

当前 3s 与 4s 的最低拓扑需求都超过该内部上限，因此公开 `resolution=49..81` 不存在可成功服务的取值；前端能力矩阵把这两个单态的等值面直接标为不可用并引导使用切片，而不是先发一个必然 422 的请求。2s 仍取决于 `probability_mass` 与数值门禁，不能按同一静态规则关闭。

多项叠加态绝不按“系数很小”冒充纯 s 态。只要仍有非零的激发 s 分量，就改走通用双网格门禁：直接执行会参与判决的**最细两级**，通常为 129/137；若径向 oracle 给出的最低需求位于 130–136，则用该需求值/137。两级必须在逐连通分量 Euler 特征多重集、density level、有限网格质量与捕获质量上同时稳定；不会构建判决从未读取的更粗探针，也不会为它们计费。payload warning 明确称它为**经验网格收敛证据**，不是径向解析证明。无法在上限内收敛则 422。精确零系数会先从 active terms 中剔除，因此真正的单项态仍走解析 oracle。catalog 的 `2s-2pz` 是物理负控制而不是“所有 representation 默认参数均可服务”的保证：当前等值面门禁在 `probability_mass=0.911` 与 `0.912` 通过，默认 0.90 因最细两级拓扑不稳定而 fail-closed。

返回 typed OpenAPI schema，包括 indexed mesh、法向、逐顶点相位、阈值、superlevel-set 质量、有限网格 $\int\rho dV$、网格间距和 Scene metadata。当前使用 JSON，生产规模可升级为 GLB 或自定义 mesh binary。

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

422 条件分三层，报错文本能区分是哪一层：

- **签名层**（FastAPI 的 `Query` 边界）：`resolution` $<65$ 或 $>513$、`n`/`l`/`m`/`z`/`a_mu` 越界、`plane` 或 `observable` 不是枚举成员，返回 FastAPI 的结构化 `detail` 列表；
- **路由预检层**：量子数之间不满足 $0\le\ell<n$ 或 $|m|\le\ell$，以及下述叠加态 grammar、term 数、端点 $n$ 上限或组合工作量超界；这些检查在 public builder 及其内部缓存之前完成；
- **builder 层**（`quviz.scene.slices` 抛 `ValueError`，路由转成 422 并原样带上原因）：`resolution` 为偶数（`resolution must be odd so the origin lies on the grid`——偶数轴不采样原点，而每条对称性/遮罩陈述都是关于过原点的平面说的），低于基础 $n$ 下限，或不足以在当前 extent 中采到由精确 generalized-Laguerre 根给出的最小径向特征。

基础下限 $\max(65,16n+17)$ 随 $n$ **线性**增长；builder 还从当前各 term 的精确径向节点半径与实际 extent 计算更严格的 state-specific floor，取二者较大值。它们共同防止显然欠采样，但仍**不是高 $n$ 收敛性或物理准确性的证书**。例如 4s 在 81 点会被拒、97 点通过并能看到 3 个正半轴径向节点；12s 以及 1s+12s 的最小尺度即使在硬上限 513 仍无法解析，因此明确拒绝。路由允许 $n\le12$ 是 schema/输入域上限，不承诺每个该范围内的状态都能在有限网格上可靠表示。

两类 slice 只在 `quviz.scene.slices` 的私有 builder 层保留一层 LRU；public builder 每次返回 deep copy，HTTP route 不再叠加第二层大 payload 缓存。调用方不能污染缓存，也不会让 JSON-ready 大数组被双重保留。

payload 体积是主要工程约束之一，但不是有效性的判据。实测（`n=2, l=1, m=0`，`xz`）：`resolution=129` 时 `probability_density` 响应 364,210 B（约 356 KB），`resolution=513` 时 5,736,707 B（约 **5.5 MB**；`phase` 因遮罩后大量重复值为 4,209,037 B）。513 是硬上限，129 之所以是默认值，是因为它够画一张清楚的图、又比上限便宜 16 倍；高阶态仍需独立验证收敛。

## 叠加态查询的通用预检

三个 `/api/superposition/*` 科学资产端点共用同一套紧凑 grammar：`terms` 是分号分隔的 `n,l,m,re[,im]`。字符串长度为 1–512 个字符，最多 8 个**编码项**；逗号之间以及 term 首尾的空字段都非法，不会被删除后重新解释。构造状态后最多仍有 8 个非零 active terms，并继续检查无重复、系数有限与 $\sum_k|c_k|^2=1$。

预检还在进入缓存和 builder 之前执行两类端点约束：

- 最大主量子数与对应单态能力一致：等值面 $n\le4$、概率流 $n\le6$、切片 $n\le12$；结合 $0\le\ell<n$ 与 $|m|\le\ell$，这也使返回的 term 一定能由 OpenAPI 中的 `SuperpositionTermSpec` 表达；
- 组合工作量按实际 active terms 估算：普通等值面的每次完整网格成本为 `active_terms × resolution³`，预检同时计入 mesh 构建与最终有限网格质量诊断两次，上限 2,500,000 term-voxel evaluations；单项激发 s 态另计入可能的选定 level 重建和最终 129 诊断，含激发 s 的多项态只把实际构建并参与判决的最细两个拓扑网格以及最终诊断网格逐次相加，二者使用 16,000,000 的自适应上限。典型 129/137 门禁的两项态成本为 14,578,790，仍可进入 builder；三个及以上 active terms 至少为 21,868,185，必在 builder 前拒绝。这里界定的是请求参数可预见的完整网格 term evaluation，不声称精确涵盖 marching-cubes 顶点数量等数据相关工作。切片为 `active_terms × resolution²`，上限 1,500,000 term-pixel evaluations；
- 概率流使用与积分器相同的 `max_points` 上界：`active_terms × seed_count × [1 + 5(max_points − 1)]` 不得超过 2,000,000 term-velocity evaluations，`seed_count × max_points` 不得超过 100,000 serialized path samples。本征态取 `active_terms=1`。这里的 `seed_count` 是**请求值**，payload 同名字段是实际返回流线数，不能用来反算预检。

任一超限都在 builder 前返回 422，`detail` 同时报告实际 cost 与 limit。可归因于请求的物理域、float32/float64 可表示性、收敛或有限数失败同样以可解释的 422 返回；非预期编程错误不会被 blanket catch 改写，仍是 500。

## `GET /api/superposition/slice`

参数：

- `terms`、`time`、`basis`（默认 `complex`）、`z`、`a_mu`：遵循上面的叠加态通用预检；
- `plane`、`observable`、`resolution`：与 `/api/orbitals/slice` 相同（默认同为 `xz`、`probability_density`、129）。

**最大的 term 同时决定 extent、`resolution` 下限与遮罩的参照长度 $L_{\mathrm{ref}}=\max_k n_k^2a_\mu/Z$**：一个对 1s 切片诚实的 resolution 在这里可能被拒，而报错会点名是哪一层壳要求更多采样。返回 `SuperpositionSlicePayload`：几何、布局与遮罩字段与单态切片完全一致，metadata 换成 `SuperpositionMetadata`。

## `GET /api/orbitals/current-field`

参数：

- `n`：1–6，默认 3；`l`：0–5，默认 2；`m`：−5–5，默认 2；`z`：$0<z\le20$，默认 1.0；
- `basis`：默认 `complex`；
- `seed_count`：1–96，默认 48；
- `arc_step`：可选，缺省时取 $0.03\,n^2/Z$；显式给出时，`arc_step` 与 $n^2/Z$ 之比必须落在 $[1/4096,\ 1/8]$ 内（含端点），越界返回 422。该窗口只是必要条件：较小步长会增大 `max_points`，仍可能触发上述两个请求级预算；
- 极端但为正的 $Z/a_\mu$ 若使概率流的四次尺度超出 float64 可表示域，也会以说明范围的 422 拒绝。

返回 `CurrentFieldPayload`：等弧长采样的流线顶点、逐顶点 $|\mathbf j|/\rho$ 速率、`arc_step_bohr`、`seed_density_floor`、`extent_bohr`，以及连续性诊断 `continuity_residual`、`continuity_absolute_residual`、`continuity_scale`、`continuity_scale_kind`（`stationary_current` 或 `analytic_zero_current`）、`continuity_probe_count`。`seed_count` 字段是**实际返回的流线条数**，不是请求的种子数。

实基或 $m=0$ 的定态概率流恒为零，此时返回空的 `lines` 与 metadata 警告，而不是错误——“没有流动”是物理上正确的答案。

密度遮罩不是固定 ordinary-Bohr 数字：它随 $(Z/a_\mu)^3$ 缩放。每条流线把自己的初始有限速度固定为相对 cutoff 参照，因此慢线的生死不依赖同批是否恰有一条快线。速度/电流向量长度使用不先平方分量的稳定 `hypot` 归约，避免仍可表示的极小共同尺度在 norm 中下溢为零。序列化前，顶点按 $a_\mu/Z$ 无量纲化后保留六位小数；速度按 $Z$ 无量纲化后**逐值保留 12 位有效数字**，不使用绝对小数位或整束最大值，故弱相干的非零流不会被清成零，`max_speed` 严格取自最终 `speed` 数组。

## `GET /api/superposition/catalog`

无参数。返回 typed 叠加态预设列表，每项含 `id`、`label`、`terms`（可直接传给下面三个端点的查询串）、`period_au`、`note` 与 `slice_resolution_floor`。该楼层由 slice builder 的同一个 extent CDF / Laguerre 径向特征计算生成，是该预设第一个可接受的奇数 uniform grid；它对 $Z$ 与 $a_\mu$ 不变，因为相关长度按同一尺度缩放。前端选择预设时在一次 store 写入中同时提升 resolution，不复制数值算法；当前 `1s-3dz2` 发布 103。

非简并两项态的默认尺度周期由 $2\pi/|E_b-E_a|$ 计算，不手写近似常数；前端再按当前 $a_\mu/Z^2$ 换算。简并预设的 `period_au` 为 0，用作 negative control：这类态的密度不应移动，UI 也不提供伪动画。

## `GET /api/superposition/isosurface`

参数：

- `terms`：采用上面的严格 grammar 与长度/数量限制，默认 `1,0,0,0.7071067811865476;2,1,0,0.7071067811865476`；任何无法解析或违反 $0\le\ell<n$、$|m|\le\ell$、$\sum|c_k|^2=1$ 的请求返回 422；
- `time`：−1000–1000 原子单位，默认 0.0；
- `basis`：默认 `complex`；`z`：$0<z\le20$，默认 1.0；`a_mu`：$0<a_\mu\le20$，默认 1.0；
- `resolution`：49–81，默认 65，必须为奇数；最低值随最大 $n$ 增长为 $\max(49,16n+17)$；
- `probability_mass`：0.50–0.99，默认 0.90。

与单态等值面同样保守限制为 $n\le4$（超出返回 422），组合工作量上限见通用预检。单项 s 态使用径向解析 oracle；含非零激发 s 分量的多项态使用上述最细双网格门禁并把实际分辨率写入 `grid_resolution`。其他一般多项态仍只有质量/alias 诊断，不能据此宣称拓扑已证明。返回 `SuperpositionIsosurfacePayload`：在 `SuperpositionMetadata` 之外，几何字段与单态一致，另加有限盒/渲染网格诊断 `finite_box_tail_mass_upper_bound`、`finite_box_mass_variation_upper_bound`、`finite_grid_phase_variation_bound`、`finite_grid_aliasing_variation_lower_bound`、`finite_grid_mass_error_lower_bound`、`finite_grid_reporting_tolerance` 与 `finite_grid_mass_status`。

## `GET /api/superposition/current-field`

参数：

- `terms`、`time`、`basis`、`z`、`a_mu`：同上；最多 8 个编码项/活跃项，且每项 $n\le6$；
- `seed_count`：route 外框为 1–40，默认 24；
- `arc_step`：可选，窗口同为 $1/4096$–$1/8$，但相对的是**最紧凑的活跃 support length**（而非 $n^2/Z$），越界返回 422；即使位于窗口内，仍受 RK4 work 与序列化点数双预算约束。

返回 `SuperpositionCurrentPayload`：在单态流场字段之外，`continuity_residual` 是完整的 $\partial\rho/\partial t+\nabla\cdot\mathbf j=0$；`continuity_scale_kind` 多出 `transition_coherence` 一种，`continuity_phase_count` 报告每个不同能隙审计的相位数，`density_rate_scale` 只作透明度参考，不作非定态的归一化分母。
