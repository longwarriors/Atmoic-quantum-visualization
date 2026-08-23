# 声明—证据—测试映射

引用回答“为什么值得相信或检查”，测试回答“QuViz 的这个实现是否满足声明”。二者不能互相替代。

## 解析氢样轨道

| 声明 | 主要来源 | QuViz 验证 | 边界 |
|---|---|---|---|
| $Y_\ell^m$ 与 Laguerre 定义/约定 | [@dlmf-spherical-harmonics, §14.30; @dlmf-laguerre, eq. 18.5.12; @griffiths2018qm, ch. 4 (pp. 131–197)] | 归一化、正交、节点和已知式 | SciPy 参数顺序必须显式映射 |
| 代码 API 的角度、相位和函数签名 | [@scipy-sph-harm-y; @scipy-eval-genlaguerre] | 与低阶解析式交叉比较 | 官方 API 只证明接口，不证明本项目调用正确 |
| 教学推导路线 | [@solara-hydrogen-derivation] | 独立代数与测试 | PDF 正确不代表配套动画源码正确 |
| 轨道外观 | [@orbitron; @minutephysics2021atoms; @science-asylum2020-orbitals] | 节点/对称性测试和人工视觉回归 | 图库与视频不是数值真值 |

## 采样、几何与数值

| 声明 | 主要来源 | QuViz 验证 | 边界 |
|---|---|---|---|
| 单轨道分离采样的概率测度 | [@griffiths2018qm, ch. 4 (pp. 131–197); @numpy-rng] | 径向/角向边际、矩与 seed 重现 | 必须报告有限径向域捕获质量 |
| 点云作为测量样本的教学表达 | [@tully2013pointillist; @evanescence] | 分布检验；不把点排序解释为时间 | Evanescence 的采样包络不直接复制 |
| marching cubes 的数组/几何语义 | [@skimage-marching-cubes; @numpy-meshgrid] | 轴向、体积、法向、绕向与节点测试 | 看起来像轨道不能代替几何测试 |
| 有限差分 stencil 的向量化 | [@mocquin2022-fdm; @numpy-sliding-window] | QuViz 自有 benchmark 与边界测试 | “300 倍”不是可迁移承诺 |
| TISE/TDSE 方法路线 | [@crank1947; @feit1982-spectral] | 尚待 M2：收敛、范数、能量、连续性 | 文献存在不等于求解器已实现 |

## 概率流、实验与化学解释

| 声明 | 主要来源 | QuViz 验证 | 边界 |
|---|---|---|---|
| 概率流与连续性方程 | [@griffiths2018qm] | 解析式、数值梯度和 residual | Wikipedia [@probability-current-wikipedia] 只作术语入口 |
| Stark 态节点可经光电离显微镜映射 | [@stodolna2013stark] | 未来实验前向模型 | 不是自由氢原子三维密度照片 |
| 对称性约束杂化与定向 | [@maksic1986hybridization] | $sp^3$ 正交性和四面体角；未来投影算符测试 | 杂化是基/解释模型，不是独立 observable |
| 点群特征标数据 | [@jacobs-character-tables; @gelessus1995-character-tables; @shirts2007-character-tables] | 群阶、维数平方和、行列正交、类顺序 | 数据站不可当不可变真值 |

## 学习动机与视觉语言

minutephysics、The Science Asylum 和知乎材料可以解释为什么值得计算、作图和区分密度/相位/概率流 [@minutephysics2021atoms; @science-asylum2020-orbitals; @zhihu-molecular-orbital]。它们承担叙事与教学责任，不单独承担公式、数值常数或算法无偏性的证明。

具体材料判定见[用户提供资料审计](source-audit.md)，错误位置和修正见[纠错账本](corrections.md)。
