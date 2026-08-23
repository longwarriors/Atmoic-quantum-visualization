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

Windows PowerShell：

```powershell
& .\scripts\check.ps1
```

## 提交前门禁

一次完整检查包含：

1. Python 格式和静态检查；
2. 科学不变量测试；
3. 采样统计测试；
4. 引用键与索引同步检查；
5. MkDocs 严格构建；
6. TypeScript 类型检查与 Vite 构建。

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
