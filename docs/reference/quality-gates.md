# 质量门禁

!!! warning "这是验收要求，不是当前通过列表"

    当前 `make check` 仍然失败。实际基线和阻断项见[当前状态](../project/status.md)。只有所有适用门禁在同一提交上通过，才能称为“全绿”。

## 解析态

- $\int|\psi|^2dV=1$；
- 正交性；
- 节点数；
- $H\psi-E\psi$ 残差；
- $\langle L^2\rangle$ 与 $\langle L_z\rangle$；
- 已知 $\langle r\rangle$、$\langle1/r\rangle$。

## 数值求解

- 网格坐标、`dx`、积分权重和边界条件来自同一 Grid 对象；
- 报告盒长和网格收敛；
- Coulomb 原点不能用任意深势阱硬截断；
- 简并子空间不能只按“第几个本征向量”命名；
- TDSE 检查范数、能量和连续性残差。

## 采样

- 径向/角向边际检验；
- 三维矩；
- 截断概率显式报告；
- 拒绝采样包络必须是严格上界；
- MCMC 报告 ESS 和 nodal-pocket mixing。

## 前端

- TypeScript 严格模式；
- binary parser 单测；
- geometry/material 正确 dispose；
- 相位色轮周期连续；
- 截图视觉回归仅作为辅助；
- UI 不能隐藏关键警告和单位。

## 文档与引用

- `mkdocs build --strict`；
- 所有 `[\@key]` 存在；
- 生成索引与 `references.bib` 同步；
- Markdown 不含换页符等意外 C0 控制字符；
- Mermaid、数学公式和 API 文档在生成 HTML 中真正渲染，而非只通过构建；
- 已知纠错不可被旧教程重新引入；
- “已实现”“已验证”“计划中”三个状态不得混写。
