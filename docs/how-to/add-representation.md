# 添加表示方法

新增 representation 前先写一句完整语义：

> “这是 observable X 在规则 Y 下转化得到的 representation Z。”

例如：

> “这是概率密度 $|\psi|^2$ 的 90% superlevel-set 等值面，并以波函数相位着色。”

## Python 端

- 生成几何或标量场；
- 记录阈值、质量、分辨率与误差；
- 返回 Scene Contract；
- 不决定页面布局。

## TypeScript 端

- 为新资产定义类型；
- 将数组映射到 `BufferGeometry` attribute；
- 材质只消费明确命名的 attribute；
- 控件变化若改变物理资产，必须重新请求后端；
- 释放旧 geometry/material，避免 GPU 内存泄漏。

## 已实现的两个范例

- `probability_density` + `isosurface`：`build_isosurface` 返回目标包围质量、阈值与网格参数；
- `probability_current` + `streamlines`：`build_current_field` 返回弧长等距折线、逐顶点速度与实测连续性残差。

后者说明了本页第一句的要求：切换到概率流**不是换材质**，而是换 observable，所以前端必须重新请求 `/api/orbitals/current-field`。它也说明了“不存在”与“出错”的区别——实轨道的概率流恒为零，返回空 payload 加 warning，而不是 4xx。

## 验证

- 几何顶点有限；
- 法向归一；
- face index 不越界；
- 表面阈值与 metadata 一致；
- 视觉回归图不能替代物理测试。
