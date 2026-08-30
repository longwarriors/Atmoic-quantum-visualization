# 第一个轨道

启动 API 和前端后，默认场景是实基中的 $2p_z$：

$$
\psi_{210}(r,\theta,\phi)=R_{21}(r)Y_1^0(\theta,\phi).
$$

左侧控制面板把操作分成三层：

- **态制备**：$n,\ell,m$、实/复球谐，以及解析含时叠加态预设；
- **表示法**：电子云、等密度面、平面切片或概率流线；
- **显示**：点大小、透明度等只改变读图方式的参数。

平面切片可以在 `xy`、`xz`、`yz` 主平面上显示 $|\psi|^2$、
$\operatorname{Re}\psi$、$\operatorname{Im}\psi$ 或 $\arg\psi$。默认实基
$2p_z$ 的概率流严格为零；选择概率流时出现的空结果是物理负控制。使用界面中的
“载入并显示概率流示例”才能切换到非零复基示例。

完整的当前界面旅程、叠加态正/负控制和 422 边界见
[Phase 0 交互工作流](../tutorials/phase-0-walkthrough.md)。

## 用 CLI 导出相同样本

```bash
uv run quviz sample outputs/2pz.npz --n 2 --l 1 --m 0 --basis real --count 20000 --seed 7
```

输出包含：

- `positions`: 物理坐标，单位 bohr；
- `intensity`: QVPC/1 兼容字段；当前固定为 1，使每个抽样标记具有相同视觉权重；
- `phase`: 波函数相位；
- `radial_mass_captured`: 有限径向表覆盖的概率质量。

点云是来自 $|\psi|^2d^3r$ 的重复独立样本，不是一个电子在时间中的运动轨迹。
