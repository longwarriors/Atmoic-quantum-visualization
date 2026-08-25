# 用户提供资料审计

初始审计日期：2026-08-22；FloatHeadPhysics 视频补充审计：2026-08-25。网页使用 Chrome 实际打开；论文元数据以 DOI 注册信息和出版社页面为准；GitHub 资料同时检查了正文或源码。这里的“可用”表示适合指定角色，不表示整份资料无条件正确。

## 总表

| 资料 | 等级 | 判定 | 在 QuViz 中的角色 |
|---|---:|---|---|
| 氢样轨道推导 PDF | C（教学） | 主推导可靠；附录 3p/4d 公式正确；记号需映射到 DLMF/SciPy | 推导路线与教学叙事 |
| 百度盘副本 | 镜像 | 只解决访问，不是独立证据 | GitHub 不可达时的获取备份 |
| The Orbitron | C（图库） | 有价值但站点自述仍有漏图、误名、错标签且无 hybrid/MO | 视觉灵感与人工回归，不作数值真值 |
| Evanescence | B（源码）/C（物理权威） | 工程参考优秀；作者明确把绝对精度列为非目标；拒绝采样上界有风险 | Rust/WASM、点云、交互与性能参考 |
| PRL 110, 213001 | A | 论文有效；用户 URL 的 `IF` 后缀错误 | 实验前向模型与节点映射案例 |
| Maksić 1986 | A | 书章节/论文元数据有效，系统讨论对称性与杂化 | 化学解释层；系数仍由 QuViz 推导和测试 |
| Jacobs 点群表 | B（参考数据） | 原域名已随大学更名退役；资源迁至 constructor.university 并仍在维护；表格导入必须机器验证 | 点群数据种子，不作不可变真值 |
| `atomic_orbitals.py` | C（动画源码） | 叙事有价值；3p 与 4d 硬编码多项式错误 | 分镜与术语参考，禁止复制公式 |
| `orbital_plot` | C/B（教程代码） | 通式与基本绘制流程可用；坐标、原点和阈值处理需修正 | 教程对照与反例 |
| minutephysics 与 The Science Asylum 视频 | C | 标题、频道与日期已核；两者均有英文字幕（含人工轨） | 视觉语言与概念导入 |
| FloatHeadPhysics 轨道形状视频 | C | 节点叙事出色；概率测度、动能、$d_{z^2}$ 和磁量子数的解释需纠正 | 经审计的节点直觉与辨错案例，不作公式真值 |
| Wikipedia probability current | D | 便于查术语，但属于三级来源 | 导航性链接；核心公式引教材 |
| TDS 有限差分文章 | C | stencil 向量化思路成立；“300 倍”仅是文中环境实测 | 优化候选，不作项目性能承诺 |
| 知乎分子轨道回答 | D | 当前作者显示为“知乎用户”；页面不显示该回答自身日期；强调计算与作图的学习方法 | 项目动机，不作公式信源 |
| Claude Fable 项目审计 | 审计输入 | 缺陷清单有价值；不能替代仓库复现与原始信源 | 当前状态的复核起点 |

## 1. 氢原子推导 PDF 与配套代码

PDF 的分离变量、约化质量、球谐函数、广义 Laguerre 多项式和归一化主线与标准公式一致。需要注意：

- 使用了自己的 Laguerre 记号，落地时必须显式映射到 DLMF/SciPy 参数顺序；
- 文中有一处把 Born--Oppenheimer 拼成 “Bohn--Oppenheimer”，不影响计算；
- PDF 附录给出的 $3p$ 与 $4d$ 径向多项式是正确的；错误只存在于配套 Manim 源码。

在 revision `a351de1` 的 `atomic_orbitals.py` 中，$\psi_{31,-1}$ 使用 $(4\sigma-2\sigma^2)$，$\psi_{422}$ 使用 $(6\sigma^2-2\sigma^3)$，把径向节点放错。正确节点见[纠错账本](corrections.md) [@solara-hydrogen-derivation; @solara-atomic-orbitals]。

`orbital_plot` 教程在 revision `86b572d` 中用通式调用 SciPy，整体比动画硬编码可靠，但仍有三个工程边界：

1. `np.meshgrid` 默认 `indexing="xy"` 造成前两数组轴的语义互换；`marching_cubes` 只是按输入数组轴返回坐标，不应把交换归因于算法本身 [@numpy-meshgrid; @skimage-marching-cubes]；
2. `theta = arccos(z/r)` 在包含原点的奇数网格会产生 `0/0`；
3. 固定 `iso_value=4e-4` 不能公平比较不同状态包围的概率质量 [@solara-orbital-plot]。

## 2. 图库与开源实现

The Orbitron 覆盖大量高角动量实轨道、节点和径向图，适合检查命名与视觉构图。但站点自己的 warning 明确写明重写尚未完成，并存在轨道名称、标签和缺失内容等问题。因此它只能参与视觉回归，核心公式仍回到 DLMF 和独立测试 [@orbitron]。

Evanescence 的通式计算、Rust/WASM 架构、点云和补充剖面很值得借鉴；README 同时明确说明 `f32` 与性能捷径是有意选择，绝对精度不是目标。revision `ed66847` 的接受-拒绝采样器先数值估计最大密度，再对有径向节点的态乘以小于 1 的 modifier；这会削弱“包络必须高于目标密度”的严格条件。QuViz 不复制该 sampler，而保留可分离逆 CDF 路径 [@evanescence; @tully2013pointillist]。

## 3. 实验、对称性与杂化

正确实验 DOI 是 `10.1103/PhysRevLett.110.213001`。实验通过光电离显微镜测量远处连续态投影；近核 Stark 波函数与该投影共享节点结构，所以节点可以被映射观察。它不是对自由氢原子三维 $|\psi|^2$ 的直接摄影 [@stodolna2013stark]。

Maksić 的资料确实讨论对称性如何约束杂化与定向成键，但杂化仍是解释模型和基选择。$T_d$ 下 $A_1\oplus T_2$ 的分解可支撑 $sp^3$ 构造；具体矩阵还必须检查正交性、方向夹角和相位/轴约定 [@maksic1986hybridization]。

Gelessus 特征标表可作为数据输入，但不能人工复制后直接信任。至少自动检查群阶、不可约表示维数平方和、行列正交和类顺序；特征标表文献本身也存在过长期传播的表头错误案例 [@jacobs-character-tables; @shirts2007-character-tables]。

!!! warning "原引用域名已经失效"

    2026-08-23 复核：`symmetry.jacobs-university.de` 的 http 与 https 两种 scheme 均无法完成 TCP 连接（`curl` 返回状态码 `000`，不是 4xx/5xx），Chrome 直接显示错误页。原因是 Jacobs University Bremen 于 2022/2023 更名为 Constructor University，整个域退役。

    资源本身**没有消失**：它迁到 `https://symmetry.constructor.university/`，仍在维护，且保留了完全相同的 `/cgi-bin/group.cgi?group=NNN&option=N` URL 结构，因此任何导入脚本只需替换主机名。`references.bib` 已改指新域。

    这条同时暴露一个门禁盲区：当时没有任何检查会发起 HTTP 请求，所以链接死了三年而 CI 始终全绿。为此本条另补一个**不可变**的同行评审引用作为档案锚点 [@gelessus1995-character-tables]。

## 4. 视频、百科、博客与知乎

- minutephysics 的视频发布于 2021-05-19，适合讨论“原子图像如何编码多种量”；
- The Science Asylum 的视频发布于 2020-11-08，直接以跃迁和概率流守恒为视觉主题；
- FloatHeadPhysics 的视频发布于 2025-01-30；2026-08-25 实际打开 watch 页并成功导出一条英语自动字幕。13:29--24:08 的“驻波—节点—轨道形状”叙事适合教学，但 05:05--10:00 与 21:58--30:18 的物理边界必须按[纠错账本](corrections.md)处理 [@floatheadphysics2025-orbitals, 05:05--30:18]；
- 三段视频都只承担教学入口，不承担逐式验证——理由是信源层级（非同行评审的科普媒体），与字幕是否可导出无关 [@minutephysics2021atoms; @science-asylum2020-orbitals; @floatheadphysics2025-orbitals]；
- FloatHeadPhysics 说明区未列论文、教材或大学讲义；外链是 Patreon、Brilliant 赞助和商品。Comenius University 2025/26 的量子理论作业还专门要求学生解释该视频 08:46--10:00 为何错误；这只是独立审计旁证，正确概率测度仍由教材公式与 QuViz 测试承担 [@comenius2025-quantum-theory-ps03, problem 5 (PDF p. 4)]；
- Wikipedia 只保留为概率流术语入口，连续性方程与电流公式引用量子力学教材 [@probability-current-wikipedia; @griffiths2018qm]；
- TDS 文中约 300 倍来自 2D 热方程、切片向量化和作者自己的 `timeit`；NumPy 官方文档还提醒 sliding-window 方法可能比专用算法慢，必须按问题 benchmark [@mocquin2022-fdm; @numpy-sliding-window]；
- 知乎页面显示的 2016-03-08 是**问题**的创建与编辑时间；该回答本身不显示发布或更新日期（同页其他回答显示日期，说明这是该回答的属性而非页面限制），`year = {2023}` 由 answer id 量级推断。当前页面作者匿名化为“知乎用户”。其“通过编程计算和作图加深理解”的建议与项目愿景一致，但不能替代量子化学教材 [@zhihu-molecular-orbital]。

## 5. Claude 审计 artifact

Claude Fable 的审计指出科学内核相对成熟、等值面与前端存在阻断缺陷、完整工程门禁失败，并给出了测试、lint、类型与构建基线。QuViz 将这些结论拆进[当前状态](../project/status.md)，同时重新运行文档、引用和全量 Python 测试。它的角色是 issue inventory；具体缺陷仍要以代码、可重复命令和视觉/数值测试确认 [@claude-fable-audit]。
