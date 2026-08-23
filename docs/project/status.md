# 当前状态

!!! success "Phase 0 可演示基线"

    2026-08-23，M0R 的科学几何、Scene Contract、前端显示和工程门禁阻断项已经修复，M1 解析叠加态已交付，PR-6 把五个功能分支整合进同一棵树并让门禁按其声明真正执行。QuViz 仍是 Alpha：这里的“可演示”不代表通用 TISE/TDSE、完整量子化学或多电子能力已经实现。

## 能力账本

| 能力 | 实现与验证 | 当前边界 |
|---|---|---|
| 氢与类氢解析波函数 | [质量门禁](../reference/quality-gates.md)“解析态”九项全部 ✅：归一化、正交性、通式节点数、$H\psi-E\psi$、$L^2$/$L_z$、$\langle r\rangle$/$\langle1/r\rangle$、约化质量、角度范围、Condon–Shortley | 解析 Coulomb 单电子态 |
| 概率密度、相位与定态概率流 | 概率流对照 $\operatorname{Im}(\psi^*\nabla\psi)$、定态连续性残差与 $\pm m$ 反向性测试通过 | 概率流 oracle 测试仅在 $Z=1$ 下验证；含时概率流已随 M1 叠加态交付（见下），数值 TDSE 的概率流属 M2 |
| 分离逆 CDF 点采样 | 径向/极角/方位角 KS 检验、三维矩、seed 重现测试通过；marker 统一权重 | 单一可分离氢样态，不是一般线性组合 sampler |
| 概率流线 representation | RK4 弧长积分器：柱半径/高度守恒、解析周期闭合、$\pm m$ 镜像与轴上遮罩测试通过；`/api/orbitals/current-field` 与前端 Probability flow 视图 | 定态播种利用方位对称性；叠加态播种按密度排序取三维网格点，但密度下限、`arc_step` 与探针位置仍是固定常数而非随尺度变化（PR-7） |
| 解析含时叠加态（M1） | 单态退化一致性、范数/$\langle H\rangle$ 守恒、1s–2p 偶极闭式、简并 negative control、含时连续性残差测试通过；`/api/superposition/*` 与前端时间轴 | 叠加态点云采样属 M5；等值面仍限 $n\le4$ |
| 固定目标质量等值面 | 径向 CDF 计算域、奇数网格、Simpson 质量、节点连通性、按面计数的绕向一致率和法向朝外测试通过 | API 保守限制为 $n\le4$；拓扑回归覆盖 1s、2p、3p 与复 2p，并未穷举全部轨道 |
| $sp^3$ 系数与四面体方向 | 正交性与方向测试通过 | 尚不是完整点群/SALC 系统，未接入 UI |
| 1D 网格契约 | 坐标、间距和边界测试通过 | 还没有 TISE/TDSE 求解器 |
| HTTP API 与 QVPC/1 | API、二进制与 OpenAPI schema 测试通过 | 点云 binary 与 metadata 使用同参数 sidecar 请求 |
| React/Three.js 场景 | 生产构建通过；QVPC/1 parser、相位色轮与测试套件自检的 vitest 单测（109 项）带强制覆盖率门槛；2pz、3dz² 浏览器视觉复核通过 | 视觉回归仍是人工检查（PR-8）；主 bundle 1,203 kB（gzip 329 kB）尚待拆分 |
| 引用与 MkDocs | 引用键、orphan 条目、`source-audit` 条目的 commit/SHA/URL 一致性、生成索引、Markdown 字节级完整性与 strict build 受门禁保护；push 与 pull request 新增链接由 CI 探测 | 已存在外链的腐烂只由每周扫描发现；引用内容漂移没有任何检查 |

## 审计输入基线：2026-08-22

Claude Fable 审计 artifact 提供了缺陷清单和以下重构前基线；本项目把它作为待复核输入，而不是科学或工程正确性的替代证据 [@claude-fable-audit]：

| 检查 | 重构前结果 |
|---|---|
| `pytest --cov` | 42 tests passed；覆盖率 88.47% |
| `ruff check` | 39 errors |
| `ruff format --check` | 8 files would be reformatted |
| `mypy` | 9 errors |
| `npm run build` | TypeScript error，构建失败 |
| `mkdocs build --strict` | 构建通过，但旧门禁没有发现控制字符和未渲染 Mermaid |
| `make check` | 在 lint 阶段失败 |

## M0R 实现验证快照：2026-08-23

M0R 合并时在 Windows 上执行 `& .\scripts\check.ps1` 的结果；它与 Unix `make check` 包含相同门禁。这些数字已被下文 PR-6 的结果取代，保留仅作为阶段记录：

| 检查 | 当前结果 |
|---|---|
| Ruff lint / format | 通过 |
| mypy strict | 23 个源码文件无问题 |
| 全量 `pytest --cov` | 48 tests passed；总覆盖率 88.57%（门槛 85%） |
| 引用索引 `--check` | 通过 |
| `mkdocs build --strict` | 通过 |
| TypeScript + Vite production build | 通过 |
| 浏览器实测 | 点云、2pz 分离等值面、3dz²、相机重新 fit、红—青相位图例和 metadata 显示通过 |

Vite 仍提示主 JavaScript chunk 超过 500 kB；这是性能优化项，不是当前构建失败。浏览器控制台唯一观察到的警告来自依赖内部的 `THREE.Clock` 弃用。

## PR-6 集成与门禁真实性：2026-08-23

### 整合

P0 解析门禁、概率流 representation、M1 解析叠加态、引用系统、前端测试基线五个功能分支先合并为集成树。重放这两次合并可以复现 3 个文件的内容冲突，均已手工解决：`docs/references/source-map.md`（引用系统）、`docs/reference/quality-gates.md` 与 `tests/test_scene_contract.py`（前端测试基线）。随后 PR-6 的三条修复线（文档完整性、门禁管线、前端门禁）与复审后的三条打磨线（文档、Python、前端）都按文件不相交设计，六次 `git merge --no-ff` 均无冲突；`master` 仍是本分支的祖先，可以 fast-forward。

### 被改成真实执行的门禁

外部审计指出若干门禁只在文档里“存在”。本次逐项写出先变红、再修复变绿的测试后，以下检查现在会真正失败：

- Markdown **字节级**完整性：`tests/test_docs_integrity.py` 读取原始字节，除 LF 外的任何 C0 字节（孤立或成对的 CR、TAB）、转义损坏留下的孤儿 LaTeX 片段（如行首的 `ho$`、`abla`、`ightarrow`；片段集合从语料中的 `\[abfnrtv]...` 命令推导）、表格行 `$...$` 内未转义的 `|` 三者任一出现即失败；借此修复了 `scene-contract.md`、`semantics.md`、`model-map.md` 中已损坏的 `\rho`/`\nabla`；
- 引用扫描只看 **Markdown 正文**：围栏代码块、行内 code、块级 HTML 注释、块级原始 HTML、`$...$`/`$$...$$` 数学、链接引用定义行与 front matter 里的 `[@key]` 既不算引用，也不能把 orphan 条目“救活”；行内注释按 python-markdown 的行为计入正文；每条规则都用 `mkdocs.yml` 的扩展列表实际渲染一遍来核对；
- `source-audit` 条目的 `commit` 字段必须是小写十六进制且与 URL 中的 SHA 一致，`{latest}` 之类占位符、tag URL 缺 `version` 或 `version` 与 URL 中的 ref 不等、`main`/`HEAD` 这类分支 URL、issue/wiki 等非源码页面、非代码托管来源缺访问日期都会失败（`tests/test_citation_gates.py`；完整规则见[添加和维护引用](../how-to/cite-sources.md#enforced-rules)）；
- push 与 pull request **新增**的 URL/DOI 由 CI 的 `changed-links` 作业探测，除已知 bot 过滤站点（`BOT_HOSTS`）的 BLOCKED 与 HTTP 429 外任何非 OK 结果都失败——429 是限流，只说明探测被限速，不是对链接本身的判定；每周全量扫描对 SUSPECT 不再放行；
- QVPC/1 parser 拒绝非零保留 flag，对缺失、为空或非数值的响应头明确抛错，并钉住黄金字节流的头部；
- `npm run test` 执行 `vitest run --coverage`，`vitest.config.ts` 的覆盖率门槛（语句/函数/行 90%，分支 85%，按文件评估）被真正评估——用 `--coverage.thresholds.lines=101` 探针确认会以 exit 1 失败；覆盖范围明确写为 `src/api/**`、`src/scene/**` 下的全部 `.ts`（新模块自动入门禁），只排除 GLSL 字符串模块、测试文件、`client.ts` 与 `types.ts`；`allowOnly: false` 直接拒绝提交的 `.only`，`src/guards.test.ts` 扫描所有 spec 里的 skip/todo/only/skipIf/runIf 修饰与受门禁模块里的 coverage ignore 注释；
- `*.test.tsx` 与 `*.test.ts` 一样被 vitest 收集，并由 `tsconfig.test.json` 做类型检查；
- `check.ps1`、`Makefile` 与 CI 一律以 `uv run --group docs pytest` 运行测试，`tests/conftest.py` 把任何 skipped 测试——含 `xfail(run=False)` 与命令式 `pytest.xfail()` 这类测试体没有跑完的情形——变成会话失败（`QUVIZ_ALLOW_SKIPS=1` 才能显式放行；`xfail_strict = true` 让意外 XPASS 也失败），引用门禁不能再因缺少依赖组而自行跳过，`tests/test_conftest_policy.py` 逐例验证；
- 生成的 `web/coverage/` 不再入库（`git ls-files web/coverage` 为 0）。

### 本树实测结果

在提交 `fea7e4f` 上从干净工作树依次执行；`& .\scripts\check.ps1` 端到端再跑一遍得到相同数字：

| 检查 | 当前结果 |
|---|---|
| `ruff check .` / `ruff format --check .` | 通过；95 个文件已格式化 |
| `mypy`（strict） | 29 个源码文件无问题 |
| `uv run --group docs pytest --cov=quviz` | 471 passed，0 failed，0 skipped，68 warnings；总覆盖率 91.25%（门槛 85%）——该数字在 `web/dist` 存在时测得，干净克隆上为 91.15%，因为 `src/quviz/api/app.py:37` 只在 `web/dist` 存在时才挂载前端 |
| 引用索引 `--check` | 通过 |
| `mkdocs build --strict` | 通过（2.1 s；仅上游 mkdocs-material 2.0 提示） |
| `npm run test` | 3 个文件 109 tests passed（`qvpc.test.ts` 65、`guards.test.ts` 40、`color.test.ts` 4）；`qvpc.ts` 与 `color.ts` 语句/分支/函数/行覆盖率均 100% |
| `npm run build` | 通过；`index-*.js` 1,203.66 kB（gzip 329.07 kB），CSS gzip 3.60 kB；仍有 chunk > 500 kB 警告 |
| 工作树 | `git status --short` 为空；`git ls-files --eol` 无 CRLF 工作副本 |

68 条 pytest 警告来自 FastAPI/TestClient 与 scikit-image 的上游弃用提示，与 M0R 时相同，未被处理。

## 剩余限制

1. 前端已有可进 CI 的 parser 与色轮单测，但交互与截图回归仍只依赖人工浏览器 QA（PR-8）；
2. 拆分 Three.js/后处理 bundle，并测量帧时、显存与大资产传输；
3. 将等值面验证扩展到更高 $n$ 前，先设计随节点数增长的收敛策略；
4. 原计划在进入解析含时叠加前先实现切片和节点面 representation，实际顺序没有遵守：概率流已交付，M1 叠加态先于切片完成，$\psi$/相位 SLICE 与相位节点遮罩推迟到 M1 之后（PR-8）；
5. 清理 FastAPI/TestClient 与 scikit-image 上游弃用警告。

### PR-7 待办：已核实但推迟的 P1

以下问题在本次独立核查中确认存在，但不阻断当前声明范围，留待 PR-7：

- 流线 `arc_step`、播种密度下限（最大密度的 $10^{-3}$）与连续性探针位置都是固定常数，不随 $Z$ 或 $n$ 缩放；
- 含时连续性残差以 $\max|\partial\rho/\partial t|$ 归一化，而该尺度在密度振荡的转折点恰为零（实系数 1s–2p 在 $t=0$ 时实测为 0），builder 此时把残差报告为 0，判据空洞地通过；
- 同宇称跨壳层叠加的交叉项在对称有限立方体内不再恰好积分为零：1s+2s 在 49³ 网格上的概率质量从 $t=0$ 的 0.951 漂移到半周期的 0.990，而 1s+2p 保持 0.979 不变，现有警告没有区分这两种情形；
- 系数为零的项没有被规范化剔除：`1|1,0,0> + 0|2,1,0>` 被判为非定态并进入含时路径；
- 约化质量 `a_mu` 只进入空间波函数，不进入 `energies` 的相位因子（`a_mu=0.5` 与 `1.0` 得到相同能量）；
- 系数校验不拒绝 NaN；`label()` 只显示实系数的模，`-0.707` 被写成 `0.707`；
- $H\psi-E\psi$ 残差使用固定差分步长，$n=6$ 或 $Z=0.05$ 超出容差；
- 径向矩 $\langle r^p\rangle$ 在 $p\ge31$ 起无尾部截断检查。

### PR-8 待办

- $\psi$/相位 SLICE representation；
- 相位节点遮罩；
- 前端视觉回归（截图）进入 CI。

后续科学能力顺序见[开发路线图](roadmap.md)。
