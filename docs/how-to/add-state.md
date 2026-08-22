# 添加量子态

新增态时，不要直接从 API 路由开始。按以下顺序：

1. 在 `src/quviz/physics/` 定义状态计算；
2. 为其定义可计算的 observable；
3. 明确单位、坐标、归一化和 basis；
4. 在 `scene/models.py` 中扩展 state spec；
5. 编写科学不变量测试；
6. 最后添加 API 与前端控制项。

## 最小接口

```python
class QuantumState(Protocol):
    def evaluate(self, coordinates: Coordinates) -> np.ndarray: ...
    def metadata(self) -> StateMetadata: ...
```

状态层不返回颜色、透明度、相机或 mesh。那些属于 representation/renderer。

## 必需测试

- 归一化；
- 与已知解的重叠；
- Hamiltonian residual；
- 对称性；
- 网格或基组收敛；
- 参数域和错误输入。
