# 安装

## 前置条件

- Python 3.12 或 3.13；
- `uv`；
- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` 与 npm；仓库根的 `.node-version` 和 `.nvmrc` 为本地版本管理器固定 22.22.2，CI workflow 也显式使用同一版本，`web/.npmrc` 会拒绝不满足范围的运行时；
- 支持 WebGL 2 的现代浏览器。

仓库已经提交 `uv.lock` 与 `web/package-lock.json`。常规安装必须消费这两份锁文件，而不是在本地重新解析一棵依赖树；只有有意更新依赖时才修改并审查锁文件 [@uv-docs]。

## Python 环境

```bash
uv sync --locked --all-groups
```

`--locked` 会在 `pyproject.toml` 与 `uv.lock` 不一致或锁文件缺失时失败，不会静默重写锁文件。

只安装科学内核和 API 的运行时依赖时：

```bash
uv sync --locked --no-default-groups
```

这里不能省略 `--no-default-groups`：本项目在 `pyproject.toml` 中把 `dev` 声明为 uv
默认依赖组，裸 `uv sync --locked` 仍会安装测试、类型检查和 lint 工具。

只安装运行时与文档依赖（不安装默认的开发组）时：

```bash
uv sync --locked --no-default-groups --group docs
```

## 前端环境

```bash
npm --prefix web ci --no-audit --no-fund
```

`npm ci` 要求已提交的 `web/package-lock.json` 与 `package.json` 一致，并按锁文件重建依赖目录。需要升级依赖时，应显式运行相应的 `uv lock` / npm 更新命令并把锁文件 diff 与声明文件一起审查；不要把普通安装写成“首次生成锁文件”的 bootstrap 流程。

如果 npm 报 `EBADENGINE`，请切换到前置条件列出的 Node 版本后重新安装；不要忽略警告
继续使用一棵未受支持的依赖树。

## 单服务源码预览

所有命令都从仓库根目录执行：

```bash
npm --prefix web run build
uv run --locked --no-sync quviz serve
```

访问 `http://127.0.0.1:8000/`。构建产物位于 `web/dist`，FastAPI 会在同一进程中托管
单页应用和 `/api`，这是验证完整源码 checkout 最直接的路径。

- `http://127.0.0.1:8000/docs` 是从 OpenAPI schema 生成的 Swagger UI；
- `http://127.0.0.1:8000/openapi.json` 是原始 OpenAPI JSON，供代码生成和自动化工具读取；
- `http://127.0.0.1:8000/api/health` 是健康检查。

!!! warning "源码、source archive 与 wheel 的边界"

    `web/dist` 是本地构建产物，不进入 Git source archive，也尚未打包进 Python wheel。
    从 Phase 0 checkpoint 的源码归档解包后，仍要先执行 `npm --prefix web ci` 和
    `npm --prefix web run build`，单服务根页面才是浏览器 UI。只安装 wheel 时，
    `quviz serve` 当前只承诺科学 API；根路径会返回带 `/docs` 提示的 JSON。
    `check.ps1` 还会校验真实 Git checkout 身份，因此不能用 source archive 代替 checkout
    来执行该仓库级认证脚本；归档用户可以按本页逐项运行对应工具。

## 启动开发模式

前端与后端需要各自热更新时，两个终端都保持在仓库根目录。终端一：

```bash
uv run --locked --no-sync quviz serve --reload
```

终端二：

```bash
npm --prefix web run dev
```

访问：

- 前端：`http://127.0.0.1:5173`
- Swagger UI：`http://127.0.0.1:8000/docs`
- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`
- 健康检查：`http://127.0.0.1:8000/api/health`

Vite 会把 `/api` 代理到端口 8000。端口 5173 才是带热更新的前端；端口 8000 的根页面
只会提供上一次构建的 `web/dist`（如果存在）。

## 启动教程与参考手册

```bash
uv run --locked --no-sync python scripts/render_reference_index.py --check
uv run --locked --no-sync python scripts/render_openapi_reference.py --check
uv run --locked --no-sync mkdocs serve -a 127.0.0.1:8001
```

访问 `http://127.0.0.1:8001/`。两个 `--check` 分别验证参考文献索引与
`references.bib`、HTTP schema 页与 FastAPI live OpenAPI 一致；`--no-sync` 保留前面显式选择的
依赖组，`--locked` 则在锁文件过期时直接失败，因此这组启动命令不会修改仓库文件。如果检查失败，说明维护者需要在审查真值源变更后显式重新生成并提交页面，
不能跳过检查直接发布。

!!! note "Windows"
    PowerShell 与 Git Bash 均可运行上述命令。不要手工激活 `.venv` 后再用 `pip install` 修改环境；依赖变化应通过 `uv add` 或 `pyproject.toml` 管理。
