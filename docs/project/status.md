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
| React/Three.js 场景 | 生产构建通过；QVPC/1 parser、HTTP client、相位色轮与测试套件自检的 vitest 单测（223 项）带强制覆盖率门槛，运行结果经 `assert-no-skips` 核对为零 skip、经 `assert-coverage-scope` 核对本次运行**解析后**的覆盖率配置、实际插桩的文件集与 `coverage-scope.json` 完全一致、且各模块重算出的覆盖率均达标；2pz、3dz² 浏览器视觉复核通过 | 视觉回归仍是人工检查（PR-8）；主 bundle 1,203 kB（gzip 329 kB）尚待拆分 |
| 引用与 MkDocs | 引用键、orphan 条目、`source-audit` 条目的 commit/SHA/URL 一致性、生成索引、Markdown 字节级完整性与 strict build 受门禁保护；新增链接由 CI 在每次 pull request 与 push 上探测（首次推送 / force push 退回到与 `origin/master` 的合并基；`references.bib` 按解析后的条目比较，不靠行 diff） | 链接探测需要网络，本地 `check.ps1` / `make check` 不含；已存在外链的腐烂只由每周扫描发现；引用内容漂移没有任何检查 |

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

P0 解析门禁、概率流 representation、M1 解析叠加态、引用系统、前端测试基线五个功能分支先合并为集成树。重放这两次合并可以复现 3 个文件的内容冲突，均已手工解决：`docs/references/source-map.md`（引用系统）、`docs/reference/quality-gates.md` 与 `tests/test_scene_contract.py`（前端测试基线）。随后 PR-6 的三条修复线（文档完整性、门禁管线、前端门禁）与复审后的三条打磨线（文档、Python、前端）都按文件不相交设计，六次 `git merge --no-ff` 均无冲突。第四轮外部复审又指出 8 项门禁绕过（C1–C8），按五条修复线（`check.ps1` 与 CI 触发、链接主机匹配与 bib 目标提取、pin 主机名规范化、原始 HTML 扫描、前端门禁）逐项先复现再修复，五次 `git merge --no-ff` 均无冲突（其中两条线都追加了 `tests/test_citation_gates.py`，自动合并保留了双方的测试组）；`master` 仍是本分支的祖先，可以 fast-forward。

### 被改成真实执行的门禁

外部审计指出若干门禁只在文档里“存在”。本次逐项写出先变红、再修复变绿的测试后，以下检查现在会真正失败：

- Markdown **字节级**完整性：`tests/test_docs_integrity.py` 读取原始字节，除 LF 外的任何 C0 字节（孤立或成对的 CR、TAB）、转义损坏留下的孤儿 LaTeX 片段（如行首的 `ho$`、`abla`、`ightarrow`；片段集合从语料中的 `\[abfnrtv]...` 命令推导）、表格行 `$...$` 内未转义的 `|` 三者任一出现即失败；借此修复了 `scene-contract.md`、`semantics.md`、`model-map.md` 中已损坏的 `\rho`/`\nabla`；
- 引用扫描只看 **Markdown 正文**：围栏代码块、行内 code、块级 HTML 注释、块级原始 HTML、`$...$`/`$$...$$` 数学、链接引用定义行与 front matter 里的 `[@key]` 既不算引用，也不能把 orphan 条目“救活”；行内注释按 python-markdown 的行为计入正文；原始 HTML 的边界不再由手写规则近似，而是让 python-markdown 自己的 `md_in_html` 提取器跑一遍并记下它藏起来的源码区间（块尾 *in tail* 状态下同一行再开的块、未闭合块吞掉的文档剩余部分、`markdown` 元素内嵌套的原始子元素都与构建一致）；`markdown="1"` 元素的内容只有在其起始标签位于块首——行首第 0 列，前面没有文字、也没有哪怕一个空格——时才是正文，写在原始 HTML 块尾或缩进 1–3 个空格的行上时整个元素按原样输出，其中的 `[@key]` 不算引用；每条规则都用 `mkdocs.yml` 的扩展列表实际渲染一遍来核对；
- `source-audit` 条目的 `commit` 字段必须是小写十六进制且与 URL 中的 SHA 一致，`{latest}` 之类占位符、tag URL 缺 `version` 或 `version` 与 URL 中的 ref 不等、`main`/`HEAD` 这类分支 URL、issue/wiki 等非源码页面、非代码托管来源缺访问日期都会失败；主机名先按浏览器的解析方式规范化（小写、去 userinfo 与端口、解码百分号转义、IDNA 映射，**之后**才去尾点——IDNA 会把 U+3002 `。`、U+FF0E `．`、U+FF61 `｡` 映射成 ASCII 点，先去尾点会让 `github.com。` 变成 `github.com.` 而逃出所有代码托管规则），路径先做一次百分号解码再按 `/` 切分，所以 `github.com.`、`github.com。`、`github%2Ecom`、全角字母拼写的 github.com 与 `tree/refs%2Fheads%2Fmaster` 受到与其规范拼写完全相同的规则约束（`tests/test_citation_gates.py`；完整规则见[添加和维护引用](../how-to/cite-sources.md#enforced-rules)）；
- **新增**的 URL/DOI 由 CI 的 `changed-links` 作业探测，除已知 bot 过滤站点（`BOT_HOSTS`）的 BLOCKED 与 HTTP 429 外任何非 OK 结果都失败——429 是限流，只说明探测被限速，不是对链接本身的判定；`BOT_HOSTS` 只按规范化后的主机名（或其子域）匹配，不再是对整个 URL 的子串测试，路径或查询串里出现站点名不能换来 BLOCKED 放行；`references.bib` 的新增目标由合并基与 HEAD 两份解析后的 bibliography 逐条目比较得出（单行条目、与其他字段同行或换行续写的 `doi` 都被看见），`docs/` 仍按行 diff 提取；该作业在每次 pull request（基准为目标分支）与 push（基准为推送前的提交）上运行，分支首次推送或 force push 使 `github.event.before` 为零 SHA 或不是 HEAD 的祖先时，退回到与 `origin/master` 的合并基而不再跳过——此前这两种情形会静默跳过探测；若该基准已包含 HEAD（master 自身的首次推送或 force push，`origin/master` 即 HEAD，此前会以"no new links"空跑）或 checkout 没有 `origin/master`（此前跳过），则改为全量探测 `references.bib` 的每个 URL/DOI，作业里没有任何一步会被跳过；`tests/test_check_script.py` 从 `ci.yml` 读出基准解析与探测两步的脚本在一次性仓库和 stub `uv` 上逐例执行。探测需要网络，仍不在本地 `check.ps1` / `make check` 内；每周全量扫描对 SUSPECT 不再放行；
- `check.ps1` 启动时 `Push-Location` 到脚本自身所在的仓库根目录（并打印该路径），所有 Python/文档与 npm 步骤都在这一棵树上执行，`try/finally` 保证退出时恢复调用者目录——此前 Python/文档步骤跑在调用者当前目录、npm 步骤跑在 `$PSScriptRoot`，从另一个 checkout 以绝对路径调用会对两棵不同的树各测一半并返回 0；`tests/test_check_script.py` 用打印工作目录的 `uv`/`npm` 桩从陌生目录实际运行该脚本来验证；
- QVPC/1 parser 拒绝非零保留 flag，对缺失、为空或非数值的响应头明确抛错，并钉住黄金字节流的头部；
- `npm run test` 执行 `vitest run --coverage`，覆盖率门槛（语句/函数/行 90%，分支 85%，按文件评估）由三份互相钉住的副本承载：`vitest.config.ts` 的 `coverage.thresholds`、`guards.test.ts` 的字面量 `EXPECTED_COVERAGE_THRESHOLDS`、`coverage-scope.json` 的 `thresholds` 必须逐字段相等，只改其中一处或两处都会失败，整个 `thresholds` 键被删掉时先由形状断言明确报错（此前这个键在门禁代码里只出现在注释中，没有任何断言读它：给 `color.ts` 追加一个真正未覆盖的导出函数后，CLI 上把四个门槛置零、`perFile: true` 改成 `false`、把四个值置零、删掉整个键、以及 Vite 插件 `config()` 钩子 `delete cfg.test.coverage.thresholds`，五种改法都能让 `npm test` 以 exit 0 通过）；覆盖范围明确写为 `src/api/**`、`src/scene/**` 下的全部 `.ts`（新模块自动入门禁），只排除 GLSL 字符串模块、测试文件与 `types.ts`——`client.ts`（HTTP 层）不再排除，由 `src/api/client.test.ts` 以 `fetch` 桩覆盖请求路径、query、signal/header 透传与 HTTP/网络错误映射，三个门禁模块覆盖率均为 100%；门禁根目录下能被 Vite 当作运行时模块加载、却不被 `coverage.include` 匹配的扩展名逐个被拒（`src/api/` 只允许 `.ts`，`src/scene/` 额外允许 `.tsx`，因为 React/three 组件本就在门禁之外）——此前 `src/api/sneaky.mts`、`.cts`、`.js` 各带一个未覆盖的导出函数都能让 `npm test` 保持 exit 0：既不被插桩、也不进清单比对、也不被 pragma 扫描；`allowOnly: false` 直接拒绝提交的 `.only`；零 skip 由两处保证：`npm run test` 在 vitest 之后运行 `scripts/assert-no-skips.mjs`，读取 `coverage/vitest-results.json` 运行结果，任何非 passed 的测试、缺席的 spec 文件或非零 pending/todo/failed 计数都失败（看的是 runner 实际做了什么，而不是 spec 怎么写）；`src/guards.test.ts` 另对源码做扫描，覆盖 `it.skip`、`it['skip']`、`describe.sequential.skip`、解构/别名后的 runner 与 runtime context 等拼写，以及受门禁模块里 v8/c8/istanbul/`node:coverage` 各家的 ignore 注释；`npm run test` 在 vitest 之后另跑 `scripts/assert-coverage-scope.mjs`：读取本次运行写出的 `coverage/coverage-final.json`，把**实际被插桩**的文件集与 `web/coverage-scope.json` 的 `coverageGated` 做精确相等比对，少一个或多一个都失败；同一份报告还被用来**重算**每个门禁模块的语句/分支/函数/行覆盖率，与 `coverage-scope.json` 携带的 `thresholds` 逐项比较，不达标即失败——这一半是任何读配置源码的断言都看不见的：CLI 上 `--coverage.thresholds.*=0` 与插件钩子删掉 `thresholds` 时全部测试仍全绿、vitest 自己一条门槛错误都不打印，只有它变红。重算用的是 istanbul-lib-coverage 的 `FileCoverage.toSummary()`（即 vitest 自己门槛检查所调用的那个函数）：百分比按两位小数截断而非四舍五入，行覆盖率从 `statementMap` 的起始行折算，空指标记 100%。数字以 vitest 自己打印的表格为准校验过——`color.ts` 追加未覆盖函数后 vitest 打印 `70.58 | 100 | 75 | 70.58`，重算逐项相同（连 covered/total 计数也相同），`guards.test.ts` 用这四个数把算法钉住。“空指标记 100%”正是整块文件 pragma 的漏洞所在：被 pragma 整体抹掉的模块 `s` 为空，istanbul 判它四项全 100%（表格里显示为 0），vitest 的按文件门槛因此完全不触发、exit 0；现在门禁模块出现零个可覆盖语句即硬失败。这是唯一能看见「解析后」覆盖范围与门槛的检查——`--coverage.include=…` 这类 CLI 覆写或 Vite 插件的 `config()` 钩子能在完全不改 `vitest.config.ts` 的前提下把范围缩到一个文件，而所有读配置源码的断言依旧全绿。读报告只有在「另有东西保证这份报告出自真实插桩」时才说明问题，因此 `assert-coverage-scope.mjs` 的第一道检查不是报告内容而是**报告的来源**：`vitest.config.ts` 用 `globalSetup` 挂上 `scripts/capture-resolved-coverage.mjs`，把 vitest **解析后**的 `project.config.coverage`（CLI 参数、插件 `config()` 钩子、环境覆写都已折叠进去）写成 `coverage/resolved-coverage.json`，门禁再把它与 `coverage-scope.json` 的 `resolvedCoverage` **整体逐键**比对。整体比对而不是挑几个字段，是因为前三轮每一轮都只绑住了再多一个键、下一轮就找到了后面那个：先是文件集（`thresholds` 落空），再是 `thresholds`（`provider` 落空）——`--coverage.provider=custom --coverage.customProviderModule=…`（写进 `test` 脚本，或由插件 `config()` 钩子设置，两种都实测过）会让仓库里的一个模块**自己写出** `coverage-final.json`，把三个门禁模块写成 100%，于是全部守卫全绿、两行门禁摘要照常打印、`check.ps1` 报 `All checks passed!` exit 0，而 `color.ts` 里真有一个未覆盖的导出函数。除整体比对外还单列了几条与清单无关的绝对约束：`provider` 必须是 `v8`、不得出现 `customProviderModule`、`enabled` 与 `all` 必须为 `true`、reporter 必须含 `json`、`thresholds` 必须等于清单的 `thresholds`；这些约束由 `readCoverageScope` 同样施加在**清单自己的期望值**上，所以「一次提交里既换掉 provider 又批准这次更换」会在读清单时直接抛错。捕获文件缺失同样是硬失败——把 `globalSetup` 从 `vitest.config.ts` 删掉会同时触发两处红：`guards.test.ts` 对 `globalSetup` 的逐字比对，以及门禁读不到捕获文件；运行前先由 `scripts/clean-coverage.mjs` 删掉上一轮的 `coverage-final.json`、`vitest-results.json` 与 `resolved-coverage.json`（实测 `coverage.clean` 只在覆盖率启用时才清理：`vitest run` 不带 `--coverage` 时这些文件原封不动留存），报告或捕获缺失即硬失败，杜绝以旧报告顶账，这份删除清单本身由 `tests/test_check_script.py` 在 `web/` 之外钉住；`guards.test.ts` 的 minimatch 推导同时改用 `{ dot: true }` 与 test-exclude 对齐，此前 `src/api/.hidden.ts` 这类隐藏文件会被 vitest 插桩并计入按文件阈值，却落在源码扫描范围之外；
- 前端门禁自己的**调用链**由 `tests/test_check_script.py` 从链条之外钉住（此前 `tests/` 里没有任何一处读 `web/package.json`）：`test` 脚本必须仍以 `&&` 依次串起 `clean-coverage.mjs`、`vitest run --coverage`、`assert-no-skips.mjs`、`assert-coverage-scope.mjs` 四段，且不得出现 `;`、单个 `&` 或 `||`（三者都会让前一段的失败被忽略）。删掉 `&& node scripts/assert-coverage-scope.mjs` 曾使 `npm test` 以 exit 0 通过且无一处变红，把预清理连同 `--coverage` 一起删掉则让校验器对着**上一轮**的报告放行——这与 P1-A 把覆盖率参数写进同一行 `test` 脚本属于同一威胁模型，删掉一道门禁比改写它更省事。仅仅点名各段还不够：各段原按子串匹配，`vitest run --coverage.enabled=false` 因此能满足名为 `vitest run --coverage` 的一段，配合被清空的 `STALE_ARTEFACTS` 就让校验器对着上一轮报告放行（实测）。现在同一处还钉住了这条链**不许**说什么与 npm 在它前后加了什么：`test` 脚本里不得出现 `--coverage.`、`--coverage=` 或 `--no-coverage`（覆盖率配置只能来自 `vitest.config.ts`），不得定义 npm 自动执行的 `pretest`/`posttest`，`clean-coverage.mjs` 必须按序删除三份报告，且 `web/src/guards.test.ts` 必须存在并仍含它的各个 describe 块与关键用例名——删掉该文件曾使 `npm test` 以 96 项全绿通过、同时 `src/api/sneaky.mts` 里的未覆盖导出函数照常发布（`assert-no-skips.mjs` 的 spec 清单从磁盘推导，看不见一个不再存在的文件）；
- 需要如实说明的取舍：`coverage-scope.json` 是一份写死的清单，等于一道**故意设置的人工复核闩**——新增一个真正受门禁的模块、调整门槛，或者改动任何一项解析后的覆盖率选项（`resolvedCoverage` 是整体逐键比对，连 vitest 升级改掉某个默认值都会变红），都必须在同一次评审里同步更新它，`npm run test` 才会通过。这不是自动化的缺口，而是让覆盖范围与门槛的任何增减都必须经人过目的机制；代价是清单与真实文件树之间需要人工保持同步。需要补正此前的表述：这道闩并不是今天这三个模块的唯一保护——`guards.test.ts` 另有按名字写死的断言（`scan scope > coverage-gates exactly the modules coverage-scope.json lists` 与其下的门禁 fixture），所以同时改 `vitest.config.ts`、规范数组与清单的一次协同提交仍然会变红；这些字面量只覆盖当下列出的模块，之后新增又被悄悄移除的模块仍只由这道闩把关；
- 同样如实说明的边界：`src/state/` 与 `src/components/`（React/zustand 层）仍在门禁之外，所以把 `src/scene/color.ts` 的函数体整体搬到 `src/state/colorImpl.ts`、只留一行 re-export，门禁模块会以 100% 全绿通过（复检已复现）。这是 PR-8 声明的范围边界，不是新漏洞——关掉它要靠给那一层写测试，而不是再改一道守卫；
- `*.test.tsx` 与 `*.test.ts` 一样被 vitest 收集，并由 `tsconfig.test.json` 做类型检查；
- `check.ps1`、`Makefile` 与 CI 一律以 `uv run --group docs pytest` 运行测试，`tests/conftest.py` 把任何 skipped 测试——含 `xfail(run=False)` 与命令式 `pytest.xfail()` 这类测试体没有跑完的情形——变成会话失败（`QUVIZ_ALLOW_SKIPS=1` 才能显式放行；`xfail_strict = true` 让意外 XPASS 也失败），引用门禁不能再因缺少依赖组而自行跳过，`tests/test_conftest_policy.py` 逐例验证；
- 生成的 `web/coverage/` 不再入库（`git ls-files web/coverage` 为 0）。

对上述八项绕过逐一复测（零 SHA / 非祖先 SHA、`doi.org` 子串、三种 `doi` 排版、`github.com.` 与 `refs%2Fheads%2Fmaster`、相邻原始 HTML、各种 skip 拼法与 `node:coverage` 注释、`client.ts` 路径改错）均已不能再绕过；复测中顺带发现并按"先变红再变绿"补上的新缺口：`docs/` 里以 `++` 开头的行在 diff 中呈 `+++ ...`，曾被当作文件头丢弃而不探测其链接；`tree/v1.0/../master` 这类 `.`/`..`（含 `%2e`）路径段在浏览器里先被归一化，pin 门禁曾按归一化前的 `v1.0` 放行，`refs/pull/…` 等非 heads/tags 的 ref 命名空间与 Gitea 的 `raw|media/branch/<name>` 也曾以 `version = {refs}` / `{branch}` 过关；写在原始 HTML 块尾、行内文字之后或行首缩进处的 `markdown="1"` 元素在构建时整体按原样输出（`MarkdownInHtmlProcessor` 只解析占位符位于块首的元素），扫描器曾把其中的 `[@key]` 算作引用；`@vitest/coverage-v8` 内置的 v8-to-istanbul 用 `[c|v]8` 拼写 start/stop 正则，字符类里的 `|` 是字面量，`/* |8 ignore start */` 曾被覆盖率工具承认而不被源码守卫识别；`client.test.ts` 的 HTTP 错误用例曾只做子串匹配，删掉 `response.ok` 检查后 V8 的 JSON 解析错误恰好引用响应体而仍然通过；master 自身的首次推送 / force push 退回到 `origin/master` 时 diff 为空、只输出"no new links"，现改为全量探测；`check.ps1` 被以 stdin 方式喂给 `pwsh -Command -` 时曾在没有 `$PSScriptRoot` 的情况下一个门禁都不跑却 exit 0，现明确 exit 1。终审又指出并同样按"先变红再变绿"修复：pin 门禁的主机名规范化先去尾点再做 IDNA 映射，`github.com。`（U+3002，以及 U+FF0E、U+FF61）经映射后成为 `github.com.`，从而逃出全部代码托管规则、没有 `commit` 的分支 URL 仅凭 `urldate` 即可通过，现改为映射之后再去尾点；缩进 2–3 个空格、原始 HTML 块尾之后（含以 TAB 分隔）的 `markdown="1"` 元素与行内文字之后的同名标签（后者对构建是段落内的行内 HTML，其内容是正文）已逐例加入构建对照矩阵；`scripts/check_links.py` 判断"基准版本没有 `references.bib`"曾靠匹配 git 的英文报错文本，本地化的 git 会使其抛错中止，现改为用 `git cat-file -e` 的退出码判断。仍保留的已知发散：四空格 / TAB 缩进的行（含原始 HTML 块尾部以 TAB 开头的文字）对构建是缩进代码块、对扫描器是 admonition 正文，其中的 `[@key]` 会被算作引用，这是文档化的取舍。

终审之后，一轮独立复检按同样方法核实已发布的门禁实现，又发现并按"先变红再变绿"修复了四项绕过：`check.ps1` 经目录 junction / 硬链接以别名路径调用时，`$repoRoot` 取 `$PSScriptRoot` 的词法父目录而不解析 reparse 点，会在错误的工作树里跑完全部门禁并 exit 0，现解析 reparse 点定位脚本真实所属仓库，并以 `.git`+`pyproject.toml` 标记兜底，非法树直接 exit 1；pin 门禁按 RFC 3986 的 `urlsplit` 取主机，浏览器（WHATWG special-scheme）却把反斜杠与异常斜杠数归一化到真实主机，`https:///github.com/...`、`https://github.com\o/...` 等曾以空/畸形 authority 落入普通 web URL 分支、仅凭 urldate 通过，现对 http(s) 的畸形 authority（反斜杠或空主机）在主机路由前直接拒绝；`RAW_HOSTS` 原以 `_host_in` 子域匹配 `githubusercontent.com`，令 `objects.`/`media.` 等不透明资产域被按 `raw` 的 `/owner/repo/ref/path` 解析、掩盖错误 commit，现改为精确匹配 `raw.githubusercontent.com`，其余 `*.githubusercontent.com` 一律作为资产/CDN 主机拒绝；`guards.test.ts` 曾用手写正则镜像 `coverage.include/exclude`，把某文件加入 `vitest.config.ts` 的 exclude 可静默收缩覆盖范围而 `npm test` 仍绿，现直接导入解析后的 vitest 配置并对 include/exclude 断言，收缩即失败。四项修复后，全量 `check.ps1` 门禁复跑通过。

再一轮对抗性复检对前端门禁跑了 23 次攻击，15 次被现有防护挡下，7 次成功，全部指向同一处结构性缺口：上一轮把覆盖率的**范围**绑到了清单上，却让覆盖率的**执行**（门槛）没有绑到任何东西——`thresholds` 在 `guards.test.ts` 与 `assert-coverage-scope.mjs` 里只出现在注释中。按同样的“先复现再修复”办法：五种停用门槛的改法（CLI 置零、`perFile: false`、值置零、删键、插件钩子删键）现分别由配置源码侧的三方字面量比对与运行期的覆盖率重算挡住，其中 CLI 与插件钩子两种只有后者能看见；整块文件 pragma 造成的“零可覆盖语句”现为硬失败；`.mts`/`.cts`/`.js`/`.mjs` 等扩展名的运行时模块现按门禁根目录逐一被拒；`npm test` 调用链本身现由 `tests/test_check_script.py` 钉住。另同步补正三处表述：`status.md` 曾写“四个门禁模块”（实为三个）、`coverage-scope.json` 的 `$comment` 曾把清单说成三个模块的唯一保护（`guards.test.ts` 另有按名字写死的断言）、`assert-coverage-scope.d.mts` 的 `readonly string[] | unknown` 联合类型在 TypeScript 里坍缩为 `unknown`。

又一轮对抗性复检确认上一轮的七项修复全部成立（16 次攻击被挡下，覆盖率百分比算法与 `istanbul-lib-coverage@3.2.2` 在九个刁钻样例上逐项相同），但指出同一处结构性错误又向外挪了一格：范围绑住了、门槛绑住了，**测量者本身**（`coverage.provider`）仍然没有被任何断言读到，于是 CLI 参数与插件 `config()` 钩子两种改法都能让一个自写报告的 custom provider 顶替真实插桩，`check.ps1` 报 `All checks passed!` exit 0。本轮不再“再绑一个键”，改为把 vitest **解析后**的整份覆盖率配置捕获下来整体比对（见上一节）；同时按“先复现再修复”补上四处：`test` 脚本里的覆盖率参数与 npm 生命周期钩子、`clean-coverage.mjs` 的删除清单、`web/src/guards.test.ts` 的存在性都被从 `tests/` 钉住；类型专用模块的守卫由**逐行正则**改为用 TypeScript 编译器 API **真正解析**该文件的顶层声明（正则作为第二层保留），因为 `export` 换行后接 `function backdoorInTypes(…)` 与 `;export const backdoorInTypes = …` 两种写法都是合法 TypeScript、都能通过 `tsc`、都把可执行且未覆盖的代码放进门禁根目录，而原有七个正面对照全是单行写法，按构造就抓不到这一类。另补正两处此前说得过头的表述：上一轮把类型专用守卫的缺口说成“只漏掉裸副作用”，实际它连值导出也漏（即上述两种写法）；上一轮说“门禁信任报告文件”的敞口“由预清理加 `&&` 链条兜住”，这句不成立——预清理本身当时没有任何测试钉住，而 `&&` 链条挡不住由运行自己写出报告的 custom provider，现在兜住它的是解析后配置的整体比对加上这三处新钉。

**这一段本身也需要就地更正。**“整体逐键比对”是真的，它也确实挡住了*诚实的* custom provider——同一个伪 provider 只要让 `resolveOptions()` 原样返回选项，门禁立刻变红（已复现）——但它**没有**关闭 custom provider 这条攻击，而上面的写法读起来像是关闭了。vitest 在 `Vitest.start()` 里先执行 `this.config.coverage = this.coverageProvider.resolveOptions()`，之后才进入 `runFiles()` → globalSetup，而 `project.config` 与那个对象是同一引用：捕获模块读到的，正是 provider 自己交回来的那份配置。于是一个约 60 行、`resolveOptions()` 返回 `{...options, provider: 'v8'}` 并删掉 `customProviderModule` 的伪 provider，能让**未经任何改动的**捕获模块写出一份完全干净的捕获，而实际上一行都没有插桩——插件钩子形态下 `npm test` exit 0、23 项 pytest 全过、`check.ps1` 报 `All checks passed!`，捕获文件自始至终没有被碰过。这不是捕获模块写错了，而是“运行为自己作证”的必然结果；下面的《门禁的防护边界》把这条界线写清楚。

最后一轮（本轮）不再增加“运行内部的第五层”。上一段说明了为什么再加也没有用：任何在这个进程里产生的证据，都可以被这个进程伪造。本轮只做两件事——把确实能抬高地板、尤其是能挡住**粗心**削弱（这才是这道门禁的日常职责）的便宜修复补齐，然后把边界如实写下来。四项修复同样按“先复现再修复”：`test` 调用链此前按**有序子集**匹配各段，允许在任意位置**插入**一段，实测把 `&& node scripts/postprocess-coverage.mjs` 插在 vitest 与校验器之间、再配一个删掉 `thresholds` 的插件钩子，约 40 行脚本就能由 `coverage-scope.json` 反向拼出 `resolved-coverage.json` 与 `coverage-final.json`，`npm test` exit 0，而屏幕上 vitest 自己的表格就写着 `color.ts | 66.66`，当时全部 pytest 照常通过——现在改为**逐段全等**于一个有序元组（同序、同数、不许有多余段），插入即变红，顺带把子集写法从未点名的 `tsc` 类型检查段与写出 JSON 结果文件的 reporter 参数也一并钉住；从 `tests/`（运行够不到的地方）另加两条钉子——`web/vitest.config.ts` 不得声明 `plugins` 键（这一条单独就挡掉了上述插件钩子形态与更早的 A21），`web/scripts/` 目录必须恰好是清单里那七个文件（伪 provider 与插入段的第一步都是往这里放一个新模块）；类型专用模块的守卫此前的理由是错的——注释写着裸副作用“不导出任何东西，因而无法承载受门禁模块调用的代码”，实测 `;(globalThis as …).__hsv = (h, s, v) => {…}` 写进 `src/api/types.ts`、`src/scene/color.ts` 只留 `import '../api/types'`，就把整份实现（含两个未测分支）搬进了一个不被任何东西测量的模块，而 `color.ts` 报 100/100/100/100、门禁全绿——现在该文件的顶层只允许**编译器不产出任何运行时**的形式（import/export、interface、type、`declare`、空语句），表达式语句、变量、函数、类、活的 `enum`/`namespace`、裸副作用 import 一律变红，错误的注释也已改掉；另修两处小问题：捕获里的标记此前把 `undefined` 写成字符串 `"<undefined>"`，与一个真的叫 `"<undefined>"` 的字符串值无法区分，现改为只有一个 `__captured` 键的**对象**标记（真值恰好带该键时再套一层转义），`reportsDirectory` 的比较此前区分大小写，在 Windows 上 `<root>/COVERAGE` 与 `<root>/coverage` 本是同一个目录却会误报变红，现在按平台折叠大小写。防御纵深上还把 vitest 实际加载的 provider **对象**的 `name` 一并捕获并硬性要求为 `v8`：它只抓得住不加伪装的假 provider（vitest 会在三行绿色门禁摘要正上方打印 `Coverage enabled with fake`），一个声明 `name = 'v8'` 的假 provider 照样通过——这一层在代码注释、测试用例与下面这一节里都被明确标注为**一层，而不是墙**。

### 门禁的防护边界

前四轮每一轮都在运行内部再加一层观察者，第五轮不再这样做。这里如实写清这道前端门禁挡得住什么、挡不住什么。

**挡得住的，是覆盖率被“配置”悄悄削弱**——不论削弱是有意还是随手为之，而后者才是它日常真正在挡的东西。以下每一条都曾实测能让 `npm test` 以 exit 0 通过，现在都会变红：缩小 `coverage.include`/`exclude`；下调、置零、删除 `thresholds`（改配置源码、写进 CLI 参数、或由插件 `config()` 钩子删键，三种形态）；`perFile: false`；隐藏的点文件逃出源码扫描范围；把运行时模块放到不被 `coverage.include` 匹配的扩展名下（`.mts`/`.cts`/`.js`/`.mjs`）；整块文件的覆盖率 pragma（模块报 0/0/0/0，而 vitest 自己的门槛检查按 istanbul 的算法判为 100%）；用上一轮遗留的报告顶账；从 `npm test` 链条里删掉一段门禁，或在其中插入一段；删除或清空 `guards.test.ts`；用 npm 的 `pretest`/`posttest` 生命周期钩子；把“类型专用”模块写成不再类型专用；`projects`/`workspace` 配置；取反或裸目录形式的匹配模式。

**挡不住的，是有人写代码去谎报覆盖率。** 具体是两类：一个 custom coverage provider 伪造 `resolveOptions()`（上文详述，捕获文件甚至不需要被碰）；以及一段能改写产物的额外链条段（上面已按精确元组关闭了这一处，但这一**类**依然存在——凡是能在 vitest 与校验器之间写 `coverage/*.json` 的东西都能击穿全部三道检查）。原因一句话就够：**所有在这个进程里产生的证据，都可以被这个进程伪造**；再加第几层都不改变这一点，因为新层也在同一个进程里。要真正关闭它，需要脱离 `check.ps1` 这条链去独立插桩（例如用一份单独配置再跑一遍覆盖率并比对两次结果），或者由 CI 把覆盖率配置与一份受保护的基线做 diff——两条都需要 CI 侧改动，本轮**有意**不做。可以如实计入的补偿性控制只有一条：一次给仓库加入 coverage provider 或 vite 插件的 diff 本身就是评审信号，而上面那两条钉子（不许有 `plugins` 键、`web/scripts/` 文件清单）把这种 diff 从“评审者也许会注意到”变成了“必须评审通过才能落地”——挡的是落地成本，不是运行时的伪造能力。

**已知的组合逃逸**：把受门禁模块的函数体整体搬进不受测量的模块（`src/state/`、`src/components/`）、只留一行 re-export，受门禁模块仍会以 100% 通过。这是 PR-8 声明的范围边界，不是新漏洞；关掉它要靠给那一层写测试，而不是再改一道守卫。

### 本树实测结果

下表在本分支最后一次门禁提交（含上述解析后覆盖率配置捕获，以及调用链精确元组、`plugins` 与 `web/scripts/` 清单、类型专用模块副作用扫描、标记编码与 `reportsDirectory` 大小写四项收尾修复）之上重新测得；这里不再写具体 commit 哈希，因为记录本身要落在下一个提交里，写死的哈希每次都会立刻过时。`pytest`/`npm run test` 在本检出上逐项直接执行，并以 `pwsh -NoProfile -File scripts/check.ps1` 端到端复跑核对，exit 0——复跑时 `web/dist` 已存在，775 passed、223 passed 与下表一致，覆盖率相应读作 92.37%（`web/dist` 缺席时的 92.28% 是更早一轮在全新工作树上的测值，见下表说明）。`db32d43` 与 `ea9873c` 上的记录（`git worktree add` 一棵全新工作树，无 `web/dist`、无 `node_modules`，`npm ci` 后端到端执行同样 exit 0，覆盖率因第一轮留下的 `web/dist` 从 92.03% 变为 92.12%）验证的是更早一轮、T1 补上 reparse/硬链接解析之前的 check.ps1，是那一轮的历史存档，不是下表数字的来源：

| 检查 | 当前结果 |
|---|---|
| `ruff check .` / `ruff format --check .` | 通过；96 个文件已格式化 |
| `mypy`（strict） | 29 个源码文件无问题 |
| `uv run --group docs pytest --cov=quviz` | 775 passed，0 failed，0 skipped，68 warnings；本树总覆盖率 92.37%（门槛 85%）——本检出存在 `web/dist`；无 `web/dist` 的全新工作树上此前测得 92.28%（本轮未重测），差异来自 `src/quviz/api/app.py:37` 只在 `web/dist` 存在时才挂载前端 |
| 引用索引 `--check` | 通过 |
| `mkdocs build --strict` | 通过（2.6 s；仅上游 mkdocs-material 2.0 提示） |
| `npm run test` | 4 个文件 223 tests passed（`guards.test.ts` 127、`qvpc.test.ts` 65、`client.test.ts` 27、`color.test.ts` 4）；`assert-no-skips` 核对运行结果：0 skipped，0 todo；`assert-coverage-scope` 先核对 `resolved-coverage.json`：本次运行解析后的覆盖率配置与 `coverage-scope.json` 的 `resolvedCoverage` 逐键一致（provider 为 `v8`，无 `customProviderModule`，vitest 实际加载的 provider 对象 `name` 也是 `v8`），再核对 `coverage-final.json`：实际插桩 3 个模块，与 `coverage-scope.json` 完全一致，且三个模块重算出的覆盖率均达到 `thresholds`（语句 90%、分支 85%、函数 90%、行 90%）；`qvpc.ts`、`client.ts` 与 `color.ts` 语句/分支/函数/行覆盖率均 100% |
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
