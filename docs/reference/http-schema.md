# HTTP schema (自动生成)

!!! warning "不要手工编辑本页"

    本页由 `scripts/render_openapi_reference.py` 直接读取 FastAPI 的 live OpenAPI schema 生成。
    查询参数、默认值、外层 schema 边界或响应媒体类型变更后, `--check` 会要求同步提交本页。
    参数之间的关系、数值收敛条件与 422 原因见[HTTP API 科学语义](api.md)。

## `GET /api/health`

无查询参数。

成功响应媒体类型: `application/json`。

## `GET /api/orbitals/catalog`

无查询参数。

成功响应媒体类型: `application/json`。

## `GET /api/orbitals/current-field`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `n` | integer | 否 | `3` | min `1`; max `6` |
| `l` | integer | 否 | `2` | min `0`; max `5` |
| `m` | integer | 否 | `2` | min `-5`; max `5` |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `basis` | `complex` / `real` | 否 | `"complex"` | — |
| `seed_count` | integer | 否 | `48` | min `1`; max `96` |
| `arc_step` | number / `null` | 否 | — | > `0.0` |

成功响应媒体类型: `application/json`。

## `GET /api/orbitals/isosurface`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `n` | integer | 否 | `2` | min `1`; max `4` |
| `l` | integer | 否 | `1` | min `0`; max `3` |
| `m` | integer | 否 | `0` | min `-3`; max `3` |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `basis` | `complex` / `real` | 否 | `"real"` | — |
| `resolution` | integer | 否 | `65` | min `49`; max `81` |
| `probability_mass` | number | 否 | `0.9` | min `0.5`; max `0.99` |

成功响应媒体类型: `application/json`。

## `GET /api/orbitals/metadata`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `n` | integer | 否 | `2` | min `1`; max `12` |
| `l` | integer | 否 | `1` | min `0`; max `11` |
| `m` | integer | 否 | `0` | min `-11`; max `11` |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `basis` | `complex` / `real` | 否 | `"real"` | — |

成功响应媒体类型: `application/json`。

## `GET /api/orbitals/point-cloud`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `n` | integer | 否 | `2` | min `1`; max `12` |
| `l` | integer | 否 | `1` | min `0`; max `11` |
| `m` | integer | 否 | `0` | min `-11`; max `11` |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `basis` | `complex` / `real` | 否 | `"real"` | — |
| `samples` | integer | 否 | `20000` | min `1000`; max `120000` |
| `seed` | integer | 否 | `7` | min `0`; max `2147483647` |

成功响应媒体类型: `application/vnd.quviz.point-cloud`。

## `GET /api/orbitals/slice`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `n` | integer | 否 | `2` | min `1`; max `12` |
| `l` | integer | 否 | `1` | min `0`; max `11` |
| `m` | integer | 否 | `0` | min `-11`; max `11` |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `a_mu` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `basis` | `complex` / `real` | 否 | `"real"` | — |
| `plane` | `xy` / `xz` / `yz` | 否 | `"xz"` | — |
| `observable` | `probability_density` / `wavefunction_real` / `wavefunction_imag` / `phase` | 否 | `"probability_density"` | — |
| `resolution` | integer | 否 | `129` | min `65`; max `513` |

成功响应媒体类型: `application/json`。

## `GET /api/superposition/catalog`

无查询参数。

成功响应媒体类型: `application/json`。

## `GET /api/superposition/current-field`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `terms` | string | 否 | `"1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"` | minLength `1`; maxLength `512` |
| `time` | number | 否 | `0.0` | min `-1000.0`; max `1000.0` |
| `basis` | `complex` / `real` | 否 | `"complex"` | — |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `a_mu` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `seed_count` | integer | 否 | `24` | min `1`; max `40` |
| `arc_step` | number / `null` | 否 | — | > `0.0` |

成功响应媒体类型: `application/json`。

## `GET /api/superposition/isosurface`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `terms` | string | 否 | `"1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"` | minLength `1`; maxLength `512` |
| `time` | number | 否 | `0.0` | min `-1000.0`; max `1000.0` |
| `basis` | `complex` / `real` | 否 | `"complex"` | — |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `a_mu` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `resolution` | integer | 否 | `65` | min `49`; max `81` |
| `probability_mass` | number | 否 | `0.9` | min `0.5`; max `0.99` |

成功响应媒体类型: `application/json`。

## `GET /api/superposition/slice`

| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |
|---|---|---:|---|---|
| `terms` | string | 否 | `"1,0,0,0.7071067811865476;2,1,0,0.7071067811865476"` | minLength `1`; maxLength `512` |
| `time` | number | 否 | `0.0` | min `-1000.0`; max `1000.0` |
| `basis` | `complex` / `real` | 否 | `"complex"` | — |
| `z` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `a_mu` | number | 否 | `1.0` | > `0.0`; max `20.0` |
| `plane` | `xy` / `xz` / `yz` | 否 | `"xz"` | — |
| `observable` | `probability_density` / `wavefunction_real` / `wavefunction_imag` / `phase` | 否 | `"probability_density"` | — |
| `resolution` | integer | 否 | `129` | min `65`; max `513` |

成功响应媒体类型: `application/json`。
