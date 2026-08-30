# 开发工作流

## 常用命令

```bash
uv run pytest --cov=quviz
uv run ruff check .
uv run ruff format .
uv run mypy
uv run --group docs python scripts/render_reference_index.py
uv run --group docs mkdocs serve
cd web && npm run build
```

也可以使用：

```bash
make check
```

前端测试可单独运行：

```bash
cd web && npm run test
```

真实后端与生产前端挂载的浏览器 smoke 另行运行：

```bash
uv sync --locked --all-groups
cd web
npm ci --no-audit --no-fund
npx --no-install playwright install chromium
npm run test:fullstack
```

该命令生产构建 `web/dist`，从仓库根启动 `quviz serve` 于专用端口 8765，再以 Chromium
依次访问真实点云、等值面、切片、概率流和叠加态 API；它不使用视觉测试的 fixture。
服务器以 `--no-sync` 启动，所以前两步是新 checkout 与陈旧环境的显式前置条件，不会在测试中
临时解析或改写依赖。
Playwright 成功退出后，`assert-fullstack-run.mjs` 还会审计 JSON 报告，要求固定 spec 与标题
恰好运行一次且通过；0 tests、全 skip、重复/额外执行、重试掩盖或错误 testDir 都会失败。
这条门禁由 CI 的 `web-fullstack` job 执行，不在 `make check` / `check.ps1` 内。它验证源码
checkout 的生产挂载路径；当前 wheel 是否携带静态前端仍是独立的发布验证项。

`npm run test` 不只是 vitest，而是一条以 `&&` 串起、逐段被 `tests/test_check_script.py`
按精确元组钉住的链（少一段、多一段、换顺序都会变红）：

1. `node scripts/clean-coverage.mjs` — 删掉上一轮的三份报告，杜绝以旧报告顶账；
2. `tsc -p tsconfig.test.json --noEmit` — 用测试用的 tsconfig 类型检查；
3. `vitest run --coverage`，并写出 JSON 运行结果；
4. `node scripts/assert-no-skips.mjs` — 按运行结果核对零 skip / 零 todo、无缺席 spec；
5. `node scripts/assert-coverage-scope.mjs` — 核对本次运行**解析后**的覆盖率配置，以及本次运行
   **写出的报告**所列的文件集与各模块重算出的覆盖率。

第 5 步读的是报告，不是插桩过程本身；它能挡住配置层面的削弱，挡不住写代码去伪造报告——界线写在
`web/scripts/assert-coverage-scope.mjs` 顶部与[项目状态](../project/status.md)的《门禁的防护边界》。

Windows PowerShell：

```powershell
& .\scripts\check.ps1
```

## 提交前门禁

`scripts/check.ps1` 按顺序跑完下面八道门禁，任何一道非零退出即整体失败：

1. `uv run ruff check .`；
2. `uv run ruff format --check .`；
3. `uv run mypy`；
4. `uv run --group docs pytest --cov=quviz --cov-report=term-missing`（科学不变量、采样统计、引用与门禁自身的测试都在其中；`tests/conftest.py` 把任何 skip 记为会话失败）；
5. `uv run --group docs python scripts/render_reference_index.py --check`（引用键与索引同步）；
6. `uv run --group docs mkdocs build --strict`；
7. `web/` 下 `npm run test`（上面那五段链）；
8. `web/` 下 `npm run build`（Vite 生产构建）。

判定以**整条命令的退出码**为准：`exit 0` 才算通过。屏幕上那行 `All checks passed!` 是 **ruff**
自己打印的，不是 check.ps1 的结论——看到它并不代表后面七道门禁跑过了。

八道门禁一律在**这个脚本自己所在的那份 checkout** 里运行，而不是调用者的当前目录：脚本解析
`$PSCommandPath`（文件本身，不只是它所在的目录）、跟随文件符号链接与目录 junction 到真实位置，
拒绝以硬链接方式调用（硬链接没有可跟随的目标；注意只要存在任一硬链接，仓库自己的
`scripts/check.ps1` 也会一并拒绝运行，这是刻意的失效安全方向），再用
`git rev-parse --show-toplevel --show-prefix` 确认解析出的目录确实是某个工作区的 `scripts/`，
并要求该根目录的 `pyproject.toml` 声明 `name = "QuViz"`。这些检查合起来取代了原先"存在 `.git` 和
`pyproject.toml` 两个文件"的判据——两个**空文件**就能满足它。

## 添加依赖

运行时依赖：

```bash
uv add package-name
```

开发依赖：

```bash
uv add --group dev package-name
```

文档依赖：

```bash
uv add --group docs package-name
```
