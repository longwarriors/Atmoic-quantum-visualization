# 质量门禁

!!! note "门禁定义"

    Unix 使用 `make check`，Windows PowerShell 使用 `& .\scripts\check.ps1`。只有所有适用门禁在同一提交上通过，才能称为“全绿”；最新结果见[当前状态](../project/status.md)。

!!! warning "状态标记是本页的强制格式"

    本页第 49 行要求“已实现”“已验证”“计划中”不得混写，因此每一条目必须带状态：

    - ✅ **已门禁**：由 `make check` / `check.ps1` 在每次提交上自动强制，并指明测试位置；
    - 🧑 **人工门禁**：必须人工复核，无法自动化，评审时逐条确认；
    - 🕒 **计划中**：已列入[路线图](../project/roadmap.md)，当前**没有**任何自动检查。

    只写目标而不标状态的条目一律视为文档缺陷。

## 解析态

- ✅ $\int|\psi|^2dV=1$ — `tests/test_hydrogenic.py::test_radial_functions_are_normalized`；
- ✅ 正交性（径向、角向、跨 $n$ 跨 $\ell$ 全波函数） — `tests/test_analytic_gates.py` 三项 `*_orthonormal_*`；
- ✅ 节点数 $N_{\text{radial}}=n-\ell-1$（$n\le6$ 全部 $(n,\ell)$） — `test_radial_node_count_matches_n_minus_l_minus_one`；
- ✅ $H\psi-E\psi$ 残差 — `test_radial_hamiltonian_residual_vanishes_for_eigenstates`；
- ✅ $\langle L^2\rangle$ 与 $\langle L_z\rangle$ — `test_spherical_harmonics_are_angular_momentum_eigenfunctions`；
- ✅ 已知 $\langle r\rangle$、$\langle1/r\rangle$ — `test_expectation_radial_matches_known_closed_forms`；
- ✅ 约化质量比进入能量而非写死电子质量 — `test_energy_scales_with_reduced_mass_ratio`；
- ✅ $\theta\in[0,\pi]$、$\phi\in[0,2\pi)$ 角度范围约定 — `test_cartesian_to_spherical_uses_documented_angle_ranges`；
- ✅ Condon–Shortley 相位与实轨道 Cartesian 形式（$\ell=1,2$） — `test_real_p_harmonics_match_cartesian_directions`、`test_real_d_harmonics_match_cartesian_closed_forms`。

!!! info "为什么这些门禁要用独立参照"

    每一条都对照**独立推导的参照**验证，而不是另一条 QuViz 代码路径：闭式期望值、对 $\psi$ 自身作有限差分得到的算符、或独立求积规则。否则测试只会证明代码与自己一致。

    这些门禁经过变异测试：故意破坏 `sph_harm_y` 角度顺序、Laguerre 阶数、Condon–Shortley 相位、能量常数或概率流的 $m$ 因子后，必须有测试变红。

## 数值求解

- ✅ 网格坐标、`dx`、积分权重和边界条件来自同一 Grid 对象 — `tests/test_grid.py`；
- 🕒 报告盒长和网格收敛；
- 🕒 Coulomb 原点不能用任意深势阱硬截断；
- 🕒 简并子空间不能只按“第几个本征向量”命名；
- 🕒 TDSE 检查范数、能量和连续性残差（定态退化情形 $\nabla\cdot\mathbf j=0$ 已门禁，见下）。

## 采样

- ✅ 径向/角向边际检验（KS 检验，对照解析 CDF） — `tests/test_analytic_gates.py` 三项 `test_sampled_*_marginal_passes_ks`；
- ✅ 三维矩 — `test_sampled_moments_match_analytic_expectations`；
- ✅ 截断概率显式报告 — `radial_mass_captured` 字段与 `X-QuViz-Radial-Mass` 响应头；
- 🕒 拒绝采样包络必须是严格上界（当前实轨道方位角采样以 $M=1$ 构造性满足，但无测试）；
- 🕒 MCMC 报告 ESS 和 nodal-pocket mixing。

## 概率流

- ✅ 与第一性原理 $\mathbf j=\operatorname{Im}(\psi^*\nabla\psi)$ 一致 — `test_current_matches_im_psi_star_grad_psi`；
- ✅ 定态连续性残差 $\nabla\cdot\mathbf j=0$ — `test_stationary_current_satisfies_continuity`；
- ✅ $\pm m$ 密度相同而流反向 — `test_current_reverses_sign_with_m_while_density_is_unchanged`；
- ✅ 流线积分器保柱半径/高度、按解析周期闭合、$\pm m$ 镜像 — `tests/test_streamlines.py`；
- ✅ payload 报告实测 $\nabla\cdot\mathbf j$ 残差而非宣称该性质 — `CurrentFieldPayload.continuity_residual`；
- 🕒 含时叠加态的 $\partial\rho/\partial t+\nabla\cdot\mathbf j=0$（M1）。

## 几何与等值面

- ✅ 目标概率质量与有限网格积分 — `tests/test_scene_contract.py::test_isosurface_payload_is_semantically_complete`；
- ✅ 节点连通性（1s、2p、3p） — `test_pz_isosurface_...`、`test_3p_surface_...`；
- ✅ 面绕向一致率 > 99%（按面计数，不用面积加权均值） — `test_pz_isosurface_preserves_nodal_plane_and_winding`；
- ✅ 法向朝密度降低方向 — `test_isosurface_normals_point_away_from_higher_density`；
- 🕒 $n>4$ 的收敛策略与拓扑回归。

## 前端

- ✅ TypeScript 严格模式 — `npm run build`（`tsc -b`）；
- 🕒 binary parser 单测；
- 🕒 geometry/material 正确 dispose；
- 🕒 相位色轮周期连续；
- 🕒 截图视觉回归仅作为辅助；
- 🧑 UI 不能隐藏关键警告和单位。

## 文档与引用

- ✅ `mkdocs build --strict`；
- ✅ 所有 `[\@key]` 存在 — `tests/test_bibliography.py::test_all_documentation_citation_keys_exist`；
- ✅ 生成索引与 `references.bib` 同步 — `scripts/render_reference_index.py --check`；
- ✅ Markdown 不含换页符等意外 C0 控制字符；
- 🕒 外链存活与内容漂移检查（当前**没有**任何门禁发起 HTTP 请求）；
- 🕒 `references.bib` 中未被正文引用的孤儿键检查（当前只校验 used ⊆ known 单向）；
- 🧑 Mermaid、数学公式和 API 文档在生成 HTML 中真正渲染，而非只通过构建；
- 🧑 已知纠错不可被旧教程重新引入；
- 🧑 引用是否真正支持正文声明；
- 🧑 “已实现”“已验证”“计划中”三个状态不得混写。
