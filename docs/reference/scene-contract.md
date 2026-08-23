# Scene Contract

## 目的

Scene Contract 是 Python 科学层与前端渲染层之间的边界。它回答：

- 状态是什么；
- 所画物理量是什么；
- 几何如何构造；
- 使用什么单位、约定和归一化；
- 有哪些截断和警告；
- 证据来自哪里。

## 元数据示例

```json
{
  "state": {"n": 3, "l": 2, "m": 2, "z": 1.0, "basis": "complex"},
  "label": "3d, m=2",
  "energy_hartree": -0.0555555556,
  "length_unit": "bohr",
  "observable": "probability_density",
  "representation": "isosurface",
  "normalization": "integral(|psi|^2 dV)=1",
  "coordinate_convention": "theta=polar[0,pi], phi=azimuth[0,2pi)",
  "geometry_semantics": "level set of probability density |psi|^2",
  "color_semantics": "principal wavefunction phase in [-pi, pi]",
  "references": ["dlmf-spherical-harmonics", "scipy-sph-harm-y"],
  "warnings": ["surface geometry represents density; color carries phase"]
}
```

## 点云二进制格式 `QVPC/1`

Little-endian：

| Offset | 类型 | 含义 |
|---:|---|---|
| 0 | 4 bytes | magic `QVPC` |
| 4 | uint16 | version = 1 |
| 6 | uint16 | flags |
| 8 | uint32 | point count |
| 12 | uint32 | stride = 5 |
| 16 | float32[] | interleaved `x,y,z,intensity,phase` |

`intensity` 是向后兼容的渲染辅助字段。当前值恒为 1：位置分布本身已经编码抽样密度，不能再用局部 $|\psi|^2$ 改变点大小、亮度或 alpha。

## 等值面质量字段

- `requested_probability_mass`：用户要求的绝对 superlevel-set 质量；
- `captured_probability_mass`：离散阈值实际包含的 Simpson 加权质量；
- `finite_grid_density_integral`：有限网格上的数值 $\int\rho dV$，可能因求积误差略高于 1；
- `grid_resolution` / `grid_spacing_bohr` / `integration_rule`：复现阈值与质量估计所需的离散化参数。
