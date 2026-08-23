# QuViz

**QuViz** 是一个面向量子力学教学、科学计算与浏览器原生三维可视化的早期单仓库原型。

它不把“电子云”“轨道表面”和“波函数”混为同一个对象，而是强制使用下面的计算链：

```text
Quantum state → Observable → Representation → Scene contract → GPU renderer
```

- Python 科学内核负责波函数、概率密度、相位、概率流、采样、网格与验证；
- FastAPI 通过 JSON 和紧凑 Float32 二进制协议输出语义完整的场景资产；
- React + TypeScript + React Three Fiber/Three.js 负责交互、GPU shader、相机和视觉映射；
- MkDocs Material 以教程、原理、操作指南、参考手册和 ADR 组织知识；
- `references.bib` 是引用的唯一机器可读真值源，文档构建会校验每一个引用键。

## 当前状态

Phase 0 目前已有可演示基线：解析氢样轨道、实/复球谐、概率密度、相位、定态概率流和分离逆 CDF 点采样通过测试；三维等值面使用自适应计算域、奇数网格和显式质量积分，API 暂时保守限制为 $n\le4$；FastAPI/QVPC/1 与 React/Three.js 已端到端传递 Scene metadata。它仍是 Alpha，不代表通用 TISE/TDSE 或多电子求解器已经完成。

请先阅读文档中的[当前状态](docs/project/status.md)；愿景或路线图中的能力不代表今天已经实现。

## 项目结构

```text
QuViz/
├── src/quviz/
│   ├── physics/       # 解析态、observable、杂化
│   ├── sampling/      # 独立采样与 CDF 工具
│   ├── solvers/       # 数值网格与后续 TISE/TDSE 扩展点
│   ├── scene/         # Scene Contract、mesh、binary transport
│   ├── api/           # FastAPI
│   └── docs/          # MkDocs 引用扩展
├── web/               # React + TypeScript + Three.js
├── docs/              # 项目、概念、教程、参考与信源审计
├── tests/             # 科学与工程测试
├── references.bib     # 引用单一真值源
├── mkdocs.yml
└── pyproject.toml
```

## 快速开始

### 1. 安装全部 Python 依赖

```bash
uv sync --all-groups
```

### 2. 启动科学 API

```bash
uv run quviz serve --reload
```

API 文档位于 `http://127.0.0.1:8000/docs`。

### 3. 启动前端

另开一个终端：

```bash
cd web
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

### 4. 启动教程与参考手册

```bash
uv run --group docs python scripts/render_reference_index.py
uv run --group docs mkdocs serve -a 127.0.0.1:8001
```

打开 `http://127.0.0.1:8001`。

## 质量检查

```bash
make check
```

Windows PowerShell 使用：

```powershell
& .\scripts\check.ps1
```

两者运行同一组 Python、类型、测试、引用、文档和前端构建门禁。最新实测结果见[当前状态](docs/project/status.md)。

也可分别执行：

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest --cov=quviz --cov-report=term-missing
uv run --group docs python scripts/render_reference_index.py --check
uv run --group docs mkdocs build --strict
cd web && npm run build
```

## 关键科学约定

- 长度默认使用约化玻尔半径单位；
- `theta` 是极角/余纬，范围 `[0, π]`；
- `phi` 是方位角，范围 `[0, 2π)`；
- 复球谐遵循 SciPy `sph_harm_y` 与 Condon–Shortley 相位；
- `|ψ|²` 是相对于物理体积元 `dV` 的密度；
- 球坐标采样的概率测度包含 `r² sin(theta)`；
- 点云是从概率分布取得的重复测量样本，不是电子运动轨迹；
- 等值面是 `|ψ|² = c` 的表示，不是唯一的“轨道边界”；
- 相位由颜色承载，几何由密度承载；
- 概率流线不自动等同于实验电子轨迹。

完整约定、来源等级和已确认纠错见 MkDocs 文档的“信源与审计”部分。

## 项目命名

仓库和产品名使用 **QuViz**；Python distribution name 同样写作 `QuViz`，导入包保持符合 Python 规范的：

```python
import quviz
```

## License

MIT
