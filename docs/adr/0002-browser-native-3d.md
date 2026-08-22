# ADR-0002：采用浏览器原生 3D

- 状态：Accepted
- 日期：2026-08-22

## 决策

主交互界面使用 React、TypeScript、React Three Fiber 和 Three.js，不以 Matplotlib、Plotly、Streamlit 或 Jupyter widget 作为最终产品层。

## 原因

- 自定义 GPU shader；
- 高性能点云与网格；
- 响应式 UI 与复杂状态；
- 容易发布和分享；
- 为 WebGPU 留出升级路径。

## 例外

Matplotlib/Jupyter 仍用于数值诊断和论文图，不承担主 3D 产品界面。
