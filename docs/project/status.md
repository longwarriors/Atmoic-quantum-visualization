# 当前状态

!!! success "Phase 0 可演示基线"

    截至 2026-08-30，M0R 的科学几何、Scene Contract、前端显示和工程门禁阻断项已经修复，M1 解析叠加态已交付，PR-6 让门禁按其声明真正执行，PR-7 又关闭了八项已核实的科学正确性 P1，PR-8A 把前端从“能画出来”改成“说的与画的一致”，并把覆盖率门禁扩到 `src/` 下的全部生产模块，PR-8B 交付了 $\psi$/相位平面切片并把 API 描述改成端到端生成、双端受检的一条链，PR-8C 把切片画成像素并第一次把截图门禁接进 CI；五张 Linux/SwiftShader 基线随后已经提交。2026-08-29 的全面复审又加固了概率流的尺度协变、采样收敛、拓扑与 payload 不变量、API 资源边界和前端可发现性；2026-08-30 再加入真实 `quviz serve` + FastAPI 静态挂载的源码 checkout 全栈浏览器门禁。QuViz 仍是 Alpha：这里的“可演示”不代表通用 TISE/TDSE、完整量子化学或多电子能力已经实现。

!!! success "Phase 0 文档 checkpoint 收口（2026-08-30）"

    当前开发暂停点已定义为 **Phase 0 checkpoint**。本轮重新从干净源码路径复现安装和启动，
    把首选入口改为“构建前端后由 FastAPI 单服务托管”，开发模式统一为从仓库根执行的双终端命令；
    Node 的真实依赖范围、uv 默认依赖组、Swagger UI / OpenAPI JSON、源码 checkout 与 wheel 的边界均已写清。
    科学文档纠正了 measurement model 层次、概率流中的 $\hbar$、复波函数等值面维数、Stark
    实验映射适用范围及未实现的 benchmark / 点群门禁。MkDocs 现在对漏页与坏锚点 fail-closed，
    MathJax 和 Mermaid 在 `navigation.instant` 后由真实 Chromium 验证，行内引用可跳到完整的类型化
    参考文献记录；HTTP 参数页由 live OpenAPI 生成。M2–M6 保持暂停和待开发，不得从本页推断为已交付。

## 能力账本

| 能力 | 实现与验证 | 当前边界 |
|---|---|---|
| 氢与类氢解析波函数 | [质量门禁](../reference/quality-gates.md)覆盖归一化、正交性、通式节点数、尺度化 $H\psi-E\psi$、$L^2$/$L_z$、高阶径向矩、约化质量、角度范围与 Condon–Shortley | 解析 Coulomb 单电子态 |
| 概率密度、相位与定态概率流 | 概率流对照 $\operatorname{Im}(\psi^*\nabla\psi)$、定态连续性残差、$\pm m$ 反向性及 $Z/a_\mu$ 尺度协变测试通过；速度逐值保留 12 位有效数字，$10^{-12}$ 弱相干仍非零 | 含时概率流已随 M1 叠加态交付（见下）；数值 TDSE 的概率流属 M2 |
| 分离逆 CDF 点采样 | 径向/极角/方位角 KS 检验、三维矩、seed 重现测试通过；marker 统一权重 | 单一可分离氢样态，不是一般线性组合 sampler |
| 概率流线 representation | RK4 弧长积分器：柱半径/高度守恒、解析周期闭合、$\pm m$ 镜像、轴上遮罩及批次拆分/重排不变性测试通过；弧长、播种 cutoff、连续性探针和差分步长均按 $n/Z/a_\mu$ 尺度化；API 按真实 RK4 五阶段与输出点双预算预检，seed 上限为本征 96 / 叠加 40；`/api/orbitals/current-field` 与前端 Probability flow 视图 | 定态播种仍利用方位对称性；叠加态按三维网格密度排序；scene 连续性审计最多接收 8 个 active terms，并采用每个不同能隙四相位采样而非完整 Fourier 分解 |
| 解析含时叠加态（M1） | 单态退化一致性、范数/$\langle H\rangle$ 守恒、1s–2p 偶极闭式、简并 negative control、转折点非空洞连续性审计、有限盒/网格 alias 分离及激发 s 多网格拓扑门禁通过；`/api/superposition/*` 与前端时间轴 | 叠加态点云采样属 M5；等值面仍限 $n\le4$；不含激发 s 的一般多项态尚无拓扑证书 |
| 固定目标质量等值面 | 径向 CDF 计算域、奇数网格、Simpson 质量、节点连通性、按面计数的绕向一致率和法向朝外测试通过；含节点单一 s 态使用径向 topology oracle；含非零激发 s 的多项态要求最细 129/137 两级的逐分量 Euler 特征、level 与质量稳定 | API 保守限制为 $n\le4$；单态内部解析 cap 129，多项通用收敛 cap 137；无法在上限解析就明确拒绝，其他一般多项态仍无拓扑证明 |
| $\psi$/相位平面切片 representation | 逐位反对称采样轴（换回 `np.linspace` 即变红）、右手 $(u,v,n)$ 标架含 `xz` 的 $-\hat y$、行主序布局、导出并报告的 extent、参照 $L_{\mathrm{ref}}^{-3/2}$ 的相位遮罩六项报告、精确径向节点特征下限、逐字节黄金 payload 与 OpenAPI→TS 生成链测试通过；`/api/orbitals/slice`、`/api/superposition/slice` | 相位遮罩是低振幅 / 相位未定义区域，**不是节点证书**；没有节面几何；`resolution` 上限 513，路由 $n\le12$ 但 12s 等无法解析的状态会 fail-closed |
| $sp^3$ 系数与四面体方向 | 正交性与方向测试通过 | 尚不是完整点群/SALC 系统，未接入 UI |
| 1D 网格契约 | 坐标、间距和边界测试通过 | 还没有 TISE/TDSE 求解器 |
| HTTP API 与 QVPC/1 | API、二进制与 OpenAPI schema 测试通过；QVPC float32 边界、科学数值失败统一 422 与意外编程错误仍为 500 均有负控 | 点云 binary 与 metadata 使用同参数 sidecar 请求；极端正尺度仍受各 representation 的可表示域约束 |
| React/Three.js 场景 | 生产构建通过；QVPC/1 parser（含 body 逐样本校验）、HTTP client、能力矩阵、zustand store、React/three 组件与测试套件自检的 vitest 单测（34 个 spec 文件、1010 项）带强制覆盖率门槛，运行结果经 `assert-no-skips` 核对为零 skip、经 `assert-coverage-scope` 核对本次运行**解析后**的覆盖率配置、本次运行写出的报告所列的文件集与 `coverage-scope.json` 完全一致、且各模块重算出的覆盖率均达标；`web/e2e/` 在本地锁定 Linux/SwiftShader 容器中实测 8/8，`web/fullstack-e2e/` 另以真实 `quviz serve`、FastAPI `web/dist` 挂载和未拦截 `/api` 走通点云→等值面→切片→3d complex 概率流→叠加态，完整 query、2xx、科学语义与浏览器零错误均受检；两个 Playwright 入口都有 JSON 运行后审计，两个 CI job 均由 `tests/test_check_script.py` 钉住 | CI job 接线受门禁，但本地结果不替代远端 runner 的实际执行；全栈 smoke 只证明源码 checkout 的生产挂载，不证明 wheel 静态资产打包；截图仍只覆盖切片与固定 Linux/Chromium/SwiftShader，不代表真实 GPU、多浏览器或移动视口；主 bundle 1,261.33 kB（gzip 347.25 kB）尚待拆分 |
| 引用与 MkDocs | 引用键、orphan 条目、条目类型必填字段、`source-audit` 的 commit/SHA/URL 一致性、完整类型化索引、Markdown 字节完整性、全页面唯一入 nav、显式链接/锚点 validation 与 strict build 受门禁保护；HTTP 参数页与 live OpenAPI 逐字同步；真实全栈 Chromium 另检查直达/instant-nav MathJax、Mermaid SVG、Phase 0 Python API 和引用跳转；新增链接由 CI 在每次 pull request 与 push 上探测 | MathJax/Mermaid runtime 使用精确版本 CDN，浏览文档时仍需要可访问该 CDN；外链探测需要网络，本地 `check.ps1` / `make check` 不含；已存在外链的腐烂由每周扫描发现；引用内容是否真正支持具体科学声明仍需人工同行复核 |

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
- **新增**的 URL/DOI 由 CI 的 `changed-links` 作业探测，除已知 bot 过滤站点（`BOT_HOSTS`）的 BLOCKED 与 HTTP 429 外任何非 OK 结果都失败——429 是限流，只说明探测被限速，不是对链接本身的判定；`BOT_HOSTS` 只按规范化后的主机名（或其子域）匹配，不再是对整个 URL 的子串测试，路径或查询串里出现站点名不能换来 BLOCKED 放行；`references.bib` 的新增目标由合并基与 HEAD 两份解析后的 bibliography 逐条目比较得出（单行条目、与其他字段同行或换行续写的 `doi` 都被看见），`docs/` 仍按行 diff 提取；该作业在每次 pull request（基准为目标分支）与 push（基准为推送前的提交）上运行，分支首次推送或 force push 使 `github.event.before` 为零 SHA 或不是 HEAD 的祖先时，退回到与 `origin/master` 的合并基而不再跳过——此前这两种情形会静默跳过探测；若该基准已包含 HEAD（master 自身的首次推送或 force push，`origin/master` 即 HEAD，此前会以“no new links”空跑）或 checkout 没有 `origin/master`（此前跳过），则改为全量探测 `references.bib` 的每个 URL/DOI，作业里没有任何一步会被跳过；`tests/test_check_script.py` 从 `ci.yml` 读出基准解析与探测两步的脚本在一次性仓库和 stub `uv` 上逐例执行。探测需要网络，仍不在本地 `check.ps1` / `make check` 内；每周全量扫描对 SUSPECT 不再放行；
- `check.ps1` 启动时 `Push-Location` 到脚本自身所在的仓库根目录（并打印该路径），所有 Python/文档与 npm 步骤都在这一棵树上执行，`try/finally` 保证退出时恢复调用者目录——此前 Python/文档步骤跑在调用者当前目录、npm 步骤跑在 `$PSScriptRoot`，从另一个 checkout 以绝对路径调用会对两棵不同的树各测一半并返回 0；`tests/test_check_script.py` 用打印工作目录的 `uv`/`npm` 桩从陌生目录实际运行该脚本来验证；
- QVPC/1 parser 拒绝非零保留 flag，对缺失、为空或非数值的响应头明确抛错，并钉住黄金字节流的头部；
- `npm run test` 执行 `vitest run --coverage`，覆盖率门槛（语句/函数/行 90%，分支 85%，按文件评估）由三份互相钉住的副本承载：`vitest.config.ts` 的 `coverage.thresholds`、`guards.test.ts` 的字面量 `EXPECTED_COVERAGE_THRESHOLDS`、`coverage-scope.json` 的 `thresholds` 必须逐字段相等，只改其中一处或两处都会失败，整个 `thresholds` 键被删掉时先由形状断言明确报错（此前这个键在门禁代码里只出现在注释中，没有任何断言读它：给 `color.ts` 追加一个真正未覆盖的导出函数后，CLI 上把四个门槛置零、`perFile: true` 改成 `false`、把四个值置零、删掉整个键、以及 Vite 插件 `config()` 钩子 `delete cfg.test.coverage.thresholds`，五种改法都能让 `npm test` 以 exit 0 通过）；覆盖范围明确写为 `src/api/**`、`src/scene/**` 下的全部 `.ts`（新模块自动入门禁），只排除测试文件与 `types.ts`（`src/scene/shaders/` 的整目录排除本轮已删除，见下）——`client.ts`（HTTP 层）不再排除，由 `src/api/client.test.ts` 以 `fetch` 桩覆盖请求路径、query、signal/header 透传与 HTTP/网络错误映射，四个门禁模块覆盖率均为 100%；门禁根目录下能被 Vite 当作运行时模块加载、却不被 `coverage.include` 匹配的扩展名逐个被拒（`src/api/` 只允许 `.ts`，`src/scene/` 额外允许 `.tsx`，因为 React/three 组件本就在门禁之外）——此前 `src/api/sneaky.mts`、`.cts`、`.js` 各带一个未覆盖的导出函数都能让 `npm test` 保持 exit 0：既不被插桩、也不进清单比对、也不被 pragma 扫描；`allowOnly: false` 直接拒绝提交的 `.only`；零 skip 由两处保证：`npm run test` 在 vitest 之后运行 `scripts/assert-no-skips.mjs`，读取 `coverage/vitest-results.json` 运行结果，任何非 passed 的测试、缺席的 spec 文件或非零 pending/todo/failed 计数都失败（看的是 runner 实际做了什么，而不是 spec 怎么写）；`src/guards.test.ts` 另对源码做扫描，覆盖 `it.skip`、`it['skip']`、`describe.sequential.skip`、解构/别名后的 runner 与 runtime context 等拼写，以及受门禁模块里 v8/c8/istanbul/`node:coverage` 各家的 ignore 注释；`npm run test` 在 vitest 之后另跑 `scripts/assert-coverage-scope.mjs`：读取本次运行写出的 `coverage/coverage-final.json`，把**这份报告所列**的文件集与 `web/coverage-scope.json` 的 `coverageGated` 做精确相等比对（读的是报告，不是插桩过程本身），少一个或多一个都失败；同一份报告还被用来**重算**每个门禁模块的语句/分支/函数/行覆盖率，与 `coverage-scope.json` 携带的 `thresholds` 逐项比较，不达标即失败——这一半是任何读配置源码的断言都看不见的：CLI 上 `--coverage.thresholds.*=0` 与插件钩子删掉 `thresholds` 时全部测试仍全绿、vitest 自己一条门槛错误都不打印，只有它变红。重算用的是 istanbul-lib-coverage 的 `FileCoverage.toSummary()`（即 vitest 自己门槛检查所调用的那个函数）：百分比按两位小数截断而非四舍五入，行覆盖率从 `statementMap` 的起始行折算，空指标记 100%。数字以 vitest 自己打印的表格为准校验过——`color.ts` 追加未覆盖函数后 vitest 打印 `70.58 | 100 | 75 | 70.58`，重算逐项相同（连 covered/total 计数也相同），`guards.test.ts` 用这四个数把算法钉住。“空指标记 100%”正是整块文件 pragma 的漏洞所在：被 pragma 整体抹掉的模块 `s` 为空，istanbul 判它四项全 100%（表格里显示为 0），vitest 的按文件门槛因此完全不触发、exit 0；现在门禁模块出现零个可覆盖语句即硬失败。这是唯一能看见「解析后」覆盖范围与门槛的检查——`--coverage.include=…` 这类 CLI 覆写或 Vite 插件的 `config()` 钩子能在完全不改 `vitest.config.ts` 的前提下把范围缩到一个文件，而所有读配置源码的断言依旧全绿。读报告只有在「另有东西保证这份报告出自真实插桩」时才说明问题，因此 `assert-coverage-scope.mjs` 的第一道检查不是报告内容而是**报告的来源**：`vitest.config.ts` 用 `globalSetup` 挂上 `scripts/capture-resolved-coverage.mjs`，把 vitest **解析后**的 `project.config.coverage`（CLI 参数、插件 `config()` 钩子、环境覆写都已折叠进去）写成 `coverage/resolved-coverage.json`，门禁再把它与 `coverage-scope.json` 的 `resolvedCoverage` **整体逐键**比对。整体比对而不是挑几个字段，是因为前三轮每一轮都只绑住了再多一个键、下一轮就找到了后面那个：先是文件集（`thresholds` 落空），再是 `thresholds`（`provider` 落空）——`--coverage.provider=custom --coverage.customProviderModule=…`（写进 `test` 脚本，或由插件 `config()` 钩子设置，两种都实测过）会让仓库里的一个模块**自己写出** `coverage-final.json`，把当时那三个门禁模块写成 100%，于是全部守卫全绿、两行门禁摘要照常打印、整条 `check.ps1` exit 0，而 `color.ts` 里真有一个未覆盖的导出函数。除整体比对外还单列了几条与清单无关的绝对约束：`provider` 必须是 `v8`、不得出现 `customProviderModule`、`enabled` 与 `all` 必须为 `true`、reporter 必须含 `json`、`thresholds` 必须等于清单的 `thresholds`；这些约束由 `readCoverageScope` 同样施加在**清单自己的期望值**上，所以「一次提交里既换掉 provider 又批准这次更换」会在读清单时直接抛错。捕获文件缺失同样是硬失败——把 `globalSetup` 从 `vitest.config.ts` 删掉会同时触发两处红：`guards.test.ts` 对 `globalSetup` 的逐字比对，以及门禁读不到捕获文件；运行前先由 `scripts/clean-coverage.mjs` 删掉上一轮的 `coverage-final.json`、`vitest-results.json` 与 `resolved-coverage.json`（实测 `coverage.clean` 只在覆盖率启用时才清理：`vitest run` 不带 `--coverage` 时这些文件原封不动留存），报告或捕获缺失即硬失败，杜绝以旧报告顶账，这份删除清单本身由 `tests/test_check_script.py` 在 `web/` 之外钉住；`guards.test.ts` 的 minimatch 推导同时改用 `{ dot: true }` 与 test-exclude 对齐，此前 `src/api/.hidden.ts` 这类隐藏文件会被 vitest 插桩并计入按文件阈值，却落在源码扫描范围之外；
- 前端门禁自己的**调用链**由 `tests/test_check_script.py` 从链条之外钉住（此前 `tests/` 里没有任何一处读 `web/package.json`）：`test` 脚本必须仍以 `&&` 依次串起 `clean-coverage.mjs`、`vitest run --coverage`、`assert-no-skips.mjs`、`assert-coverage-scope.mjs` 四段，且不得出现 `;`、单个 `&` 或 `||`（三者都会让前一段的失败被忽略）。删掉 `&& node scripts/assert-coverage-scope.mjs` 曾使 `npm test` 以 exit 0 通过且无一处变红，把预清理连同 `--coverage` 一起删掉则让校验器对着**上一轮**的报告放行——这与 P1-A 把覆盖率参数写进同一行 `test` 脚本属于同一威胁模型，删掉一道门禁比改写它更省事。仅仅点名各段还不够：各段原按子串匹配，`vitest run --coverage.enabled=false` 因此能满足名为 `vitest run --coverage` 的一段，配合被清空的 `STALE_ARTEFACTS` 就让校验器对着上一轮报告放行（实测）。现在同一处还钉住了这条链**不许**说什么与 npm 在它前后加了什么：`test` 脚本里不得出现 `--coverage.`、`--coverage=` 或 `--no-coverage`（覆盖率配置只能来自 `vitest.config.ts`），不得定义 npm 自动执行的 `pretest`/`posttest`，`clean-coverage.mjs` 必须按序删除三份报告，且 `web/src/guards.test.ts` 必须存在并仍含它的各个 describe 块与关键用例名——删掉该文件曾使 `npm test` 以 96 项全绿通过、同时 `src/api/sneaky.mts` 里的未覆盖导出函数照常发布（`assert-no-skips.mjs` 的 spec 清单从磁盘推导，看不见一个不再存在的文件）；
- 需要如实说明的取舍：`coverage-scope.json` 是一份写死的清单，等于一道**故意设置的人工复核闩**——新增一个真正受门禁的模块、调整门槛，或者改动任何一项解析后的覆盖率选项（`resolvedCoverage` 是整体逐键比对，连 vitest 升级改掉某个默认值都会变红），都必须在同一次评审里同步更新它，`npm run test` 才会通过。这不是自动化的缺口，而是让覆盖范围与门槛的任何增减都必须经人过目的机制；代价是清单与真实文件树之间需要人工保持同步。需要补正此前的表述：这道闩并不是今天这三个模块的唯一保护——`guards.test.ts` 另有按名字写死的断言（`scan scope > coverage-gates exactly the modules coverage-scope.json lists` 与其下的门禁 fixture），所以同时改 `vitest.config.ts`、规范数组与清单的一次协同提交仍然会变红；这些字面量只覆盖当下列出的模块，之后新增又被悄悄移除的模块仍只由这道闩把关；
- `*.test.tsx` 与 `*.test.ts` 一样被 vitest 收集，并由 `tsconfig.test.json` 做类型检查；
- `check.ps1`、`Makefile` 与 CI 一律以 `uv run --group docs pytest` 运行测试，`tests/conftest.py` 把任何 skipped 测试——含 `xfail(run=False)` 与命令式 `pytest.xfail()` 这类测试体没有跑完的情形——变成会话失败（`QUVIZ_ALLOW_SKIPS=1` 才能显式放行；`xfail_strict = true` 让意外 XPASS 也失败），引用门禁不能再因缺少依赖组而自行跳过，`tests/test_conftest_policy.py` 逐例验证；
- 生成的 `web/coverage/` 不再入库（`git ls-files web/coverage` 为 0）。

对上述八项绕过逐一复测（零 SHA / 非祖先 SHA、`doi.org` 子串、三种 `doi` 排版、`github.com.` 与 `refs%2Fheads%2Fmaster`、相邻原始 HTML、各种 skip 拼法与 `node:coverage` 注释、`client.ts` 路径改错）均已不能再绕过；复测中顺带发现并按“先变红再变绿”补上的新缺口：`docs/` 里以 `++` 开头的行在 diff 中呈 `+++ ...`，曾被当作文件头丢弃而不探测其链接；`tree/v1.0/../master` 这类 `.`/`..`（含 `%2e`）路径段在浏览器里先被归一化，pin 门禁曾按归一化前的 `v1.0` 放行，`refs/pull/…` 等非 heads/tags 的 ref 命名空间与 Gitea 的 `raw|media/branch/<name>` 也曾以 `version = {refs}` / `{branch}` 过关；写在原始 HTML 块尾、行内文字之后或行首缩进处的 `markdown="1"` 元素在构建时整体按原样输出（`MarkdownInHtmlProcessor` 只解析占位符位于块首的元素），扫描器曾把其中的 `[@key]` 算作引用；`@vitest/coverage-v8` 内置的 v8-to-istanbul 用 `[c|v]8` 拼写 start/stop 正则，字符类里的 `|` 是字面量，`/* |8 ignore start */` 曾被覆盖率工具承认而不被源码守卫识别；`client.test.ts` 的 HTTP 错误用例曾只做子串匹配，删掉 `response.ok` 检查后 V8 的 JSON 解析错误恰好引用响应体而仍然通过；master 自身的首次推送 / force push 退回到 `origin/master` 时 diff 为空、只输出“no new links”，现改为全量探测；`check.ps1` 被以 stdin 方式喂给 `pwsh -Command -` 时曾在没有 `$PSScriptRoot` 的情况下一个门禁都不跑却 exit 0，现明确 exit 1。终审又指出并同样按“先变红再变绿”修复：pin 门禁的主机名规范化先去尾点再做 IDNA 映射，`github.com。`（U+3002，以及 U+FF0E、U+FF61）经映射后成为 `github.com.`，从而逃出全部代码托管规则、没有 `commit` 的分支 URL 仅凭 `urldate` 即可通过，现改为映射之后再去尾点；缩进 2–3 个空格、原始 HTML 块尾之后（含以 TAB 分隔）的 `markdown="1"` 元素与行内文字之后的同名标签（后者对构建是段落内的行内 HTML，其内容是正文）已逐例加入构建对照矩阵；`scripts/check_links.py` 判断“基准版本没有 `references.bib`“曾靠匹配 git 的英文报错文本，本地化的 git 会使其抛错中止，现改为用 `git cat-file -e` 的退出码判断。仍保留的已知发散：四空格 / TAB 缩进的行（含原始 HTML 块尾部以 TAB 开头的文字）对构建是缩进代码块、对扫描器是 admonition 正文，其中的 `[@key]` 会被算作引用，这是文档化的取舍。

终审之后，一轮独立复检按同样方法核实已发布的门禁实现，又发现并按“先变红再变绿”修复了四项绕过：`check.ps1` 经目录 junction / 硬链接以别名路径调用时，`$repoRoot` 取 `$PSScriptRoot` 的词法父目录而不解析 reparse 点，会在错误的工作树里跑完全部门禁并 exit 0，现解析 reparse 点定位脚本真实所属仓库，并以 `.git`+`pyproject.toml` 标记兜底，非法树直接 exit 1；pin 门禁按 RFC 3986 的 `urlsplit` 取主机，浏览器（WHATWG special-scheme）却把反斜杠与异常斜杠数归一化到真实主机，`https:///github.com/...`、`https://github.com\o/...` 等曾以空/畸形 authority 落入普通 web URL 分支、仅凭 urldate 通过，现对 http(s) 的畸形 authority（反斜杠或空主机）在主机路由前直接拒绝；`RAW_HOSTS` 原以 `_host_in` 子域匹配 `githubusercontent.com`，令 `objects.`/`media.` 等不透明资产域被按 `raw` 的 `/owner/repo/ref/path` 解析、掩盖错误 commit，现改为精确匹配 `raw.githubusercontent.com`，其余 `*.githubusercontent.com` 一律作为资产/CDN 主机拒绝；`guards.test.ts` 曾用手写正则镜像 `coverage.include/exclude`，把某文件加入 `vitest.config.ts` 的 exclude 可静默收缩覆盖范围而 `npm test` 仍绿，现直接导入解析后的 vitest 配置并对 include/exclude 断言，收缩即失败。四项修复后，全量 `check.ps1` 门禁复跑通过。

再一轮对抗性复检对前端门禁跑了 23 次攻击，15 次被现有防护挡下，7 次成功，全部指向同一处结构性缺口：上一轮把覆盖率的**范围**绑到了清单上，却让覆盖率的**执行**（门槛）没有绑到任何东西——`thresholds` 在 `guards.test.ts` 与 `assert-coverage-scope.mjs` 里只出现在注释中。按同样的“先复现再修复”办法：五种停用门槛的改法（CLI 置零、`perFile: false`、值置零、删键、插件钩子删键）现分别由配置源码侧的三方字面量比对与运行期的覆盖率重算挡住，其中 CLI 与插件钩子两种只有后者能看见；整块文件 pragma 造成的“零可覆盖语句”现为硬失败；`.mts`/`.cts`/`.js`/`.mjs` 等扩展名的运行时模块现按门禁根目录逐一被拒；`npm test` 调用链本身现由 `tests/test_check_script.py` 钉住。另同步补正三处表述：`status.md` 曾写“四个门禁模块”（实为三个）、`coverage-scope.json` 的 `$comment` 曾把清单说成三个模块的唯一保护（`guards.test.ts` 另有按名字写死的断言）、`assert-coverage-scope.d.mts` 的 `readonly string[] | unknown` 联合类型在 TypeScript 里坍缩为 `unknown`。

又一轮对抗性复检确认上一轮的七项修复全部成立（16 次攻击被挡下，覆盖率百分比算法与 `istanbul-lib-coverage@3.2.2` 在九个刁钻样例上逐项相同），但指出同一处结构性错误又向外挪了一格：范围绑住了、门槛绑住了，**测量者本身**（`coverage.provider`）仍然没有被任何断言读到，于是 CLI 参数与插件 `config()` 钩子两种改法都能让一个自写报告的 custom provider 顶替真实插桩，整条 `check.ps1` exit 0。本轮不再“再绑一个键”，改为把 vitest **解析后**的整份覆盖率配置捕获下来整体比对（见上一节）；同时按“先复现再修复”补上四处：`test` 脚本里的覆盖率参数与 npm 生命周期钩子、`clean-coverage.mjs` 的删除清单、`web/src/guards.test.ts` 的存在性都被从 `tests/` 钉住；类型专用模块的守卫由**逐行正则**改为用 TypeScript 编译器 API **真正解析**该文件的顶层声明（正则作为第二层保留），因为 `export` 换行后接 `function backdoorInTypes(…)` 与 `;export const backdoorInTypes = …` 两种写法都是合法 TypeScript、都能通过 `tsc`、都把可执行且未覆盖的代码放进门禁根目录，而原有七个正面对照全是单行写法，按构造就抓不到这一类。另补正两处此前说得过头的表述：上一轮把类型专用守卫的缺口说成“只漏掉裸副作用”，实际它连值导出也漏（即上述两种写法）；上一轮说“门禁信任报告文件”的敞口“由预清理加 `&&` 链条兜住”，这句不成立——预清理本身当时没有任何测试钉住，而 `&&` 链条挡不住由运行自己写出报告的 custom provider，现在兜住它的是解析后配置的整体比对加上这三处新钉。

**这一段本身也需要就地更正。**“整体逐键比对”是真的，它也确实挡住了*诚实的* custom provider——同一个伪 provider 只要让 `resolveOptions()` 原样返回选项，门禁立刻变红（已复现）——但它**没有**关闭 custom provider 这条攻击，而上面的写法读起来像是关闭了。vitest 在 `Vitest.start()` 里先执行 `this.config.coverage = this.coverageProvider.resolveOptions()`，之后才进入 `runFiles()` → globalSetup，而 `project.config` 与那个对象是同一引用：捕获模块读到的，正是 provider 自己交回来的那份配置。于是一个约 60 行、`resolveOptions()` 返回 `{...options, provider: 'v8'}` 并删掉 `customProviderModule` 的伪 provider，能让**未经任何改动的**捕获模块写出一份完全干净的捕获，而实际上一行都没有插桩——插件钩子形态下 `npm test` exit 0、23 项 pytest 全过、整条 `check.ps1` exit 0，捕获文件自始至终没有被碰过。这不是捕获模块写错了，而是“运行为自己作证”的必然结果；下面的《门禁的防护边界》把这条界线写清楚。

最后一轮（本轮）不再增加“运行内部的第五层”。上一段说明了为什么再加也没有用：这条链上的每一样东西——vitest、它的配置、它的 provider、捕获模块、校验器，以及校验器读的那两份文件——都在**同一个可被改写、权限相同的信任域**（这份 checkout）里，而这样一个信任域没法为自己作证。本轮只做两件事——把确实能抬高地板、尤其是能挡住**粗心**削弱（这才是这道门禁的日常职责）的便宜修复补齐，然后把边界如实写下来。四项修复同样按“先复现再修复”：`test` 调用链此前按**有序子集**匹配各段，允许在任意位置**插入**一段，实测把 `&& node scripts/postprocess-coverage.mjs` 插在 vitest 与校验器之间、再配一个删掉 `thresholds` 的插件钩子，约 40 行脚本就能由 `coverage-scope.json` 反向拼出 `resolved-coverage.json` 与 `coverage-final.json`，`npm test` exit 0，而屏幕上 vitest 自己的表格就写着 `color.ts | 66.66`，当时全部 pytest 照常通过——现在改为**逐段全等**于一个有序元组（同序、同数、不许有多余段），插入即变红，顺带把子集写法从未点名的 `tsc` 类型检查段与写出 JSON 结果文件的 reporter 参数也一并钉住；从 `tests/` 另加三条钉子——它们是**评审期的绊线**：在运行之前、在写下那行接线的那一刻就变红，而不是在运行中拦截；`tests/` 并不是“运行够不到的地方”，它同样是这份 checkout 里的普通文件，改它只是把 diff 改大一点——`web/vitest.config.ts` 不得声明 `plugins` 键（这一条挡掉了上述插件钩子删 `thresholds` 的形态与更早的 A21；但它读的是这个文件自己的文本，因此只挡得住直接写在这里的拼法），`web/vitest.config.ts` 的 import 列表必须恰好是今天这一条 `vitest/config`（把 `plugins` 数组挪进一个被 import 的模块，正是上一条读不到的拼法，详见下一节），`web/scripts/` 目录必须恰好是清单里那七个文件（伪 provider 与插入段的第一步都是往这里放一个新模块）；类型专用模块的守卫此前的理由是错的——注释写着裸副作用“不导出任何东西，因而无法承载受门禁模块调用的代码”，实测 `;(globalThis as …).__hsv = (h, s, v) => {…}` 写进 `src/api/types.ts`、`src/scene/color.ts` 只留 `import '../api/types'`，就把整份实现（含两个未测分支）搬进了一个不被任何东西测量的模块，而 `color.ts` 报 100/100/100/100、门禁全绿——现在该文件的顶层只允许**编译器不产出任何运行时**的形式（import/export、interface、type、`declare`、空语句），表达式语句、变量、函数、类、活的 `enum`/`namespace`、裸副作用 import 一律变红，错误的注释也已改掉；另修两处小问题：捕获里的标记此前把 `undefined` 写成字符串 `"<undefined>"`，与一个真的叫 `"<undefined>"` 的字符串值无法区分，现改为只有一个 `__captured` 键的**对象**标记（真值恰好带该键时再套一层转义），`reportsDirectory` 的比较此前区分大小写，在 Windows 上 `<root>/COVERAGE` 与 `<root>/coverage` 本是同一个目录却会误报变红，现在按平台折叠大小写。防御纵深上还把 vitest 实际加载的 provider **对象**的 `name` 一并捕获并硬性要求为 `v8`。这一层的能力与限度都是实测的：同一个伪 provider 保留 `name = 'fake'` 时门禁报 `coverageProviderName is "fake", not "v8"`、exit 1（此时 `coverage.provider` 读到的仍是它伪造出来的 `"v8"`，只有 provider 对象本身露了馅）；把那一行改成 `name = 'v8'` 之后，`npm test` 恢复 exit 0、三行门禁摘要照常打印，vitest 甚至打印 `Coverage enabled with v8`，而 `color.ts` 里那个未覆盖的导出函数照样发布。所以这一层在代码注释、测试用例与下面这一节里都被明确标注为**一层，而不是墙**。上面那三条从 `tests/` 打下的钉子同样不是墙：它们挡的是“把伪 provider 接进来”的具体拼法，一种一种地挡，挡住一种就少一种，而 provider 一旦以任何方式接进来，整轮运行赖以判定的证据仍然由它书写。下一节如实写清这条界线，以及这三条钉子实测挡住了哪几种拼法。

终审在批准合并前又点出三处 P1，均已按“先复现再修复”处理。**其一，`src/scene/shaders/**` 是一道整目录的覆盖率排除项，而没有任何检查保证那个目录里只有 GLSL 字符串。**原有断言只验证排除**生效**（`coverageGatedSources` 不含 `orbitalPoints.ts`），于是往该目录放一个带未覆盖分支的普通 `.ts`、再从 `color.ts` 调用它，实测 `npm test` exit 0（223 passed、三行门禁摘要全绿、`color.ts` 仍报 100%）、`npm run build` exit 0，那个分支压缩后确实出现在生产 bundle 里。修法不是把排除项写细，而是**删掉它**：`orbitalPoints.ts` 与其他模块一样受门禁（实测 100/100/100/100——纯字符串导出模块的两条 `export` 语句就是可覆盖语句，既满足按文件门槛，也不触发“零可覆盖语句即硬失败”那一条），并新增 `src/scene/shaders/orbitalPoints.test.ts` 断言场景真正依赖的 GLSL 契约（`void main()`、`phase` attribute、`gl_Position`/`gl_PointSize`/`gl_FragColor`、`ElectronCloud.tsx` 按名字写入的三个 uniform、两端一致的 `vPhase` varying、以及 three.js 的 `#include` chunk 集合双向钉住）。复测：同一次攻击现在三处变红；即使**协同修改**（把该文件一并写进 `coverage-scope.json`）也照样变红，因为 vitest 自己的按文件门槛直接报 `hiddenColor.ts` 55.55%/33.33%——已经没有排除项需要看管了。代价是实测过的：新增一个 shader 模块需要一条清单记录加一个 import 它的 spec（没有 spec 时 `all: true` 把它记作 0%，门槛失败）。**其二，`check.ps1` 解析的是 `$PSScriptRoot`（目录），而身份判据只是对 `.git` 与 `pyproject.toml` 做 `Test-Path`。**两个**空文件**就能满足它：把真脚本硬链接进一个临时目录、`touch` 出这两个标记，实测脚本宣告了那棵外来树、把 6 个 uv 门禁与 2 个 npm 门禁全部在那里跑完、exit 0。现在改为：解析 `$PSCommandPath`（文件本身），跟随文件符号链接、再跟随其目录上的 junction/目录符号链接到真实位置；对硬链接**直接拒绝**（硬链接没有可跟随的目标，也没有哪一端标着“正本”）——实测 PowerShell 7.6.5 在存在第二个目录项时对**每一端**都报 `LinkType = HardLink`，因此只要存在任一硬链接，仓库自己的 `scripts/check.ps1` 也会一并拒绝运行，这是刻意选择的失效安全方向，脚本的报错里也这么写；随后用 `git -C <解析出的 scripts 目录> rev-parse --show-toplevel --show-prefix` 取代原来的标记判据——`$repoRoot` 直接取 git 给出的规范答案（不再靠字符串拼 `..`，也就没有分隔符、大小写与 8.3 短名的归一化问题），并要求 `--show-prefix` 恰好是 `scripts/`，把解析出的脚本钉在 `<工作区根>/scripts/check.ps1` 上；空的 `.git` 在 git 眼里是 `fatal: invalid gitfile format`。最后要求该根目录的 `pyproject.toml` 声明 `name = "QuViz"`——因为 `git init` 很便宜，任何 checkout 都能满足上一条。写这条时顺带发现并修掉一个同类缺陷：`Get-Content -Raw` 对空文件返回 `$null`，而 `$null -notmatch …` 求值为 `$null` 而**不是** `$true`，所以在补上 `[string]` 转换之前，一个空 `pyproject.toml` 静默通过了这道内容检查（实测 exit 0，八道门禁在一个 `git init` 出来的临时目录里全跑了一遍）。**其三，CI 的整个 `web` job 没有被任何东西钉住**——把它整段删掉，`tests/test_check_script.py` 全部通过，CI 会在前端门禁完全缺席的情况下变绿。现在 `push`/`pull_request` 两个触发条件、`web` job 的存在、`working-directory: web`、`actions/checkout` 与 `actions/setup-node`、`npm ci`、以及 `npm run test` 与 `npm run build` 的存在与先后顺序都按 YAML 结构钉住，且该 job 及其任何步骤都不得带 `if:` 或 `continue-on-error:`；九种改法（删 job、给 job 加 `continue-on-error`、给步骤加 `if`、删 `working-directory`、调换两条命令、删 `npm run build`、删 `push` 触发、把 `npm ci` 换成 `npm install`、删 `actions/setup-node`）逐一复测都变红，报错各自点名缺了什么。**仍未钉住的**：`python-docs` job 同样没有任何测试引用它，删掉它也不会变红——与上面是同一类缺口，本轮按范围未处理。另有一项本机测不到：`check.ps1` 跟随**文件符号链接**的端到端用例需要 Windows 的 `SeCreateSymbolicLinkPrivilege`（提权或开发者模式），本机三种创建方式（Python `os.symlink`、PowerShell `New-Item -ItemType SymbolicLink`、`cmd /c mklink`）都因权限被拒，该用例在 POSIX 与 CI 上照常端到端执行，在本机则打出显式警告并退回到只校验接线是否仍在——绿色**不**代表这条路径被实测过。

### 门禁的防护边界

前四轮每一轮都在运行内部再加一层观察者，第五轮不再这样做。这里如实写清这道前端门禁挡得住什么、挡不住什么。

**挡得住的，是覆盖率被“配置”悄悄削弱**——不论削弱是有意还是随手为之，而后者才是它日常真正在挡的东西。以下每一条都曾实测能让 `npm test` 以 exit 0 通过，现在都会变红：缩小 `coverage.include`/`exclude`；下调、置零、删除 `thresholds`（改配置源码、写进 CLI 参数、或由插件 `config()` 钩子删键，三种形态）；`perFile: false`；隐藏的点文件逃出源码扫描范围；把运行时模块放到不被 `coverage.include` 匹配的扩展名下（`.mts`/`.cts`/`.js`/`.mjs`）；整块文件的覆盖率 pragma（模块报 0/0/0/0，而 vitest 自己的门槛检查按 istanbul 的算法判为 100%）；用上一轮遗留的报告顶账；从 `npm test` 链条里删掉一段门禁，或在其中插入一段；删除或清空 `guards.test.ts`；把普通的 `.ts` 藏进一道**整目录**的覆盖率排除项里（`src/scene/shaders/**` 曾是这样一道口子，现已删除该排除项）；用 npm 的 `pretest`/`posttest` 生命周期钩子；把“类型专用”模块写成不再类型专用；**把受门禁模块的函数体整体搬进当时不受测量的 `src/state/` 或 `src/components/`、只留一行 re-export**（PR-6 与 PR-8A 之前这是一条被写进文档的已知逃逸，复检复现过；PR-8A 把 `coverage.include` 扩到 `src/**/*.ts` + `src/**/*.tsx` 之后，`src/` 下已经没有不受测量的目录，搬过去的函数体连同它未覆盖的分支一起进入按文件门槛）。另有两项**不是**复现出来的绕过，而是**失效安全的拒绝**——守卫推导不了这两种形态，于是直接拒收，而不是先让它们真绕过一次再补：`projects`/`workspace` 配置下顶层 `test.coverage` 可以原样不动、而每个 project 各自解析自己的测试配置，逐键比对于是会对着一份运行已经不再采用的设置通过（`guards.test.ts` 的注释原话是“没有任何东西能从形状上推出这一点，所以直接断言”）；取反与裸目录形式的匹配模式则会被 test-exclude 分别挪进 `excludeNegated` 与改写成 globstar 形式，让本文件这套 `some(minimatch)` 推导与 provider 实际测量的文件集静默不一致（注释原话是“与其推错，不如直接拒收”）。两项都实测会变红，只是从来没有“曾以 exit 0 通过”的记录，因此不按已复现的绕过计。

**挡不住的，是有人写代码去谎报覆盖率。** 具体是两类：一个 custom coverage provider 伪造 `resolveOptions()`（上文详述，捕获文件甚至不需要被碰）；以及一段能改写产物的额外链条段（上面已按精确元组关闭了这一处，但这一**类**依然存在——凡是能在 vitest 与校验器之间写 `coverage/*.json` 的东西都能击穿全部三道检查）。原因一句话就够：**一个可被改写、权限相同的信任域没法为自己作证**。请注意这条界线**不是**“观察者都在 vitest 进程里”——`assert-coverage-scope.mjs` 本来就是 vitest 退出之后才启动的另一个 Node 进程，它照样定不了案。是不是同一个进程从来不是关键；关键是产出证据的东西与读取证据的东西同属一份 checkout，可以被同一只手改写，而读的一方手里没有一份独立的“证据本该长什么样”。反过来说也成立：一个在**操作系统层面隔离**的 runner——工具链与配置不由这份 checkout 提供、源码以只读方式挂载——完全可以仍然待在 `npm` 这条链里，而它**确实**构成一道可信边界，因为被测的东西改不动施测的东西。所以缺的是**独立的权限**，不是独立的进程。要真正关闭它，可以走这条隔离 runner 的路，也可以脱离 `check.ps1` 这条链去独立插桩（例如用一份单独配置再跑一遍覆盖率并比对两次结果），或者由 CI 把覆盖率配置与一份受保护的基线做 diff——三条都需要 CI 侧改动，本轮**有意**不做。可以如实计入的补偿性控制只有一条，而且要按实测的分量记：一次给仓库加入 coverage provider 或 vite 插件的 diff 本身就是评审信号，`tests/` 里那三条钉子（不许有 `plugins` 键、import 列表恰好一条、`web/scripts/` 文件清单）是**评审期的绊线**，挡住的是**这类攻击已知的几种拼法**——`plugins` 键直接写在 `vitest.config.ts` 里、伪 provider 直接放进 `web/scripts/`、把 `plugins` 数组挪进一个被 import 的模块，三者都实测变红。它们**不是**这一类攻击的墙。第三条钉子补上之前，最后那种拼法实测是绿的：`vitest.config.ts` 只多两行（一行 `import { shared } from './base.config'`、一行 `...shared,`，且两行都类型正确）、伪 provider 放在 `web/scripts/` 之外，另外两条钉子都不响，整条 `check.ps1` exit 0，伪造的 `coverage-final.json` 被三行门禁摘要照单认证（三个模块的语句/函数计数完全一样，真实的 v8 报告不可能长这样），而 `color.ts` 里那个未覆盖的导出函数照常发布。补上 import 钉子之后同一手法变红（`test_vitest_config_imports_exactly_these_modules` 失败，`check.ps1` exit 1）——但这只说明**又少了一种拼法**，不说明这一类被关掉了：钉子钉的是接线方式，不是伪造能力。所以这条控制只能如实计为“抬高了随手为之的成本”，而不是“必须变红才能落地”。

### 本树实测结果

下表于 2026-08-27 在 Windows 11、CPython 3.12.10、Node/Vite 现有锁定依赖与已存在 `web/dist` 的本检出上实测。先逐项运行定向测试，再执行 `pwsh -NoProfile -File scripts/check.ps1`；以下“通过”均来自整条命令的 exit 0，而不是第一道 Ruff 打印的 `All checks passed!`：

| 检查 | 当前结果 |
|---|---|
| `ruff check .` / `ruff format --check .` | 通过；101 个文件已格式化 |
| `mypy`（strict） | 31 个源码文件无问题 |
| `uv run --group docs pytest --cov=quviz` | 872 passed，0 failed，0 skipped，77 warnings；本树总覆盖率 92.36%（门槛 85%），本检出存在 `web/dist` |
| 引用索引 `--check` | 通过 |
| `mkdocs build --strict` | 通过；仅有上游 mkdocs-material 2.0 提示 |
| `npm run test` | 7 个文件 242 tests passed（`Inspector.test.tsx` 7 项、`sceneStatus.test.ts` 2 项），0 skipped，0 todo；报告列出的 4 个门禁模块与 `coverage-scope.json` 完全一致，四个模块语句/分支/函数/行覆盖率均为 100% |
| `npm run build` | 通过；`index-*.js` 1,206.27 kB（gzip 329.78 kB），CSS gzip 3.60 kB；仍有 chunk > 500 kB 警告 |
| 完整门禁 | `pwsh -NoProfile -File scripts/check.ps1` exit 0 |

77 条 pytest 警告来自 FastAPI/TestClient、scikit-image，以及 Windows 无权限创建文件符号链接时的显式 fallback 提示；本轮未处理。

## 剩余限制

1. 源码 checkout 的真实全栈门禁已覆盖核心表示法切换，但五张像素基线仍只覆盖固定 Linux/Chromium/SwiftShader 的切片主路径；真实 GPU、多浏览器、移动视口和响应式/无障碍浏览器矩阵仍未覆盖，wheel 的静态资产打包与安装后启动也尚未验证；全栈 JSON 后审计会拒绝空跑与错误运行身份，但尚未像视觉门禁那样用 AST/content manifest 钉住固定标题测试体内的六段旅程与关键断言；
2. 拆分 Three.js/后处理 bundle，并测量帧时、显存与大资产传输；
3. 将等值面验证扩展到更高 $n$ 前，先设计随节点数增长的收敛策略；
4. 原计划在进入解析含时叠加前先实现切片和节点面 representation，实际顺序没有遵守：概率流先交付，M1 叠加态先于切片完成，$\psi$/相位切片与相位遮罩到 PR-8B 才落地；真正的**节面 representation**（节点几何本身）仍未实现——切片报告的是低振幅 / 相位未定义遮罩，不是节面；
5. 清理 FastAPI/TestClient 与 scikit-image 上游弃用警告。

### PR-7 科学正确性：八项 P1 已实现

本轮冻结并实现的契约如下；所有回归均先由旧实现真实变红，再修复为绿，未放宽既有数值容差：

1. 长度真源是 $a_\mu/Z$。流线默认 `arc_step` 为最紧致 active term 的 $0.03n^2a_\mu/Z$；显式 override 必须满足 $1/4096\leq\texttt{arc\_step}/L_{\min}\leq1/8$，下界绑定单路径 4096 点硬上限，上界使一个支撑尺度半径的圆周仍约有 50 步，超界 API 请求返回 422；请求还必须满足 `active_terms × [seed_filter_evaluations_per_term + seed_count × (1+5(max_points−1))] ≤ 2,000,000` 与 `seed_count × max_points ≤ 100,000`，其中数值积分叠加态的 $21^3$ 候选 lattice 速度过滤逐 term 计费，本征态与解析零流早退为 0；播种阈值满足 $\rho_{\min}(\max n^2a_\mu/Z)^3=10^{-4}$；探针覆盖每个 active shell 的 $n^2a_\mu/Z$ 支撑尺度，梯度/散度差分分别为 $10^{-5}$ 与 $10^{-3}$ 倍的 $\min(na_\mu/Z)$；
2. 非定态连续性分母改为时间无关的 transition-coherence 平方和开根参照尺度：相同能隙的 $2\omega(c_a\phi_a)^*c_b\phi_b$ 先相干相加，不同能隙作二范数组合；它是明确的 reference，不冒充多频瞬时和的上包络。builder 另对每个不同能隙取四个辅助相位的最大残差，故转折点不再只靠“非零分母”装成有效检查；真正 stationary 的非零流改用 $\max|\mathbf j|/L_d$，实基共相位或复基 $c_m=\kappa(-1)^mc_{-m}^*$ 的解析零流单独标识并跳过数值积分；
3. render-grid Gram matrix 与真实有限 cube 分开报告。每个径向尾部由 Laguerre 多项式平方后的有限不完全-Gamma 级数解析计算；奇偶性与 Cauchy–Schwarz 给出有限盒真实质量变化上界，同能隙离散交叉项先相干求和，再由反三角不等式给 grid alias 的变化下界。单个网格不能证明 boundary flux，因此 schema 没有这类状态；
4. 每个 term 先校验量子数与系数有限性；state 随后剔除**精确零**（不按容差吞掉小系数），再依次检查全零、active duplicate、归一化。因而零系数 duplicate 不报错，全零报错，$10^{-12}$ 乃至 $10^{-200}$ active term 保留；极小 coherence 用 `hypot` 组合避免平方下溢，无法得到非零参照时失效安全报错；
5. 在 `SuperpositionState`→scene/API 链路冻结 `a_mu=m_e/μ`、`reduced_mass_ratio=1/a_mu`。同一输入同时进入空间波函数、$E_n=-Z^2/(2a_\mu n^2)$、时间相位、概率流 prefactor、连续性、Hamiltonian 与 scene extent；superposition API/metadata 同时携带 `z`、`a_mu` 与 reciprocal。低层 energy primitive 保留显式 ratio 参数；
6. 实部或虚部为 NaN/Inf 的系数在进入 state 前即拒绝，有限但会令平方溢出的巨大系数也以 normalization error 拒绝；Python `label()` 与前端 Inspector 都保留负实系数、复相位和极小非零项，不再显示模长或假零冒充代数系数；
7. 径向 Hamiltonian 使用按 $na_\mu/Z$ 缩放的五点中心差分、$h$/$h/2$ Richardson 外推和独立差分误差门禁；显式步长测试要求折半收敛比大于 32，并证明默认路径实际细化，不能用调松 $5\times10^{-6}$ 物理残差门槛过关；
8. 径向矩在无量纲坐标上用 $N$/$N/2$ Gauss–Legendre 规则，并要求连续两次有限域扩张收敛；正项在 log space 累加，可表示结果必须 finite，不可表示结果明确 overflow；除 1s 外另由 $n=6,l=5,p=60$ circular-state Gamma 比率作独立负控制。

定向测量（2026-08-27，本机 CPython 3.12.10；同一最终工作树上的单一脚本）如下：

| 复现条件 | 修复后实测 |
|---|---|
| 实系数 1s–2p，$t=0$，8 个尺度化探针、4 个相位 | 瞬时 `density_rate_scale = 0`；transition reference $4.1112662\times10^{-3}$；绝对残差 $3.9328180\times10^{-9}$；phase-audited normalized residual $9.5659531\times10^{-7}$。把 current 替换为恒零的负控制得到 residual $1.0$ |
| $a_\mu=0.5$ 的 1s–2p | energies $(-1,-0.25)$ Ha，$\langle H\rangle=-0.625$ Ha；不再与 $a_\mu=1$ 相同 |
| $n=6,\ell=0,Z=0.05$，1500 个 $r\in[0.6n/Z,6n^2/Z]$ 探针 | $\max\lvert H\psi-E\psi\rvert/\max\lvert E\psi\rvert=1.4932093\times10^{-10}$；初始/最终步长 17.28/1.08 bohr，实际细化 4 次，门槛仍为 $5\times10^{-6}$ |
| 1s，512 nodes：$(p,Z,a_\mu)=(31,1,1),(60,2,0.5),(170,1,1)$ | 对各自闭式的相对误差依次为 $3.8626490\times10^{-13}$、$4.4366841\times10^{-13}$、$5.8787848\times10^{-14}$ |
| 1s+2s，49³，cube half-extent 19.8448875 bohr | grid mass 从 $t=0$ 的 0.951133397 到半周期的 0.990280394；cube 外质量上界 $2.35944\times10^{-5}$，真实 cube 质量变化上界 $9.51747\times10^{-10}$，grid phase variation 0.039146997，alias variation 下界 0.019573498，报告阈值 0.002，分类 `phase_dependent_quadrature_error` |
| 1s+2p，49³，cube half-extent 18.6711075 bohr | grid mass 从 $t=0$ 的 0.978543619 到半周期的 0.978543619；反宇称令真实 cube 质量变化上界为 0，grid phase variation $5.01335\times10^{-16}$，报告阈值 0.002，分类 `time_invariant_quadrature_error` |

### 工程如实性：本轮改动

本轮不改科学契约，只修正工程侧此前的失实或不完整表述：

- `quality-gates.md` 关于 Grid 的条目改为如实分列——坐标/`dx`/边界条件确由同一 Grid 对象提供并受 `tests/test_grid.py` 覆盖，但求积权重与内积**尚未**存在于 `quviz.solvers.grid`，此前把二者写进已完成项是失实，现标为 🕒 并说明随 M2 求解器一并落地；
- CI 的 `python-docs` job 新增 `python-version: ["3.12", "3.13"]` 矩阵（`fail-fast: false`），并由新增的 `tests/test_ci_workflows.py` 把矩阵与 `pyproject.toml` 的 `Programming Language :: Python :: 3.x` classifiers、`requires-python` 逐一比对，二者不再允许互相漂移；
- `python-docs`、`link-check`（`changed-links`）与 `web` 三个 job 的依赖安装改为无条件 `uv sync --locked --all-groups` / `npm ci --no-audit --no-fund`，删除锁文件缺失时静默改用 `uv sync` / `npm install` 的旧回退分支——该分支恰好会在锁文件缺失或过期时把安装伪装成绿；`tests/test_check_script.py` 新增/加强的断言钉住这一行必须逐字如此、且 `npm install` 不得再出现在 `web` job 里；
- `docs/getting-started/installation.md` 的 Node 版本要求从笼统的 “20+” 改写为与 `web/package.json` 的 `engines` 字段完全一致的 `^22.13.0 || >=24.0.0`，并注明 Node 20/21 会被 `engines` 拒绝；新增 `tests/test_declared_versions.py` 用参数化用例钉住这行文档字符串，防止再次退化为一个不可比对的裸主版本号；
- `docs/reference/api.md` 补齐此前完全未文档化的 4 个 API 路由（`GET /api/orbitals/current-field`、`GET /api/superposition/catalog`、`GET /api/superposition/isosurface`、`GET /api/superposition/current-field`）的参数范围、422 条件与返回字段；`docs/reference/physics-api.md` 新增 `quviz.physics.continuity`、`quviz.physics.finite_box`、`quviz.scene.builders` 三个此前有实现却未接入 mkdocstrings 的模块的引用条目；
- `src/quviz/solvers/grid.py` 的模块 docstring 同步修正——不再声称提供 quadrature，与 `quality-gates.md` 的如实条目一致（`tests/test_declared_versions.py` 中模拟中文文档行的夹具字符串保留全角分号，逐行以 `noqa: RUF001` 标注为有意数据）。

本树实测（2026-08-27，Windows 11、CPython 3.12.10，同一最终工作树上的完整门禁）：

| 检查 | 结果 |
|---|---|
| `pwsh -NoProfile -File scripts/check.ps1` | exit 0，全链跑满 |
| ruff / mypy（strict） | All checks passed；103 files already formatted；31 个源码文件无问题 |
| `pytest --cov=quviz` | 899 passed，0 failed，0 skipped，77 warnings；总覆盖率 92.36%（门槛 85%）——较上轮 +27（`tests/test_ci_workflows.py` 21 项、`tests/test_declared_versions.py` 6 项） |
| `mkdocs build --strict` | 通过；仅有上游 mkdocs-material 的 MkDocs 2.0 提示 |
| `npm run test`（`web/`） | 8 个 spec 文件、264 tests passed，0 skipped，0 todo；报告列出的 4 个门禁模块与 `coverage-scope.json` 完全一致，四项覆盖率均为 100% |
| `npm run build` | `index-*.js` 1,207.54 kB（gzip 330.35 kB），CSS gzip 3.60 kB |

另经隔离环境实测：CI 等价调用（`uv sync --locked --all-groups` 后 `--group docs pytest`）在 CPython 3.13 下 878 passed（当时树尚无本轮新增的 21 项 CI 钉子测试），锁文件在 3.13 下可原样解析，故 3.13 入矩阵有实证支撑。同轮发现的一处依赖失实现已修复：`quviz.docs.scan` 与 `quviz.docs.citations` 运行时导入 `markdown`，而该包此前只作为 `docs` 依赖组的传递依赖存在，未在 `dependencies`/`dev` 中声明——不带 `--group docs` 的 `uv run pytest` 会在收集期以 `ModuleNotFoundError: No module named 'markdown'` 失败，装 wheel 的使用者同样拿不到它。现已把 `markdown>=3.10` 写入 `[project] dependencies` 并重新生成 `uv.lock`（`uv lock --check` 通过，锁文件仅新增两行，把 `markdown` 从 `docs` 组的传递依赖提升为直接依赖）；新增的 `tests/test_declared_dependencies.py` 把 `src/quviz` 下每一个第三方顶层导入按已安装元数据映射回发行名，逐一比对 `[project] dependencies` 的声明，使同类漏声明不能再借传递依赖无声通过。

### PR-8A 前端如实性与覆盖率扩围：2026-08-27

本轮不改科学契约，只做两件事：让前端**说的**与它画的、与 `routes.py` 真正接受的保持一致；把覆盖率门禁从 `src/api/**`、`src/scene/**` 两个目录扩到 `src/` 下的全部生产模块。每一项同样按“先写出会变红的测试、再实现”推进。

- **能力矩阵成为唯一事实源**（`src/api/capability.ts`）：此前“这个态能不能画”散落在 store 断言、`disabled` 属性和 fetch 分支三处，各自只知道路由约束的一部分——例如流线判据只测 `basis === 'complex' && m !== 0`，于是 $n=8$ 照样发出请求，而路由在 $n>6$ 就拒绝，用户看到的是一条红色错误而不是“这个态超出该路由的范围”。现在矩阵按 `(场景, representation)` 逐格给出结论，边界数值逐条从路由签名转写；拒绝分两类且不允许混用：`unsupported`（物理或路由说不行，并给出理由）与 `not_implemented`（没有任何东西说不行，只是还没做）。**叠加态 × 点云**据此归为 `not_implemented` 并**带理由展示**，而不是从界面上消失：`/api/orbitals/point-cloud` 只接受一个定态 $(n,\ell,m)$，无法表达 $\lvert\Psi(t)\rvert^2$，这是没实现，不是物理禁止。
- **叠加态概率流接线**：`/api/superposition/current-field` 此前只有后端与 client 函数，场景里没有任何调用者。现在它与叠加态等值面走同一条 `useSceneAsset` 取数路径，连续性残差、参照尺度种类、探针/相位计数等审计字段一并进入 Inspector。
- **叠加态参数显式化**：`terms`、`time`、`resolution`/`seed_count`、`basis`、`z`、`a_mu`、`probability_mass` 全部显式写进 query，不再依赖服务端默认值——“漏写一个参数”不会报错，只会返回一张**没人要过的态**的正确图。其中 `basis` 是新增的独立 store 字段 `superpositionBasis`（默认 `complex`），与定态的 basis 开关**解耦**，因此本轮渲染出来的物理与此前一致；`a_mu` 按既定决策只进 store、默认 1.0、**不给滑块**，在控制面板上以只读项（`data-readonly="a_mu"`）与 Inspector 的“Reduced-Bohr scale $a_\mu$”两处显示。
- **QVPC body 两端校验**：解码端（`web/src/api/qvpc.ts`）此前只校验头部，body 里的 NaN 坐标、越界 intensity 或越界 phase 会被直接画出去；现在逐样本要求有限、`intensity` 落在 $[0,1]$、`phase` 落在 float32 的 $[-\pi,\pi]$（用 `Math.fround(Math.PI)` 作界，因为负实振幅的 `np.angle` 恰为 $\pi$，而 float32 的 $\pi$ 在 double 下大于 $\pi$）。生产端在 `tests/test_scene_contract.py` 新增对照：对编码器**真正写出的字节**断言同一组界，并用 $m=1$ 复基轨道的相位极差 $>6$ 防止断言落空——采样器改坏时在 Python 侧就变红，而不是变成一个“服务端一切正常”的浏览器解码错误。
- **Inspector 如实性**：新增 `formatFinite`，任何非有限数（NaN/±Inf/缺失）一律显示 `—` 并连带丢掉单位，不再把 `NaN Ha` 或 `0` 当作读数；系数标签保留负实系数、复相位与极小非零项的代数形式，不再显示模长冒充系数。
- **刷新中 / 陈旧帧提示**：时间轴推进时旧帧仍留在屏幕上，此前 Inspector 的数字属于**上一帧**却与新的 $t$ 并排显示。现在取数期间发出 `refreshing: true` 并携带请求中的 `timeAu`，界面明说“这些数字来自上一帧、正在取 $t=\dots$”，而不是给一个看起来同步的读数。
- **测试 harness**：DOM 规格按文件在首行以 `/** @vitest-environment jsdom */` 显式声明，`vitest.config.ts` 的默认环境仍是 `node`（不引入 `setupFiles`、`plugins` 或任何新 import，`tests/test_check_script.py` 把该文件的 import 列表钉死为恰好 `vitest/config` 一条）；three/React 组件用 `@react-three/test-renderer` 真正挂载后再断言场景图。
- **覆盖率扩围**：`coverage.include` 改为 `['src/**/*.ts', 'src/**/*.tsx']`，门禁模块从 7 个变为 **24 个**（`pragmaScanned` 25 个 = 24 + 唯一排除项 `src/api/types.ts`）。这直接关闭了此前**写进本文档**的那条已知逃逸——“把受门禁模块的函数体搬进 `src/state/`、`src/components/`，只留一行 re-export”——`src/` 下已经没有不受测量的目录，因此本轮删去了原第 72 行的边界说明与《门禁的防护边界》里的《已知的组合逃逸》一段，并把这条改写进上面“挡得住的”清单。同轮修掉一处**会让守卫静默失效**的推导缺陷：`guards.test.ts` 的扩展名泄漏检查原以 `pattern.split('/')[1]` 取门禁根、以 `startsWith(root + '/')` 过滤，一旦 include 写成 `src/**/*.ts`，根就是字面量 `**`，而没有任何路径以 `**/` 开头——内层循环一次都不执行，`leaked` 恒为空，`src/components/Inspector.mts` 这样的文件放在树里也照样全绿。现改为具名的 `gatedRootOf` / `isUnderGatedRoot` 两步，`**` 明确定义为“整个 `src/`”，并各带正面对照（`isUnderGatedRoot('**', 'components/x.mts') === true`，同时断言被替换掉的朴素写法对同一路径为 `false`）；检查体本身另加一条“本次共检视了多少个文件”的非空断言。把 `isUnderGatedRoot` 改回朴素写法后，两条断言分别报 `components/Inspector.mts: expected false to be true` 与 `expected 0 to be greater than or equal to 24`，随即恢复变绿。

本树实测（2026-08-27，Windows 11、Node/Vite 现有锁定依赖，同一最终工作树）：

| 检查 | 结果 |
|---|---|
| `npm run test`（`web/`） | 25 个 spec 文件、504 tests passed，0 skipped，0 todo；报告列出 24 个门禁模块，与 `coverage-scope.json` 完全一致；24 个模块的语句/分支/函数/行覆盖率按文件门槛全部达标（表格：All files 100 / 99.83 / 100 / 100，唯一非满分是 `Inspector.tsx` 的 branch 99.32%，门槛 85%） |
| `npm run typecheck`（`tsc -b`） | exit 0 |
| `npm run build` | `index-*.js` 1,219.07 kB（gzip 333.41 kB），CSS 12.43 kB（gzip 3.60 kB）；2394 modules；仍有 chunk > 500 kB 警告 |
| `pytest tests/test_scene_contract.py` | 12 passed（含本轮新增的 QVPC body 生产端对照） |
| `src/guards.test.ts` 单文件 | 131 tests passed |

叠加态两条路由的**本机往返实测**（2026-08-27，`uvicorn quviz.api.app:app`，`127.0.0.1`，同进程内先做一次预热请求后丢弃，再以三个互不相同的 $t$ 各发一次请求以避开服务端缓存，取中位数；状态为默认的 $\tfrac{1}{\sqrt2}(\lvert100\rangle+\lvert210\rangle)$、`basis=complex`、$Z=1$、$a_\mu=1$）：

| 路由 | 预热 | 三次互异请求 | 中位数 | 末次响应 |
|---|---|---|---|---|
| `GET /api/superposition/isosurface`（`resolution=65`，`probability_mass=0.90`） | 137 ms | 120 / 145 / 145 ms | **145 ms** | 420,458 B，2626 个顶点 |
| `GET /api/superposition/current-field`（`seed_count=48`，**预算上线前历史请求**） | 2442 ms | 2690 / 2669 / 2667 ms | **2669 ms** | 754,906 B，48 条流线 |

三点需如实说明：其一，**重复同一条 query 会命中服务端缓存**，同样的请求第二次分别是 15.7 ms 与 6.5 ms，所以“3 ms / 20 ms”这类数字只描述缓存命中，不是这两条路由的计算成本——上表刻意用互异的 $t$ 测量。其二，默认态在 $t=0$ 处概率流是**解析零流**，`current-field` 返回 0 条流线（`density_rate_scale = 0`，`continuity_scale_kind = transition_coherence`），因此 $t=0$ 不能用来代表这条路由的耗时。其三，表中的 48-seed 数据是资源预算上线前的历史测量；当前叠加态请求上限是 40，不能把这些耗时/字节数改名后当作 40-seed 实测。`capability.ts` 里的 `latency: 'slow'` 是成本分级，不是实测预算。

### PR-8B 切片科学资产与 API 契约：2026-08-27

本轮交付 $\psi$/相位平面切片这一 representation，并把 Python 与 TypeScript 之间的 API 描述从“两份手写副本”改成“一条端到端生成并双端受检的链”。每一项同样按“先写出会变红的测试、再实现”推进。

- **平面标架是冻结契约，不是实现细节**（`src/quviz/physics/planes.py`）：三张主平面各有右手 $(u,v,n)$ 标架且 $\hat u\times\hat v=\hat n$，因此 `xz` 的法向必须是 $-\hat y$。写成 $+\hat y$ 会让标架变成左手系，从而把这张平面上每一条与手性有关的结论（概率流环绕方向、相位缠绕符号）整体镜像，而 payload 仍然会声称一切正常。
- **采样轴不用 `np.linspace`**：`linspace(-E, E, R)` 以 `start + step*i` 生成再修补端点，在一般 extent 下两半**并非逐位互为相反数**，切片的对称性断言与节点位置于是由舍入决定。轴改为 $\texttt{spacing}\times(\texttt{arange}(R)-\texttt{half})$（$\texttt{half}=(R-1)//2$，$\texttt{spacing}=2E/(R-1)$），IEEE 取负精确、小整数 `arange` 精确，故在任意 extent 下逐位反对称；`tests/test_planes.py` 留了一条把公式换回 `linspace` 就变红的负控制。`resolution` 必须为奇数同出一源：偶数轴不采样原点，而每条对称性/节点/遮罩陈述都是关于**过原点的平面**说的。
- **相位遮罩参照状态，不参照平面**：一张恰好具有节面对称性的平面上，算出来的振幅不是零而是数值残渣——实基 $2p_z$ 在 `xy` 平面上的 $\max\lvert\psi\rvert$ 实测为 $4.4874712\times10^{-18}$。若以切片自身最大值定阈值，阈值会重新标定到这点残渣上，交回一整面毫无意义的相位。阈值因此是 $\texttt{relative}\times L_{\mathrm{ref}}^{-3/2}$（$L_{\mathrm{ref}}=n^2a_\mu/Z$，叠加态取 $\max_k$），$\texttt{relative}=10^{-6}$，另设数值地板 $64\varepsilon\max_{\text{plane}}\lvert\psi\rvert$，二者取大后**严格**大于才算有效。六个分项（relative、amplitude scale、threshold、numeric floor、平面最大模、masked fraction）全部随 payload 报告，读者能看出是哪一项在决定边界。同一张 $2p_z$ 的 `xy` 相位切片实测 threshold $1.25\times10^{-7}$、floor $6.3770801\times10^{-32}$、`phase_masked_fraction = 1.0`（由 threshold 决定）。
- **遮罩的措辞是契约的一部分**：被遮罩的样本只表示该平面上 $\lvert\psi\rvert\leq$ threshold，这个集合既包含节面也包含指数尾部，它标记的是低振幅 / 相位未定义区域，**不是节点证书**。上面那个 `1.0` 恰好确实落在 $2p_z$ 的节面上，但同一个 `1.0` 也可以由一张完全落在指数尾部的切片产生，所以遮罩本身不是那个结论的证据；这句话同时写进 `scene-contract.md`、payload docstring 与 metadata warning。
- **extent 是导出并报告的，不是参数**；masked 样本携带有限哨兵 `0.0`，因此忽略遮罩的客户端画出确定占位值，payload 也能通过严格 JSON 解析器——这与既有的非有限数门禁同源：模型在字段仍可归因时拒绝 `NaN` / `±Infinity`；锁定版本的 Starlette `JSONResponse` 也以 `allow_nan=False` 拒绝它们，而不是把裸 token 写上线路。
- **resolution 下限与等值面的 $n\le4$ 上限不是同一回事**：等值面的限制是关于 marching cubes；切片虽然只在 $R^2$ 个点上求值，仍必须解析状态自身最紧致的径向特征。PR-8B 最初只使用 $\max(65,16n+17)$ 的 shell-count floor；2026-08-29 的复审已将它收紧为该 floor 与精确 Laguerre 径向节点/紧致分量 floor 的较大者。当前实测 4s 在 81 拒绝、97 接受；12s 以及 1s+12s 即使在 513 上限仍明确 fail-closed。路由仍允许表达 $n\le12$，但这不是对每个该范围内状态都承诺成功生成 uniform full-extent slice。
- **`a_mu` 的不对称是刻意的**：`/api/orbitals/slice` 是唯一暴露 `a_mu` 的本征态路由，因为切片是约化质量长度唯一直接可读的地方——它同时改变导出的 extent 与遮罩参照的振幅尺度，两者都逐字出现在 payload 里。
- **黄金 fixture**：`tests/fixtures/slice_golden.json`（81,998 B）是 1s 在 `xy` 平面、`observable=phase`、`resolution=65` 的整份序列化 `SlicePayload`，由 `scripts/write_slice_golden.py` 以 canonical dump（`sort_keys=True`、`indent=2`、`allow_nan=False`）写出、`tests/test_slice_contract.py` 重建后逐字节比对，因此客户端收到的数字一旦变化就必须以一份有人读的 diff 出现，而不是整套测试跟着重新推导、于是一致同意。
- **类型代码生成**：`routes -> tests/fixtures/openapi.json -> web/src/api/schema.gen.ts` 是一条端到端生成、两端都受检的链——`scripts/write_openapi.py` 从活的 app 写出 committed fixture，`tests/test_openapi_contract.py` 比对它与今天服务的 schema；`web/scripts/generate-api-types.mjs`（`npm run codegen`）以该 fixture 而非某台运行中的服务器为输入生成类型，`web/src/api/schema.gen.test.ts` 比对生成结果与提交进树的文件，链上没有无人看管的一环。`schema.gen.ts` 与 `types.ts` 一样是覆盖率门禁的“仅含类型”排除项（当前 `pragmaScanned` 31 = `coverageGated` 29 + 这两个），新增的生产模块自动进入同一清单审计。

定向实测（2026-08-27，Windows 11、CPython 3.12.10，同一工作树；`uv run pytest <file> -q --no-cov`）：

| 定向套件 | 结果 |
|---|---|
| `tests/test_planes.py` | 19 passed |
| `tests/test_slice_builders.py` | 16 passed |
| `tests/test_slice_science.py` | 35 passed |
| `tests/test_slice_contract.py` | 4 passed |
| `tests/test_slice_api.py` | 25 passed |
| `tests/test_openapi_contract.py` | 3 passed |
| 六者合并一次运行 | 102 passed，0 skipped，1.69 s |
| `npx vitest run src/api/sliceContract.test.ts` | 47 passed |
| `npx vitest run src/api/schema.gen.test.ts` | 4 passed |

payload 体积实测（`n=2, l=1, m=0`，`plane=xz`，`TestClient` 响应字节数）：

| `resolution` | `probability_density` | `phase` |
|---|---|---|
| 129（默认） | 364,210 B | 266,892 B |
| 513（上限） | 5,736,707 B | 4,209,037 B |

513 是硬上限，默认取 129 的理由就写在这张表里：它够画一张清楚的图，又比上限便宜 16 倍。

### PR-8C 切片渲染与视觉 CI：2026-08-27

本轮把切片从 payload 画成像素，并把“画得对不对”这件事第一次接进 CI。同样按“先写出会变红的测试、再实现”推进。

- **视觉门禁是新的一类**：`web/e2e/` 下的 Playwright 套件由 `npm run test:visual` 运行（`playwright test` 之后 `web/scripts/assert-visual-run.mjs`），CI 里是 `ci.yml` 新增的 `web-visual` job（`ubuntu-latest`、`working-directory: web`、`npm ci --no-audit --no-fund`、`npx --no-install playwright install --with-deps chromium`、`npm run test:visual`，失败时上传 `web/playwright-report` 与 `web/test-results` 保留 7 天）。它**不在** `check.ps1` / `make check` 内，而且不是“暂未加入”：`web/playwright.config.ts` 在非 Linux 上于模块加载时抛错，所以这条门禁在开发机上不允许运行。理由不是洁癖——真正的危险是本机全红之后有人敲 `--update-snapshots`，用这台机器的像素覆盖掉 CI 基线，此后套件本地绿、CI 红且不再描述任何回归。守卫写成抛错而不是 `skip`，因为 `skip` 之下 `--update-snapshots` 照样能写。
- **`web-visual` job 本身被钉住**，理由与 PR-6 钉住 `web` job 时相同：删掉一个 job 比击败它里面任何一条断言都便宜，而在此之前没有任何东西读它。`tests/test_check_script.py` 新增 6 项，按 YAML 结构钉住 job 的存在、runner、工作目录、两条安装命令的逐字拼写、gate 步骤及其必须排在浏览器安装之后、与 `web` job 同一个 Node 版本，以及“除失败上传外任何步骤都不得带 `if:`，上传的 `if:` 必须恰好是 `failure()`“。四种改法逐一实测变红：删掉整个 job（6 项全红）、给 gate 步骤加 `if: success()`、把上传的 `if:` 改成 `always()`、把浏览器安装的 `--no-install` 去掉。`--no-install` 是这条里唯一新增的理由：浏览器二进制按 Playwright 版本绑定，没有它时 npx 会去 registry 取一个 lockfile 没有钉的 Playwright，于是拿一个从未参与渲染的 Chromium 去比对基线。
- **零 skip 扫描扩到 `web/e2e/`**：那些 spec 不在 `test.include` 里，vitest 从不收集，`allowOnly: false` 与 `assert-no-skips.mjs` 都看不见它们（后者的期望清单由 `src/` 推导，从未期望过的文件不会被“漏掉”）。扫描前先用 TypeScript 解析器把注释涂白：那些 spec 的正文要解释“为什么这里断言而不是 skip”并因此写出了那个调用，实测直接扫原文会在 `webgl.spec.ts:13` 命中一段散文。字符串字面量**不**涂白，所以 `runner['sk' + 'ip']` 这类拼写仍然可见；注释范围取自真解析器而不是正则，因为正则字面量里可以有 `//`。负控制实测：往 `web/e2e/` 放一个带真 `skip` 的临时 spec 立刻变红并点名行号（随即删除）；把 `E2E_ROOT` 指向一个没有 spec 的目录时，“扫描确实够到了那棵树”这条断言变红——它存在正是因为空清单会让整个扫描静默地无事可做。
- **基线在 PR-8C 当时尚未存在，随后已经完成 bootstrap**：`updateSnapshots: 'none'` 让缺失基线成为失败，而不是被静默写入的答案键（Playwright 默认的 `'missing'` 会把新断言的第一次运行变成它自己的答案键，包括 bug）。第一次 CI 运行因此按设计失败，人工检查 `test-results/<test>/<name>-actual.png` 后，五张 Linux/SwiftShader PNG 已提交到 `web/e2e/__screenshots__/slice.spec.ts/`。bootstrap 期间发现的相机竞态并未被 `prefers-reduced-motion` 消除；真正的修复是在 `aimCamera` 前调用 `bounds.refresh()`，清空 drei `Bounds` 仍会晚着陆的 fit goal。后续运行仍必须在相同 CI 环境对基线验证，不能在开发机上重写答案键。
- **fixture 而不是服务器**：`web/e2e/fixtures.ts` 把六份切片 payload 与两份 catalog 逐字节取自 `tests/fixtures/visual/`（`scripts/write_visual_fixtures.py` 写、`tests/test_visual_fixtures.py` 重建并比对，27 项），所以一次像素 diff 只能是关于渲染的，不会变成关于服务器今天返回了什么的争论。**比对方式按 fixture 分成两类，这是实测逼出来的**：两份 catalog 的 route-owned 字符串与标量具有确定性；其中 superposition 的 `period_au` 有意由固定氢样能级差和 `math.tau` 计算，不经过切片样本那条平台敏感的 libm 链，因此逐字节比对。六份切片按结构比对——键集、类型、列表长度、字符串、整数与 `valid_mask` 的每一位都必须精确相等，只有浮点样本允许 `1e-12` 的相对偏差。理由是 fixture 在 Windows（UCRT）生成而 CI 在 Linux（glibc）重建，`arccos`/`atan2`/`cos`/`exp` 这条链两边的末位舍入不同，十进制表示因此不同：CI run 33085530468 就是这样在六份切片上全红，每份只差 4225 个样本中的一个，而 payload 本身没有任何变化（同一原因此前把 `test_slice_science.py` 的 S2 界放宽到 4 ulp）。放弃的只有“换一个平台重建后逐位相同”这一条——送进浏览器的仍然是 committed 的那份字节；允许量则比任何截图能显示的最小变化低十个数量级，并由两侧的负控制钉住：单个样本改动 `1e-9` 仍然变红，而一份把每个样本走三个 ulp、并把节线上 64 个 `cos(arccos(z/r))` 残差整个换掉的“Linux 重建”仍然变绿。
- **每条截图声明都另有一条与平台无关的断言**，图片只多出“固定的 SwiftShader WebGL 管线确实把它光栅化成了这些像素”这一句：行主序与 texel 字节偏移在 `sliceTexture.test.ts`（23 项），色标与遮罩着色在 `sliceColor.test.ts`（19 项），右手标架与哨兵读作 `null` 在 `sliceContract.test.ts`（47 项），四项纹理决定与三张平面的朝向在 `SliceField.test.tsx`（8 项），视点在 `camera.test.ts`（10 项）。反过来读同样成立：一张绿的截图不能替代其中任何一条，也不能证明真实 GPU 或其他浏览器的行为。

本树实测（2026-08-29，Windows 11、Node 24、CPython 3.12.10，同一工作树）：

| 门禁 | 结果 |
|---|---|
| `npm run test` | 32 个 spec 文件、939 项全部通过，0 skipped、0 todo；总语句覆盖率 99.88%，报告列出 29 个门禁模块，与 `coverage-scope.json` 完全一致，29 个全部达标 |
| `npm run typecheck` | `tsc -b --pretty false` exit 0 |
| `npm run build` | 通过；`index-*.js` 1,247.16 kB（gzip 343.47 kB）；仍有 chunk > 500 kB 警告 |
| `uv run pytest`（含覆盖率） | 1242 passed，0 skipped；总覆盖率 91.93%，门槛 85% |
| `uv run mypy`（strict） | 34 个源码文件无问题 |
| `uv run ruff check .` / `ruff format --check .` | 通过；118 个文件已格式化 |
| `uv run --group docs mkdocs build --strict` | 通过 |
| `npx vitest run src/guards.test.ts` | 134 项 |
| `npx vitest run src/visualGate.test.ts` | 89 项 |
| `uv run pytest tests/test_check_script.py` | 41 项（含 `web-visual` 新增 6 项） |
| `npm run test:visual` | 五张 Linux/SwiftShader 基线已提交；**本机无法运行**（配置在非 Linux 抛错），当前工作树仍须由同一 SHA 的 `web-visual` CI job 验证 |

### PR-8 待办

- 相位节点遮罩之外的节面 representation（当前只有低振幅遮罩，没有节面几何）；
- 五张已提交基线仍只覆盖 Linux/Chromium/SwiftShader；需要在同一 SHA 上重复运行并补真实 GPU / 浏览器矩阵，才能把软件光栅结果推广到更宽的平台声明；
- `web/e2e/slice.spec.ts` 的正向比较使用 `threshold: 0.02` 与 `maxDiffPixelRatio: 0.001`，半周期、转置和 2% 平面尺寸错误的负对照分别用更宽松的 `0.05` / `0.1` / `0.1` 仍必须失败；预算仍需由 CI 重复运行的数据持续校准，不能通过更新快照掩盖漂移。

### 对抗审计收口：2026-08-28

- 时间轴步长从 `0.6` 修正为 `0.2`，使测试与视觉基线使用的 $t=8.4$ 成为原生 `<input type="range">` 网格上的合法值；单元测试和浏览器用例都断言 `stepMismatch === false`，不再靠测试时注入 `step="any"` 绕过生产约束。
- 点云和等值面的相位调色板明确以 sRGB 定义，送入 GPU 前统一解码到 Linear-sRGB；等值面改为未照明材质且不接收/投射阴影，两种表示都关闭 fog、tone mapping，并绕过全帧 Bloom/Vignette。点云 shader 移除 fog / tone-mapping chunks，保留输出色彩空间转换。相位图例 CSS 的六段色轮与两个端点色由测试逐字节对照 `phaseToRgb`，不再使用近似品牌色。
- Scene Contract 在模型边界拒绝 frame 向量、extent 与 spacing 中的 NaN / $\pm\infty$；文档与脚本同步按锁定版 Starlette 的 `allow_nan=False` 描述线路行为。
- 视觉门禁收紧正向像素阈值并加入阈值关系守卫，又用 2% 平面尺寸变异覆盖 `includeAA=false` 下的轮廓/几何检出；报告审计现在钉住 8 个必需测试标题，TypeScript AST 审计钉住 10 条截图与 3 条 WebGL 断言，删掉负控不能再靠同文件里的其他绿测试蒙混。本树已在与 CI 锁定版本一致的 Linux/Chromium/SwiftShader 容器中用 committed baselines 真比较通过 8/8，且 `updateSnapshots = none`。

### 全面复审收口：2026-08-29

- **物理与数值**：量子数、$Z$、$a_\mu$ 和质量参数在模型入口（包括解析零流早退）拒绝布尔值、非整数及非有限值；径向节点改由 Laguerre 根精确给出。含径向节点的单一 s 态等值面以解析拓扑为 oracle；含任意非零激发 s 分量的多项态不按系数容差降格，而要求 129/137 最细两级的逐分量 Euler 特征、density level 与质量稳定，失败就拒绝。点云径向与角向 CDF 都以嵌套网格收敛判定；QVPC float32 同时检查上溢、长度尺度下溢及 cast 后非零样本塌缩。概率流每条线固定自己的速度参照，向量长度使用抗上/下溢 `hypot` 归约，速度以 12 位有效数字序列化，$10^{-12}$ 弱相干及 $Z=a_\mu=10^{-160}$ 的可表示流仍保持非零。
- **契约与架构**：网格索引、法向、流线点/速度、metadata 互易尺度和 term identity 都在 Pydantic 边界做形状、有限性与语义校验。叠加态 `terms` 使用严格语法，限制编码长度、最多 8 个 active terms；等值面把网格构建、可能的重建、实际参与判决的最细两个自适应拓扑网格及最终质量诊断逐次计入 term-voxel 预算，且 estimator 与真实 builder 的逐 term 完整网格求值记录直接互校；典型 129/137 门禁允许两项态进入 builder，三项及以上仍在 16M 上限前 fail-closed。概率流按 RK4 五阶段和序列化点数执行双预算。本征态和叠加态 slice 只在私有 builder 保留一层 LRU，public builder deep copy，HTTP route 不重复缓存大数组。只有 `ValueError`、`ScientificComputationError`、`FloatingPointError` 与 `OverflowError` 这组可归因于请求的科学失败统一为有原因的 422；`RecursionError` 等意外运行时错误仍为 500。前端请求规划集中在一个选择器，模式/表示法切换原子化，4s–8s 切片楼层与 Python builder 机械互校，叠加态物理周期按 $a_\mu/Z^2$ 缩放。真实浏览器逐项选择 4s–8s 时滑条分别落在 97/141/193/251/319，五个首次 slice 请求均为 200；非简并叠加态显示物理周期 `16.7552 a.u.`，播放时间保持在 0.2 a.u. 网格。
- **概率流可发现性**：默认实基定态下的“概率流线”是可聚焦、可点击的解释动作，而不是伪装成按钮的禁用控件；点击会保留原态并显示 $j=0$ 的原因。独立动作从服务端 catalog 载入 `3d, m=2, complex` 并切到流线。真实浏览器验收观察到 `/api/orbitals/current-field` 返回 200、48 条流线、`max |j|/rho = 1.551` a.u.、连续性 residual $6.00\times10^{-13}$，画布和 Scene Contract 同时到达。解析零流的 `2p(+1)+2p(-1)` 同样经 current-field 200 返回 0 lines，图例明确解释空视图而不显示伪 `0…0` 色带；简并播放不执行，但 `aria-disabled` 控件仍可用键盘聚焦并引用页面内持续可见的物理说明。该轮对默认态与解析零流态的控制台验收无 error；后续审计另在 `1s+3d_z²@40` 发现确定性 422，已由下述逐态 catalog seed 上限修复。仍有一条来自上游 React Three Fiber 使用已弃用 `THREE.Clock` 的 warning。
- **真实全栈浏览器门禁**：独立于 fixture-backed 像素套件，`npm run test:fullstack` 先构建 `web/dist`，再以文档化 CLI `quviz serve` 从仓库根启动 FastAPI。Chromium 在同一 origin 上完成默认点云、2p_z 等值面、概率密度切片、catalog 的 3d complex 概率流示例、3d 等值面和默认叠加态；六次科学请求逐项精确核对 query，任何漏掉 `a_mu`、plane、observable、basis、terms 或 workload 参数的客户端变异都会失败，而不是由服务端默认值掩盖。QVPC/1、28,000 pts、48 lines、图例、叠加态能量、settled identity 及零 API/page/console error 同时受检。OpenAPI 链接改为同源 `/docs`，并真实读取 Swagger HTML 与 `/openapi.json`；Vite 开发服务器把 `/docs`、`/openapi.json`、`/redoc` 与 `/api` 一起代理到 8000，生产与开发两种入口都不会再指向访问者机器或落回 SPA。Playwright JSON 后审计把固定 spec、标题、rootDir/testDir、唯一 project/result、零 skip/flaky/额外测试钉成闭合集合，其 23 个正/负控进入普通 vitest；CI 用独立 `web-fullstack` job 执行并上传失败 trace。边界是它仍从源码 checkout 找 `web/dist`，没有证明 wheel 已打包静态资产。
- **仍未实现或未普适证明**：一般叠加态点云采样（M5）、显式节面几何、不含激发 s 分量的一般叠加态拓扑证明、数值 TISE/TDSE（M2+）、完整点群/SALC 与多电子/分子能力仍属路线图；视觉结论只对本次锁定版 Linux/Chromium/SwiftShader 真比较与 Windows Chromium 响应式矩阵负责，尚无真实 GPU/多浏览器矩阵；主 bundle 仍待拆分，上述上游 `THREE.Clock` 弃用 warning 也待依赖栈迁移后消除。

### 第二轮对抗审计收口：2026-08-29

- **第三方科学异常边界**：只在 `skimage.measure.marching_cubes` 调用点把其精确 `RuntimeError` 包装成 `ScientificComputationError`；合法的 `1s, Z=1e-20` 等值面塌缩现以含 “No surface found” 的 422 返回，`RecursionError` 子类仍保留为 500。径向归一化、径向节点和 density floor 保留普通输入的原算术，仅在直接结果接近 float64 边界或已经溢出/下溢时以 100 位十进制复算；最大有限值和最小次正规数四个反例均按精确二进制输入正确舍入。径向自变量同样能在 `Z=a_mu=1e308` 时先安全约去共同尺度，返回解析值而非静默零；NumPy 标量不会在兜底中泄漏 `TypeError`。普通切片 golden 未变化。
- **工作量与测试耦合**：含激发 s 分量的多项态只构建并计费真正参与判决的最细两级网格与最终诊断网格；典型两项态成本为 14,578,790 term-voxel，小于 16M 上限，三项态为 21,868,185 并在 builder 前拒绝。测试同时记录 `physics.superposition` 与 `physics.finite_box` 两个真实波函数别名的完整三维求值，逐项对照 estimator，恢复未读取的粗网格或令估算漂移都会变红。
- **叠加目录能力与前端契约**：`/api/superposition/catalog` 发布由实际 slice builder 共用函数计算的 `slice_resolution_floor`，并发布由 current-field estimator 与两道 route guard 推导的 `streamline_seed_count_max`；`1s + 3d_z²` 分别为 103 与 24，切片 101 拒绝/103 接受，流线 24 通过而 25 因 102,400 path samples 在 builder 前拒绝。两字段经生成 OpenAPI 类型、严格 parser、store、能力矩阵、ControlPanel 和首个 request planner 全链路采用；store 启动时不预置 route 的 40，只有选中 catalog 条目成功到达才注入 ceiling，拉取/解析失败或目录缺少当前条目都会原子撤销流线能力并降级表示法。切换预设与迟到 catalog 同步同样原子收紧当前参数，缺失或损坏 seed metadata 不再猜测回落值，而是 fail-closed 为不可请求。Z 边界已进入七条 route 的 OpenAPI 机械互校；3s/4s 等值面在 UI 静态标明全部公开网格均不可服务。播放周期测试推进到首个能区分物理周期与旧 39.6 常数的第 5 帧；简并播放保留可聚焦的 `aria-disabled` 控件，并由 `aria-describedby` 指向持续可见的物理说明。
- **变异盲区**：payload 的 face 上下界、顶点/法向/phase 长度、seed 数、speed 行列和 max-speed 双侧全部直接钉扎；phase-mask 两个互斥分支、Euler 分量多重集、probe-score 平局索引以及径向表 131,073 精确上界均有删除或边界变异负控制。

本树最终实测（2026-08-30，Windows 11、CPython 3.12.10、同一工作树）：

| 门禁 | 结果 |
|---|---|
| `pwsh -NoProfile -File scripts/check.ps1` | 全部通过 |
| Python 全量 | 1345 passed，0 skipped；总覆盖率 92.19%（门槛 85%） |
| 前端全量 | 34 个 spec、1010 passed，0 skipped、0 todo；语句 99.58%、分支 98.37%、函数 99.57%、行 99.58%，30 个模块逐文件达标 |
| 静态与文档 | ruff 123 文件、mypy strict 34 文件、MkDocs strict、OpenAPI/schema/视觉 fixture 门全部通过 |
| 生产构建 | JS 1,261.33 kB（gzip 347.25 kB），CSS 42.50 kB（gzip 8.52 kB）；保留既有 chunk > 500 kB 警告 |
| 真实浏览器 | 源码 checkout 的联合旅程 1/1 通过：生产挂载下默认点云、2p_z 等值面与切片、3d complex 的 48 条概率流线、3d 等值面及默认叠加态均由真实 API 返回 2xx；同一 Chromium 还验证 MkDocs 直达与 instant navigation 后的 MathJax、Mermaid SVG、Python API 模块和引用锚点，完整 query 与语义受检，控制台 0 error；Linux/SwiftShader 像素门另为 8/8 |

本机仍因 Windows 权限不能实际创建文件 symlink，相关 `check.ps1` 端到端路径只由 POSIX/CI 覆盖；截图门已另在锁定版 Linux/Chromium/SwiftShader 容器中以 committed baselines 真比较通过 8/8，并包含转置、2% 几何误差与半周期负控。测试输出中的 `THREE.Clock` 弃用提示、Three.js 多实例提示与 MkDocs Material 2.0 横幅是已知上游警告，不改变本轮门禁结论。

后续科学能力顺序见[开发路线图](roadmap.md)。
