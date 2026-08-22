# 安装

## 前置条件

- Python 3.12 或 3.13；
- `uv`；
- Node.js 20+ 与 npm；
- 支持 WebGL 2 的现代浏览器。

`uv` 会根据 `pyproject.toml` 创建项目内 `.venv`。首次联网执行 `uv sync` 会生成 `uv.lock`；应将该锁文件提交到版本库，使后续安装可复现 [@uv-docs]。

## Python 环境

```bash
uv sync --all-groups
```

首次同步后确认并提交锁文件：

```bash
git add uv.lock
```

只运行科学内核和 API 时：

```bash
uv sync
```

包含文档依赖：

```bash
uv sync --group docs
```

## 前端环境

```bash
cd web
npm install
cd ..
```

首次安装会生成 `web/package-lock.json`，同样应提交到版本库。

## 启动开发模式

终端一：

```bash
uv run quviz serve --reload
```

终端二：

```bash
cd web
npm run dev
```

访问：

- 前端：`http://127.0.0.1:5173`
- OpenAPI：`http://127.0.0.1:8000/docs`
- 健康检查：`http://127.0.0.1:8000/api/health`

## 构建生产前端

```bash
cd web
npm run build
cd ..
uv run quviz serve
```

存在 `web/dist` 时，FastAPI 会直接托管编译后的单页应用。

!!! note "Windows"
    PowerShell 与 Git Bash 均可运行上述命令。不要手工激活 `.venv` 后再用 `pip install` 修改环境；依赖变化应通过 `uv add` 或 `pyproject.toml` 管理。
