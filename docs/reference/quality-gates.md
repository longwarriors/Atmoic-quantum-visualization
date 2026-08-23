# 质量门禁

!!! note "门禁定义"

    Unix 使用 `make check`，Windows PowerShell 使用 `& .\scripts\check.ps1`。只有所有适用门禁在同一提交上通过，才能称为“全绿”；最新结果见[当前状态](../project/status.md)。

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

- ✅ TypeScript 严格模式 — `npm run build`（`tsc -b`）；测试代码由 `tsconfig.test.json` 单独类型检查；
- ✅ binary parser 单测 — `web/src/api/client.test.ts`，含**跨语言黄金向量**（见下）；
- ✅ 相位色轮周期连续 — `web/src/scene/color.test.ts`；
- 🕒 geometry/material 正确 dispose；
- 🕒 截图视觉回归仅作为辅助；
- 🧑 UI 不能隐藏关键警告和单位。

!!! info "QVPC/1 的跨语言黄金向量"

    `tests/fixtures/qvpc_golden.bin` 是同一份字节流的**双向契约**：Python 侧断言编码器逐字节复现它，TypeScript 侧断言解析器能解出 `qvpc_golden.json` 里的值。

    单方面修改 wire format 会同时打破两侧——已验证：把 `POINT_CLOUD_STRIDE` 从 5 改成 6，Python 立刻 2 个测试变红；即使有人重新生成黄金字节把 Python 弄绿，TypeScript 仍有 5 个测试变红。

## 文档与引用

- `mkdocs build --strict`；
- 所有 `[\@key]` 存在；
- 生成索引与 `references.bib` 同步；
- Markdown 不含换页符等意外 C0 控制字符；
- Mermaid、数学公式和 API 文档在生成 HTML 中真正渲染，而非只通过构建；
- 已知纠错不可被旧教程重新引入；
- “已实现”“已验证”“计划中”三个状态不得混写。
