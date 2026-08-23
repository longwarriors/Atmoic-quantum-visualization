# 当前状态

!!! success "Phase 0 可演示基线"

    2026-08-23，M0R 的科学几何、Scene Contract、前端显示和工程门禁阻断项已经修复。QuViz 仍是 Alpha：这里的“可演示”不代表通用 TISE/TDSE、完整量子化学或多电子能力已经实现。

## 能力账本

| 能力 | 实现与验证 | 当前边界 |
|---|---|---|
| 氢与类氢解析波函数 | [质量门禁](../reference/quality-gates.md)“解析态”九项全部 ✅：归一化、正交性、通式节点数、$H\psi-E\psi$、$L^2$/$L_z$、$\langle r\rangle$/$\langle1/r\rangle$、约化质量、角度范围、Condon–Shortley | 解析 Coulomb 单电子态 |
| 概率密度、相位与定态概率流 | 概率流对照 $\operatorname{Im}(\psi^*\nabla\psi)$、定态连续性残差与 $\pm m$ 反向性测试通过 | 概率流尚无 API/前端 representation |
| 分离逆 CDF 点采样 | 径向/极角/方位角 KS 检验、三维矩、seed 重现测试通过；marker 统一权重 | 单一可分离氢样态，不是一般线性组合 sampler |
| 固定目标质量等值面 | 径向 CDF 计算域、奇数网格、Simpson 质量、节点连通性、按面计数的绕向一致率和法向朝外测试通过 | API 保守限制为 $n\le4$；拓扑回归覆盖 1s、2p、3p 与复 2p，并未穷举全部轨道 |
| $sp^3$ 系数与四面体方向 | 正交性与方向测试通过 | 尚不是完整点群/SALC 系统，未接入 UI |
| 1D 网格契约 | 坐标、间距和边界测试通过 | 还没有 TISE/TDSE 求解器 |
| HTTP API 与 QVPC/1 | API、二进制与 OpenAPI schema 测试通过 | 点云 binary 与 metadata 使用同参数 sidecar 请求 |
| React/Three.js 场景 | 生产构建通过；2pz、3dz² 浏览器视觉复核通过 | 视觉回归仍是人工检查，主 bundle 尚待拆分 |
| 引用与 MkDocs | 引用键、生成索引、控制字符与 strict build 受门禁保护 | 外部网页的可访问状态仍可能变化 |

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

## M0R 实现验证：2026-08-23

Windows 上执行 `& .\scripts\check.ps1`；它与 Unix `make check` 包含相同门禁：

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

## 剩余限制

1. 为前端增加可提交到 CI 的 parser、交互与截图回归，而不只依赖人工浏览器 QA；
2. 拆分 Three.js/后处理 bundle，并测量帧时、显存与大资产传输；
3. 将等值面验证扩展到更高 $n$ 前，先设计随节点数增长的收敛策略；
4. 实现概率流、切片和节点面 representation 后再进入解析含时叠加；
5. 清理 FastAPI/TestClient 与 scikit-image 上游弃用警告。

后续科学能力顺序见[开发路线图](roadmap.md)。
