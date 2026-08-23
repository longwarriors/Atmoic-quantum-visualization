# HTTP API

FastAPI 自动生成 OpenAPI 文档 [@fastapi]。

## `GET /api/health`

返回版本和服务状态。

## `GET /api/orbitals/catalog`

返回常用状态预设。

## `GET /api/orbitals/metadata`

参数：`n,l,m,z,basis`。

返回 Scene metadata，不生成大数组。

## `GET /api/orbitals/point-cloud`

参数：

- `n,l,m,z,basis`；
- `samples`：1000–120000；
- `seed`。

返回 `application/vnd.quviz.point-cloud`，格式为 `QVPC/1`。响应头包含：

- `X-QuViz-Radial-Mass`；
- `X-QuViz-Extent-Bohr`；
- `X-QuViz-Format`。

## `GET /api/orbitals/isosurface`

参数：

- `resolution`：49–81，必须为奇数；最低值随 $n$ 增长为 $\max(49,16n+17)$；
- `probability_mass`：0.50–0.99。

当前等值面 API 保守限制为 $n\le4$，但这不表示已经穷举验证该范围的全部轨道。返回 typed OpenAPI schema，包括 indexed mesh、法向、逐顶点相位、阈值、superlevel-set 质量、有限网格 $\int\rho dV$、网格间距和 Scene metadata。当前使用 JSON，生产规模可升级为 GLB 或自定义 mesh binary。
