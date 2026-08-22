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

- `resolution`：24–72；
- `probability_mass`：0.50–0.99。

返回 indexed mesh、法向和逐顶点相位。当前使用 JSON，生产规模可升级为 GLB 或自定义 mesh binary。
