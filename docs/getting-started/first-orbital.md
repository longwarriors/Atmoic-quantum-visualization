# 第一个轨道

启动 API 和前端后，默认场景是实基中的 $2p_z$：

$$
\psi_{210}(r,\theta,\phi)=R_{21}(r)Y_1^0(\theta,\phi).
$$

左侧控制面板可以切换：

- $n,\ell,m$；
- 实球谐或复球谐；
- 电子云点云或概率密度等值面；
- 样本量、点大小、透明度；
- 等值面包围概率。

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
