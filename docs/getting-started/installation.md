# 安装

## 前置条件

- Python 3.12 或 3.13；
- `uv`；
- Node.js `^22.13.0 || >=24.0.0` 与 npm——即 22.13.0 起的 22.x 或 24.0.0 及以上；Node 20 与 21 会被 `web/package.json` 的 `engines` 拒绝；
- 支持 WebGL 2 的现代浏览器。

仓库已经提交 `uv.lock` 与 `web/package-lock.json`。常规安装必须消费这两份锁文件，而不是在本地重新解析一棵依赖树；只有有意更新依赖时才修改并审查锁文件 [@uv-docs]。

## Python 环境

```bash
uv sync --locked --all-groups
```

`--locked` 会在 `pyproject.toml` 与 `uv.lock` 不一致或锁文件缺失时失败，不会静默重写锁文件。

只运行科学内核和 API 时：

```bash
uv sync --locked
```

包含文档依赖：

```bash
uv sync --locked --group docs
```

## 前端环境

```bash
cd web
npm ci --no-audit --no-fund
cd ..
```

`npm ci` 要求已提交的 `web/package-lock.json` 与 `package.json` 一致，并按锁文件重建依赖目录。需要升级依赖时，应显式运行相应的 `uv lock` / npm 更新命令并把锁文件 diff 与声明文件一起审查；不要把普通安装写成“首次生成锁文件”的 bootstrap 流程。

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
