# 质量门禁

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
- 已知纠错不可被旧教程重新引入。
