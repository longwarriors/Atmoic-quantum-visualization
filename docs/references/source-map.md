# 资料角色映射

| Citation key | 角色 | 可信层级 | 使用规则 |
|---|---|---|---|
| `griffiths2018qm` | 基础量子力学 | 教科书 | 公式与概念依据 |
| `dlmf-*` | 特殊函数定义 | 权威数学参考 | 约定与测试真值 |
| `scipy-*` | 软件 API | 官方文档 | 实现接口依据 |
| `solara-*` | 教学推导与动画 | 已审查二手资料 | 继承叙事，不继承未测公式 |
| `orbitron` | 轨道图鉴 | 视觉参考 | 不用于数值精度证明 |
| `evanescence` | Rust/WASM 工程 | 开源实现 | 对照设计与性能，采样需独立验证 |
| `stodolna2013stark` | 实验 | 同行评审论文 | MeasurementModel 案例 |
| `maksic1986hybridization` | 群论与杂化 | 学术章节 | 化学解释与对称性 |
| `qmsolve` | 通用数值原型 | 开源软件 | 参考，不作为基准 |
| `threejs` / `react-three-fiber` | 前端图形 | 官方文档 | 渲染实现依据 |

## 引用不是背书

QuViz 引用某份资料，表示该资料与论述或审查有关，并不表示整份资料无条件正确。`source-audit` 与 `corrections` 用于记录可继承部分、风险和已确认错误。
