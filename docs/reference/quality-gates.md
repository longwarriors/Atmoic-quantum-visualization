# 质量门禁

!!! note "门禁定义"

    Unix 使用 `make check`，Windows PowerShell 使用 `& .\scripts\check.ps1`。只有所有适用门禁在同一提交上通过，才能称为“全绿”；最新结果见[当前状态](../project/status.md)。

!!! warning "状态标记是本页的强制格式"

    [文档与引用](#docs-and-citations)一节要求“已实现”“已验证”“计划中”不得混写，因此每一条目必须带状态：

    - ✅ **已门禁**：由 `make check` / `check.ps1` 在每次提交上自动强制，并指明测试位置；`check.ps1` 的每一步都在脚本自身所在的仓库根目录执行（启动时打印该路径），与调用者当前目录无关，因此从另一个 checkout 以绝对路径调用也不会混用两棵树（`tests/test_check_script.py`）；
    - 🌐 **仅 CI、需网络**：只由 GitHub Actions 执行，因为要访问网络，**不在** `make check` / `check.ps1` 内，本地提交不会触发；触发时机见各条目说明；
    - 🖥️ **仅 CI、需 Linux/SwiftShader**：只由 GitHub Actions 的 Linux runner 执行，因为判据是像素，而像素由那台机器的图形栈决定，**不在** `make check` / `check.ps1` 内；与 🌐 的区别不是“需要网络”而是“需要那一个渲染环境”——它在别的平台上不是变慢或变不准，而是**根本不允许运行**；
    - 🔗 **仅 CI、全栈集成**：由 CI 把真实后端、生产前端构建和浏览器接在同一进程树中执行，**不在** `make check` / `check.ps1` 内；可在准备好锁定依赖与 Chromium 的本地 checkout 手动复现，但本地通过不替代 CI runner 的结果；
    - 🧑 **人工门禁**：必须人工复核，无法自动化，评审时逐条确认；
    - 🕒 **计划中**：已列入[路线图](../project/roadmap.md)，当前**没有**任何自动检查。

    只写目标而不标状态的条目一律视为文档缺陷。

## 解析态

- ✅ $\int|\psi|^2dV=1$ — `tests/test_hydrogenic.py::test_radial_functions_are_normalized`；
- ✅ 正交性（径向、角向、跨 $n$ 跨 $\ell$ 全波函数） — `tests/test_analytic_gates.py` 三项 `*_orthonormal_*`；
- ✅ 节点数 $N_{\text{radial}}=n-\ell-1$（$n\le6$ 全部 $(n,\ell)$） — `test_radial_node_count_matches_n_minus_l_minus_one`；
- ✅ $H\psi-E\psi$ 残差 — `test_radial_hamiltonian_residual_vanishes_for_eigenstates` 与 `tests/test_pr7_mass_hamiltonian.py`；五点差分经 Richardson 外推并按 $na_\mu/Z$ 缩放，门禁覆盖 $n=6$、$Z=0.05$、$a_\mu=0.5$，要求折半收敛比大于 32，并证明默认路径确实从会超过原物理门槛的初始步长继续细化；
- ✅ $\langle L^2\rangle$ 与 $\langle L_z\rangle$ — `test_spherical_harmonics_are_angular_momentum_eigenfunctions`；
- ✅ 已知 $\langle r^p\rangle$ — `test_expectation_radial_matches_known_closed_forms` 与 `tests/test_pr7_radial_moments.py`；高阶门禁以 1s 闭式独立验证 $p=31,60,170$，并用 $n=6,l=5,p=60$ circular-state Gamma 比率排除 1s 特化；同时要求节点折半与连续两次计算域扩张收敛，不可表示的 $p=200$ 明确报 overflow，不返回 `inf`；
- ✅ `SuperpositionState`→scene/API 链路中的约化质量只有一个真源：`a_mu=m_e/μ` 同时决定 $a_\mu/Z$ 空间尺度、`reduced_mass_ratio=1/a_mu` 能量/相位、概率流 prefactor 与 scene extent — `test_energy_scales_with_reduced_mass_ratio` 及 `tests/test_pr7_mass_hamiltonian.py`；低层 energy primitive 保留显式 ratio 参数；
- ✅ $\theta\in[0,\pi]$、$\phi\in[0,2\pi)$ 角度范围约定 — `test_cartesian_to_spherical_uses_documented_angle_ranges`；
- ✅ Condon–Shortley 相位与实轨道 Cartesian 形式（$\ell=1,2$） — `test_real_p_harmonics_match_cartesian_directions`、`test_real_d_harmonics_match_cartesian_closed_forms`。

!!! info "为什么这些门禁要用独立参照"

    每一条都对照**独立推导的参照**验证，而不是另一条 QuViz 代码路径：闭式期望值、对 $\psi$ 自身作有限差分得到的算符、或独立求积规则。否则测试只会证明代码与自己一致。

    这些门禁经过变异测试：故意破坏 `sph_harm_y` 角度顺序、Laguerre 阶数、Condon–Shortley 相位、能量常数或概率流的 $m$ 因子后，必须有测试变红。

## 数值求解

- ✅ 网格坐标、`dx` 和边界条件来自同一 Grid 对象 — `tests/test_grid.py`；`DirichletGrid1D` 的 `coordinates`、`dx` 与 `laplacian()` 共用同一间距（`dx` 计入两个被省略的边界节点），`PeriodicGrid1D` 的坐标是半开区间，测试对二者各断言一次；
- 🕒 积分权重和内积**尚未**由 Grid 提供：`quviz.solvers.grid` 当前只有坐标、`dx` 和 Dirichlet Laplacian，没有求积权重，也没有内积，`tests/test_grid.py` 因此也没有相应断言；完整的数值契约（权重、内积、范数与能量的一致定义）随[路线图](../project/roadmap.md) M2 的 1D TISE/TDSE 求解器一并落地；
- 🕒 报告盒长和网格收敛；
- 🕒 Coulomb 原点不能用任意深势阱硬截断；
- 🕒 简并子空间不能只按“第几个本征向量”命名；
- 🕒 TDSE 检查范数、能量和连续性残差（定态退化情形 $\nabla\cdot\mathbf j=0$ 已门禁，见下）。

## 采样

- ✅ 径向/角向边际检验（KS 检验，对照解析 CDF） — `tests/test_analytic_gates.py` 三项 `test_sampled_*_marginal_passes_ks`；
- ✅ 三维矩 — `test_sampled_moments_match_analytic_expectations`；
- ✅ 截断概率显式报告 — `radial_mass_captured` 字段与 `X-QuViz-Radial-Mass` 响应头；
- ✅ 径向 CDF 以质量、平均半径和整条 CDF 的嵌套网格差共同收敛；角向 $\cos\theta$ CDF 以质量和整条 CDF 的嵌套差共同收敛；两者入口都拒绝超过 131,073 点的初始表，细化达到同一上限仍不收敛即 fail-closed — `tests/test_sampling.py`；
- ✅ QVPC float32 坐标在 cast 前同时验证 diffuse 上溢与最小 subnormal 长度边界，cast 后拒绝任何非零三维样本整体塌缩到原点：边界值输出全有限，向下一个 `nextafter` 明确拒绝；极小正 $Z$ 经 HTTP 返回 422 而非损坏二进制 — `tests/test_sampling.py`、`tests/test_api.py`；
- 🕒 拒绝采样包络必须是严格上界（当前实轨道方位角采样以 $M=1$ 构造性满足，但无测试）；
- 🕒 MCMC 报告 ESS 和 nodal-pocket mixing。

## 概率流

- ✅ 与第一性原理 $\mathbf j=\operatorname{Im}(\psi^*\nabla\psi)$ 一致 — `test_current_matches_im_psi_star_grad_psi`；另有 $Z=10^{-4}$、`a_mu=0.2` 的解析尺度协变回归；
- ✅ 定态连续性残差 $\nabla\cdot\mathbf j=0$ — `test_stationary_current_satisfies_continuity`；
- ✅ $\pm m$ 密度相同而流反向 — `test_current_reverses_sign_with_m_while_density_is_unchanged`；
- ✅ 流线积分器保柱半径/高度、按解析周期闭合、$\pm m$ 镜像 — `tests/test_streamlines.py`；每条线固定自己的初始速度参照，慢速 $10^{-200}$ 线单独、与单位速度线成束、重排后的结果相同；向量长度以稳定 `hypot` 归约，$Z=a_\mu=10^{-160}$ 的仍可表示电流不会被平方下溢成零；
- ✅ 速度按 $Z$ 无量纲化后逐值保留 12 位有效数字；$10^{-8}$ / $10^{-12}$ 弱相干的非零速度不会被固定小数位清零，`max_speed` 与最终数组严格一致，$Z=0.1$ 的弱流仍满足尺度协变 — `tests/test_streamlines.py`；
- ✅ 请求级概率流资源门禁使用 `active_terms × [seed_filter_evaluations_per_term + seed_count × (1+5(max_points−1))] ≤ 2,000,000` 与 `seed_count × max_points ≤ 100,000`；数值积分叠加态把 $21^3$ 候选 lattice 的逐项零速过滤计入前者，本征态与解析零流早退的过滤成本为 0；本征/叠加 route 外框分别为 96/40，叠加 catalog 再用同一 estimator/guard 发布逐态 `streamline_seed_count_max`。当前四项精确映射为 40/40/24/40，`1s+3d_z²` 的 24 通过而 25 在 builder 前因 102,400 path samples 拒绝；八项态 11/12 边界另钉住固定 seed 过滤与 RK4 积分都不能被漏算 — `tests/test_api.py`；
- ✅ payload 报告绝对残差、归一化尺度、尺度种类与探针数，而非只宣称 $\nabla\cdot\mathbf j=0$ — `CurrentFieldPayload.continuity_*` 与 `tests/test_pr7_scene_diagnostics.py`；空间探针、差分步长、弧长步长和密度 cutoff 均有 $n/Z/a_\mu$ 协变门禁；
- ✅ 含时叠加态的 $\partial\rho/\partial t+\nabla\cdot\mathbf j=0$ — `tests/test_superposition.py` 与 `tests/test_pr7_scene_diagnostics.py`；$\partial\rho/\partial t$ 取闭式，归一化先按同能隙相干合并、再按不同能隙平方和开根，builder 对每个不同能隙审计四个相位；恒零 current 的负控制在 1s–2p 转折点会得到 1 而不是空洞的 0；
- ✅ 叠加态范数与 $\langle H\rangle$ 守恒（依赖上面的正交性门禁）；
- ✅ 1s–2p 偶极振幅与 Bohr 频率对照闭式；简并叠加密度不动。

## 几何与等值面

- ✅ 目标概率质量与有限网格积分 — `tests/test_scene_contract.py::test_isosurface_payload_is_semantically_complete`；
- ✅ 节点连通性（1s、2p、3p） — `test_pz_isosurface_...`、`test_3p_surface_...`；
- ✅ 面绕向一致率 > 99%（按面计数，不用面积加权均值） — `test_pz_isosurface_preserves_nodal_plane_and_winding`；
- ✅ 法向朝密度降低方向 — `test_isosurface_normals_point_away_from_higher_density`；
- ✅ 含径向节点的单一 s 态使用一维径向拓扑 oracle、有界自适应网格和最终连通分量复核 — 2s 在 mass=0.9 从请求 81 自动升至实际 123 并得到 3 个正确边界分量；3s/4s 及高质量 2s 在需求超过内部 129 上限时 fail-closed；
- ✅ 非零激发 s 分量的多项叠加态绝不按系数容差冒充纯 s 态；$10^{-3}$、$10^{-8}$、$10^{-12}$ 近纯 2s 必须在 137 上限的最细 129/137 两级通过逐分量 Euler、density level 与质量门禁，等权 2s+2p 及“粗网格先稳定、最细网格再失稳”的反例均 fail-closed。精确零伴项被剔除后仍走径向 oracle；只构建并计费会参与判决的最细两个拓扑网格与最终诊断，真实 builder 的逐 term 完整立方网格求值记录必须与 estimator 逐项一致；两项 129/137 成本低于 16M，三项成本高于上限并在 builder 前拒绝 — `tests/test_scene_contract.py`、`tests/test_api.py`；
- ✅ 有限盒真实质量变化与 render-grid alias 分开报告 — `tests/test_pr7_scene_diagnostics.py`；2p+4p 的同宇称离散漂移必须超过保守有限盒变化界至少 $10^6$ 倍，1s+2p 的反宇称质量必须在半周期保持不变，同能隙相干相消的四项负控制不得误报 phase-dependent error；
- 🕒 不含激发 s 分量的一般多项叠加态及 $n>4$ 的通用拓扑证明；当前质量/alias 诊断不等于拓扑证书。

## API 数值失败与缓存

- ✅ 可归因于请求的 `ValueError`、具名 `ScientificComputationError`、`FloatingPointError` 与 `OverflowError` 在全部七类科学资产 builder 路径上转成保留原因的 422；普通 `RuntimeError` 家族不再 blanket catch。唯一的第三方边界例外是 `skimage.measure.marching_cubes` 自身抛出的**精确** `RuntimeError`：builder 就地包装为 `ScientificComputationError`，所以极小但合法的 `1s, Z=1e-20` float32 等值面塌缩返回带原因的 422；该调用点注入 `RecursionError`，以及路由注入 `RecursionError`/`AssertionError` 的负控制仍为 500 — `tests/test_api.py`；
- ✅ float64 极值采用“普通输入保留原算术，只有直接中间量接近边界或已经溢出/下溢才转入 100 位十进制复算”的门禁：径向归一化在 `float.__pow__` 舍入边界不再泄漏裸 `(34, 'Result too large')`，径向自变量在 `Z=a_mu=1e308` 时先安全约去共同尺度而不静默归零，密度 floor 与径向节点在最大有限值及最小次正规数边界按精确二进制输入正确舍入，NumPy 标量进入兜底也不会泄漏类型错误；最终结果确实不可表示才抛含参数语境的 `ValueError` 并由 HTTP 保留为可读 422；普通切片 golden 仍逐字节不变 — `tests/test_hydrogenic.py`、`tests/test_api.py`、`tests/test_slice_contract.py`；
- ✅ 两类 slice 只保留私有 builder LRU，public builder 返回 deep copy，HTTP route 不再重复缓存大 payload；相同路由调用仍逐次经过 public builder，且调用方变异不能污染下一次结果 — `tests/test_api.py`、`tests/test_slice_builders.py`。

## 前端

- ✅ TypeScript 严格模式 — `npm run build`（`tsc -b`）；测试代码由 `tsconfig.test.json` 单独类型检查；
- ✅ binary parser 单测 — `web/src/api/qvpc.test.ts`，含**跨语言黄金向量**（见下）；
- ✅ 能力矩阵的 route 数值边界、本征态 ceiling 与 Z 固定参数逐项对照 committed OpenAPI；4s–8s 切片的 97/141/193/251/319 state-specific 楼层由 Python 生产 builder 重新推导后对照 TypeScript 表；叠加态 catalog 的 `slice_resolution_floor` 与 `streamline_seed_count_max` 经生成 schema、严格 wire parser、capability、request planner、ControlPanel 与真实 store 贯穿。当前 `1s + 3d_z²` 的切片边界为 101→422、103→200，流线 UI/store/planner 上限均为 24；store 启动不预置 40，catalog 拉取/解析失败或缺少当前条目时原子撤销流线能力。缺失或损坏的 seed metadata 不再猜测回落值，而是 fail-closed 为不可请求，选择与迟到同步均在首个 plan 前原子 clamp — `tests/test_api.py`、`tests/test_slice_api.py`、`web/src/api/capability.test.ts`、`web/src/api/client.test.ts`、`web/src/state/useSceneStore.test.ts`、`web/src/components/ControlPanel.test.tsx`；
- ✅ 相位色轮周期连续 — `web/src/scene/color.test.ts`；
- ✅ `src/**` 下全部 `.ts` / `.tsx`（PR-8A 起把 React/three 层一并纳入；只排除测试文件与两个“仅含类型”模块 `types.ts`、`schema.gen.ts`，而“仅含类型”由 `guards.test.ts` 解析每个文件、对任何编译器会生成代码的顶层语句变红来强制）的 vitest 覆盖率门槛（语句/函数/行 90%，分支 85%，按文件评估） — `npm run test` 执行 `vitest run --coverage`，低于门槛即 exit 1。`src/scene/shaders/` 曾作为“GLSL 字符串模块”整目录排除，但没有任何检查保证该目录里只有 GLSL 字符串：往里放一个带未覆盖分支的普通 `.ts` 并从 `color.ts` 调用，三道覆盖率门禁全绿、`npm run build` exit 0、那个分支照样进生产 bundle（实测）。该排除项已删除，shader 模块与其他模块一样受门禁，由 `src/scene/shaders/orbitalPoints.test.ts` 断言导出的着色器源码含场景真正依赖的 GLSL 入口点、uniform 与 varying；
- ✅ 前端门禁在 CI 里真的会跑 — `.github/workflows/ci.yml` 的 `web` job（`working-directory: web`、`actions/setup-node`、`npm ci`、`npm run test`、`npm run build`）与 `push` / `pull_request` 两个触发条件都由 `tests/test_check_script.py` 按结构钉住，且该 job 及其任何步骤都不得带 `if:` 或 `continue-on-error:`。此前整个 `web` job 可以被删掉而全部 pytest 照常通过，CI 会在前端门禁完全缺席的情况下变绿（实测）；
- 🔗 源码 checkout 的真实全栈浏览器门禁 — `web/fullstack-e2e/app.spec.ts` 不拦截 `/api`：`web/playwright.fullstack.config.ts` 先生产构建 SPA，再从仓库根运行文档化入口 `quviz serve`，由 FastAPI 的生产挂载直接托管 `web/dist`。单条线性产品旅程依次验证默认点云、2p_z 等值面、概率密度切片、catalog 提供的 3d complex 概率流示例、3d 等值面与默认解析叠加态；每个目标请求都必须 2xx，query 的有序键值集合（含重复键）必须与 UI 状态逐项相等，QVPC/1 响应头、资产规模、图例、能量与 settled scene identity 必须到达，且所有并发 API 请求结束并连续 500 ms 无新 API 活动后仍无 request failure、非 2xx、page error 或 console error。同源 OpenAPI 链接还真实读取 Swagger HTML 与 schema；Vite 开发配置把 `/docs`、`/openapi.json`、`/redoc` 和 `/api` 代理到同一后端。`npm run test:fullstack` 使用专用 `127.0.0.1:8765`；Playwright 后的 `assert-fullstack-run.mjs` 对 JSON 报告作闭合集合审计，要求绑定到正确 rootDir/testDir 的固定 spec 与标题恰好有一个 project execution 和一个 passing result，拒绝 0 tests、skip、flaky、重试掩盖、重复、额外测试或顶层错误；其 23 个合成正/负控在 `web/src/fullstackGate.test.ts`。CI 的 `web-fullstack` job 锁定 Python 3.12、Node 22、两份 lockfile、Chromium 安装、完整执行顺序与失败工件上传顺序；`tests/test_check_script.py` 钉住该 job 和完整 npm 入口。边界如实保留：这证明源码检出环境的生产挂载，不证明当前 wheel 已包含 `web/dist`；JSON 审计证明固定标题实际通过，不解析测试体内六段旅程与断言的 AST，保持同名标题却删弱测试体仍依赖代码评审，后续需增加内容 manifest；
- ✅ 前端零 skip — `npm run test` 在 vitest 之后运行 `web/scripts/assert-no-skips.mjs` 核对 `coverage/vitest-results.json` 的运行结果：任何非 passed 的测试、缺席的 spec 文件或非零 pending/todo/failed 计数都失败；`web/src/guards.test.ts` 另对 spec 源码扫描 skip/todo/only/skipIf/runIf 的各种拼写与受门禁模块里的 coverage ignore 注释。该源码扫描同时覆盖 `web/e2e/` 与 `web/fullstack-e2e/` 下的 Playwright spec——那些文件不在 `test.include` 里，vitest 从不收集，`allowOnly: false` 与 `assert-no-skips.mjs` 因此都看不见它们（后者的期望清单由 `src/` 推导，一个它从未期望过的文件不会被“漏掉”）。`web/e2e/` 的权威门禁是 `assert-visual-run.mjs`，`web/fullstack-e2e/` 的权威门禁是 `assert-fullstack-run.mjs`，源码扫描是二者的第二层；两棵 Playwright spec 树都先用 TypeScript 解析器把注释涂白再逐行匹配，因为正文会解释“为什么这里断言而不是 skip”并因此写出那个调用（实测：直接扫原文会在 `webgl.spec.ts:13` 命中一段散文）；字符串字面量**不**涂白，所以 `runner['sk' + 'ip']` 之类的拼写仍然可见；
- ✅ 场景 GPU 资源 dispose — 五个场景组件各有两条断言（卸载时释放、换 payload 时释放被取代的那一份）：`web/src/scene/ElectronCloud.test.tsx`、`OrbitalSurface.test.tsx`、`CurrentStreamlines.test.tsx`、`Atmosphere.test.tsx` 与 `SliceField.test.tsx`；切片一层同时覆盖 texture、geometry 与 material 三者（`leaves no GPU resource behind when it goes`、`rebuilds the texture when a new payload arrives, and drops the old one`）。断言的是 `dispose` 被调用，不是显存实际回落——后者要测量，属于[路线图](../project/roadmap.md)的性能预算；
- 🖥️ 切片渲染的截图回归 — 测试位置：`web/e2e/slice.spec.ts`（五张已提交基线统一为 `672×704`：`2pz-real-xz` 的节线必须**水平**，`2p+1-phase-xy` 的相位必须逆时针缠绕一整圈且原点是遮罩留下的洞，`degenerate-*-xz` 在 $t=0$ 与 $t=8.4$ 必须是**同一张**图，`1s2pz-t0` / `-t8.4` 是相差半个 Bohr 周期的两张；固定桌面壳把 canvas 尺寸与控制栏/Inspector 内容高度解耦）、`web/e2e/webgl.spec.ts`（渲染器字符串仍是 ANGLE/SwiftShader、WebGL2 仍可用——是**断言**而不是 `skip`，因为“没有 WebGL2”恰好是让每张基线失效的那个条件）、`web/e2e/fixtures.ts`（六份切片 payload 与两份 catalog 逐字节取自 `tests/fixtures/visual/`，由 `scripts/write_visual_fixtures.py` 写、`tests/test_visual_fixtures.py` 重建并比对，所以一次 diff 只能是关于渲染的，不会变成关于服务器今天返回了什么的争论）。正向像素比较使用 `threshold: 0.02` 与 `maxDiffPixelRatio: 0.001`；半周期、转置与 2% 平面尺寸错误三个负对照即使分别放宽到 `0.05` / `0.1` / `0.1` 也必须拒绝，且运行时守卫禁止负对照阈值比正向阈值更严格；几何负控的 `includeAA: false` 只排除单像素抗锯齿边缘，2% 尺寸变异保留了多像素实色带。运行方式：`npm run test:visual` = `playwright test` 之后 `web/scripts/assert-visual-run.mjs`；后者读 Playwright 自己的 JSON 报告，对被跳过的用例、根本没被收集的 spec 文件、以及 `updateSnapshots != 'none'`（即 `--update-snapshots` 这种“把自己刚画的东西写成答案”的运行）一律 exit 1——它的审计逻辑由 `web/src/visualGate.test.ts` 在普通 vitest 套件里用合成报告验证，因为 Playwright 本身在 Windows 开发机上按设计跑不起来。CI 接线：`.github/workflows/ci.yml` 的 `web-visual` job（`ubuntu-latest`、`working-directory: web`、`npm ci --no-audit --no-fund`、`npx --no-install playwright install --with-deps chromium`、`npm run test:visual`，失败时上传 `web/playwright-report` 与 `web/test-results`，保留 7 天），由 `tests/test_check_script.py` 按 YAML 结构钉住：job 本身、runner、工作目录、两条安装命令的**逐字拼写**、gate 步骤及其必须排在浏览器安装之后、与 `web` job 同一个 Node 版本、以及“除失败上传外任何步骤都不得带 `if:`，上传的 `if:` 必须恰好是 `failure()`“（实测四种改法各自变红：删 job、给 gate 步骤加 `if:`、把上传的 `if:` 改成 `always()`、把 `--no-install` 去掉）。`web/src/guards.test.ts` 的零 skip 源码扫描同时覆盖 `web/e2e/`；
- ✅ 视觉门禁完整性 — `assert-visual-run.mjs` 使用闭合集合钉住 2 个 spec、8 个必需测试标题及其恰好一次执行；Playwright 的 JSON 报告不记录普通 assertion，所以同一脚本再用锁定的 TypeScript AST 解析器把 7 条正向截图比较、3 条 `.not.toHaveScreenshot` 机制负控和 3 条 WebGL/SwiftShader 断言钉到各自精确测试标题。删测试、换标题、把断言改成注释、拿额外绿测试顶账、复制同名执行或从错误 spec 报告都会由 `visualGate.test.ts` 的负控制变红；
- 🧑 UI 不能隐藏关键警告和单位。

!!! warning "截图门禁不覆盖什么，以及它到底多出了哪一句"

    **`check.ps1` / `make check` 完全不覆盖视觉映射。** `web/playwright.config.ts` 在非 Linux 上于**模块加载时**直接抛错，所以这条门禁在开发机上不是“没跑”，而是**不允许跑**。这不是洁癖：基线是 Linux CI 镜像上 SwiftShader（Chromium 的软件光栅化器）画出来的像素，Windows 与 macOS 的字体栅格化、次像素定位和可用的 ANGLE 后端都不同，同一份代码在那里渲染出可见不同的图。真正的危险不是本机全红，而是本机全红之后有人顺手敲 `--update-snapshots`——那会**用这台机器的像素覆盖掉 CI 基线**，此后套件本地绿、CI 红，并且不再描述任何回归。所以守卫是抛错而不是 `skip`：`skip` 之下 `--update-snapshots` 照样能写。

    **每一条截图声明都另有一条与平台无关的 vitest 断言。** 图片多出来的只有一句：**固定的 Linux/Chromium/SwiftShader WebGL 管线确实把它光栅化成了这些像素**。对照关系是：行主序布局与“样本 (row, col) 落在第 `4 * (row * resolution + col)` 个字节“由 `scene/sliceTexture.test.ts` 断言；这里能抓渲染器自己的索引或 uv 转置，但输入 payload 本身已经被转置时仍会满足客户端契约，所以 `slice.spec.ts` 另用一个转置 fixture 作端到端负控；被遮罩的样本渲染成**全透明且为黑**、极小振幅仍不透明、色标按切片自身极值归一化，同样在 `sliceTexture.test.ts`；相位色轮的周期性、$\pm A$ 两极不同色、零点为消色中性、发散色标的色相反对称由 `scene/sliceColor.test.ts` 断言；$u\times v=n$ 的右手标架、`xz` 的 $-\hat y$ 法向、以及“遮罩样本经 `sliceValueAt` 读作 `null` 而不是哨兵 `0.0`“由 `api/sliceContract.test.ts` 断言；四项纹理采样与色彩空间决定（两个 `NearestFilter`、`flipY = false`、`SRGBColorSpace`）、quad 尺寸规则与三张主平面各自的朝向由 `scene/SliceField.test.tsx` 断言；视点是平面自己的法向由 `scene/camera.test.ts` 断言。这就是分工：数值断言说“映射是对的”，截图只说“这条正确的映射确实被固定软件栅格环境画成了这些像素”。反过来读同样成立——一张绿的截图**不能**替代上述任何一条，也不能证明真实 GPU 或其他浏览器的行为。

    **基线的产生方式是刻意昂贵的。** `updateSnapshots: 'none'` 让“缺失基线”成为失败而不是被静默写入的答案键（Playwright 的默认值 `'missing'` 会把新断言的第一次运行变成它自己的答案键，包括 bug）。第一次 CI 运行因此按设计失败，人从失败工件里的 `test-results/<test>/<name>-actual.png` 逐张检查之后才提交答案键；五张 Linux/SwiftShader PNG 现已位于 `web/e2e/__screenshots__/slice.spec.ts/`。任何生产或阈值改动都仍须让同一 SHA 的 CI 运行对这些既有基线通过，不能在开发机上更新快照来消除差异。

!!! info "QVPC/1 的跨语言黄金向量"

    `tests/fixtures/qvpc_golden.bin` 是同一份字节流的**双向契约**：Python 侧断言编码器逐字节复现它，TypeScript 侧断言解析器能解出 `qvpc_golden.json` 里的值。

    单方面修改 wire format 会同时打破两侧——已验证：把 `POINT_CLOUD_STRIDE` 从 5 改成 6，Python 立刻 2 个测试变红；即使有人重新生成黄金字节把 Python 弄绿，TypeScript 仍有 5 个测试变红。

## 文档与引用 { #docs-and-citations }

- ✅ `mkdocs build --strict`；
- ✅ 所有 `[@key]` 存在 — `tests/test_bibliography.py::test_all_documentation_citation_keys_exist`；
- ✅ 生成索引与 `references.bib` 同步 — `scripts/render_reference_index.py --check`；
- ✅ HTTP 参数/默认值/外层边界/成功媒体类型与 live OpenAPI 同步 —
  `scripts/render_openapi_reference.py --check` 与 `tests/test_openapi_reference.py`；QVPC/1 的
  OpenAPI 200 响应必须声明 `application/vnd.quviz.point-cloud` binary，而不是 JSON
  （`tests/test_openapi_contract.py`）；
- ✅ Markdown 字节级完整性 — `tests/test_docs_integrity.py` 按**字节**检查 `docs/` 与根目录 Markdown，下列三者任一出现即变红：(1) 除 LF 外的任何 C0 字节——孤立或成对的 CR、TAB、换页符都算，因为它们正是 `\rho`、`\theta` 这类转义被解释后留下的指纹；(2) 转义损坏留下的孤儿 LaTeX 片段（如行首的 `abla`、`ightarrow`）——片段集合不是固定清单，而是在测试时从语料中每个 `\[abfnrtv]...` 命令推导并与静态种子取并集，另有测试断言语料中每个此类命令都被覆盖；行首片段无条件检查，`/ { = ( + - , ^ _ $` 之后的片段（允许隔着空白，因为编辑器会把残留的 TAB 规范化成空格）只在含 `$` 的行和 `$$ ... $$` 块内检查，且 `\text{…}`、`\mathrm{…}`、`\operatorname{…}` 这类文本命令的花括号参数不算；围栏代码块与行内代码一律不扫描，围栏边界同时重置 `$$` 块状态；1–2 字母片段（`\nu`、`\ne`、`\rho` 留下的 `u`、`e`、`ho`）只在紧跟 `$ } _ ^ \` 或数字且仅在行首时才报，其余情形依赖 (1) 的字节检查兜底；(3) 以 `|` 开头的表格行中 `$...$` 内未转义的 `|`——`\(...\)` 数学与不以 `|` 开头的行不扫描；
- 🌐 **新增**的 URL/DOI 可达 — CI `changed-links` 作业运行 `scripts/check_links.py --changed-since <base>`，除已知 bot 过滤站点（`BOT_HOSTS`）的 BLOCKED 与 HTTP 429 外任何非 OK 结果都失败——429 是限流，只说明探测被限速，不是对链接本身的判定。`docs/` 正文中的本地开发入口不是外链：解析并规范化 URL hostname 后，精确的 `localhost`、`127.0.0.0/8` 与 `::1` 会被跳过；只在路径、query、userinfo 或更长域名中出现这些字符串仍必须探测，`references.bib` 中的来源 URL 也没有本地地址豁免。触发时机与比较基准：pull request 以目标分支为基准；push 以推送前该 ref 所指的提交为基准，该提交不可用时（分支首次推送时为零 SHA，或 force push 后不是 HEAD 的祖先）退回到与 `origin/master` 的合并基，即探测整个分支相对 master 新增的链接，而不是跳过；若连这个基准都已包含 HEAD（master 自身的首次推送或 force push：`origin/master` 即 HEAD，diff 为空）或 checkout 里根本没有 `origin/master`，则没有可比较的基准，改为全量探测 `references.bib` 里的每个 URL 与 DOI（`--include-doi`，即每周扫描的同一探测），作业里没有任何一步会被跳过（`tests/test_check_script.py` 用一次性仓库执行基准解析与探测两步的脚本逐例验证）。已存在链接的腐烂由每周 `link-check` 工作流扫描（BROKEN/SUSPECT 失败）；两者都需要网络，不在 `make check` / `check.ps1` 内，本地提交前无法得知新增链接是否可达；
- 🕒 引用内容漂移检查（当前没有任何门禁比对页面内容）；
- ✅ `references.bib` 中未被正文引用的孤儿键 — `tests/test_bibliography.py::test_every_bibliography_entry_is_cited_or_marked_tooling`；代码块、行内代码与块级 HTML 注释里的引用不算正文，正文行内的注释按 python-markdown 的行为计入（`tests/test_citation_gates.py`）；
- ✅ `source-audit` 条目的 `commit` 与 URL 中 SHA 一致、tag 或无法与 tag 区分的 ref 需要与之相等的 `version`、明确的分支 URL 一律拒绝、非代码托管来源带访问日期（完整规则见[添加和维护引用](../how-to/cite-sources.md#enforced-rules)） — `test_repository_bibliography_has_coherent_source_pins`；
- 🔗 MkDocs 在真实 Chromium 中完成渲染 — `npm run test:fullstack` 同时启动生产应用与
  `mkdocs serve --strict`：直达页面和 `navigation.instant` 换页后的全部 `.arithmatex` 都必须
  生成 `mjx-container`，架构页 Mermaid 必须生成 SVG，Python API 必须出现 Phase 0 的
  superposition / planes / models / slices / streamlines 模块；本地请求、console 或 page error
  任一非空即失败，并由 `web-fullstack` CI 作业执行；
- 🧑 已知纠错不可被旧教程重新引入；
- 🧑 引用是否真正支持正文声明；
- 🧑 “已实现”“已验证”“计划中”三个状态不得混写。
