# 3D 前端渲染

本页把 Phase 0 已验证实现和后续目标分开 [@threejs; @react-three-fiber]。

## 当前原型

仓库使用 React、TypeScript、Vite、React Three Fiber、Drei、Three.js `BufferGeometry`、自定义点云 shader 和后处理。生产构建已通过，并完成以下 M0R 修复：

- 点云使用普通 alpha blending 和统一 marker 权重，密度只由空间点浓度编码；
- 点云与等值面使用同一套以 sRGB 定义的 HSV 周期相位映射，送入 GPU 前统一解码到 Linear-sRGB；实基相位 0 为红、相位 $\pi$ 为青；`Re ψ` / `Im ψ` 切片使用红—深中性—青发散色图，density 切片使用单调亮度的蓝色顺序色图；
- 雾、Bloom 和 opacity 控件只出现在实际消费它们的展示层；相位点云/等值面刻意绕过会改写数据色的雾与全帧后处理，因此这些 representation 不显示 Bloom。Exposure 在后处理接管 tone mapping 的真实挂载路径完成验证前不向用户暴露；
- 新资产到达后按轨道方向重新选择观察轴并 fit camera；
- Inspector 从服务端 metadata 显示标签、能量、单位、几何/颜色语义和引用；
- 等值面默认不透明、使用未照明 `MeshBasicMaterial` 和已校正绕向的 front faces；Phase 0 没有 Fresnel 映射，避免光照、视角或透明排序制造假结构。

PR-8B/8C 又加了 $\psi$/相位平面切片：后端返回行主序标量场与右手 $(u,v,n)$ 标架，前端把它上传成一张 `DataTexture` 贴在一块按同一标架旋转的 quad 上（`src/scene/SliceField.tsx`）。

概率流入口不再因默认 2p_z 实基、$m=0$ 态而成为一个“点不到”的死控件：对这类本征态，不可用按钮仍可聚焦和点击，并在页面内显示零流原因；独立的“载入并显示概率流示例”操作从服务端 orbital catalog 的 `3d-complex` 项取状态，再显式切到流线 representation。它不在用户点击不可用按钮时偷偷改写量子态，也不在前端复制一份可能漂移的示例参数。对解析上严格零流、但 route 正常返回空 `lines` 的叠加态，图例会明确显示“解析零概率流”；对数值上合法但当前时刻没有可绘制路径的空结果，图例则显示“当前时刻无可绘制流线”。两种情况都省略没有物理取值可编码的 `0…0` 色带。

叠加态播放同样消费服务端 catalog 的 `period_au`，并按当前 $a_\mu/Z^2$ 时间尺度换算周期（对应的能量尺度为 $Z^2/a_\mu$）；每圈把真实周期分成整数帧后从帧号重建时间，既不会在旧的 39.6 a.u. 人工边界发生相位跳变，也能在后续圈生成逐位相同的缓存键。`period_au=0` 的简并态不执行播放，但控件仍可用键盘聚焦：它使用 `aria-disabled`，并通过 `aria-describedby` 指向页面内持续可见的“能量简并、概率密度不随时间变化”说明，而不是把唯一解释藏在 disabled 按钮的鼠标 tooltip 中。

同一 catalog 还发布每个预设的 `slice_resolution_floor` 与 `streamline_seed_count_max`。前者由服务端 slice builder 的实际 extent / 径向特征楼层函数生成；后者由 current-field route 的 estimator 和两道 workload guard 在默认 `arc_step` 下生成。选择预设与 store 更新在一次原子写入中完成，因此 `1s + 3d_z²` 的第一份切片 plan 已是 103、第一份流线 plan 最多 24 seeds，不会先发一个确定性 422 再回退。typed runtime parser、能力矩阵、滑条和 request planner 全部消费这两个字段，不在 TypeScript 重算径向或 RK4 数值。缺失或损坏的 seed metadata 不会猜测一个回落数值，而是把该流线能力标为 unsupported，保证 planner 根本构造不出请求。Z 的前端数值范围也来自能力约束表；该约束与所有七个科学 route 的 committed OpenAPI 逐项互校，number input、store clamp 和 query planner 共用同一组 0.1–20 UI 边界。

截图回归的接线已经进 CI（`web/e2e/`、`npm run test:visual`、`ci.yml` 的 `web-visual` job），五张经人工检查、只由 Linux/SwiftShader 产生的 PNG 基线已经提交，见[质量门禁](../reference/quality-gates.md)。这套端到端回归覆盖切片主路径，不代表真实 GPU、多浏览器或其余表示法；主 bundle 也仍需拆分。完整边界见[当前状态](../project/status.md)。

## 界面语言与视觉层级

WebUI 采用“中文主述、专业记法原样保留”的单一信息层级，不把同一句话并排做中英文翻译。操作、状态、错误前缀和解释句使用中文；`basis`、`phase`、`density`、`OpenAPI`、`Bloom`、`arg ψ`、`Re ψ`、`Im ψ`、`|ψ|²`、`Ha`、`bohr` 与 `a.u.` 等名称、公式和单位保持领域写法。`point_cloud` 之类 wire enum 仍留在请求与 metadata 中，但界面显示“电子云 / 等密度面 / 平面切片 / 概率流线”。

视觉系统是低饱和深色底、细边框、少量 cyan 状态色和等宽数值，不再使用蓝紫玻璃拟态、强 glow 或装饰性渐变；科学色轮、发散色标和 density ramp 不跟随品牌色重设计。桌面壳固定为 `100dvh`，左右 panel 各自滚动，画布尺寸不再随控制项或 Inspector 的内容高度变化；`1180px` 以下恢复自然页面滚动，`820px` 以下按 viewport → 控制栏 → Inspector 排成单列。

## 当前渲染契约

前端只能映射数据，不能重新发明物理语义。每个 layer 至少接收与其状态类型相符的身份：

- 本征态使用 $n,\ell,m,Z,a_\mu,$ basis；叠加态使用各项量子数、复系数、$Z,a_\mu,$ basis 与时刻；
- 状态标签、observable 和 representation；
- 坐标、长度单位、归一化与有限域质量；
- representation 专属的分辨率、阈值与数值诊断；
- phase colormap 的数学映射；
- 来源键与计算警告。

公开诊断不能混成一个虚构的通用 metadata 结构：点云的捕获径向质量与 extent 来自响应头；等值面带请求/实际质量、有限网格积分、resolution、spacing 与 extent；流线带 extent、seed density floor、arc step、速度和连续性 residual/scale/probe；切片带平面、extent、spacing、值单位，并只在 phase 场中携带低振幅 mask 的阈值、数值下限与 `valid_mask`。Inspector 按资产类型显示存在的字段，缺失值不猜测。

## 点云

点云几何使用 `THREE.Points`，而不是为每个样本创建球形 mesh。shader 把几类信息分开：

- `position` 只承载抽样位置；
- `phase` 决定周期色相；
- alpha/亮度是显示参数，不应再次把已经按 $|\psi|^2$ 抽样的点按密度任意加权；
- soft sprite 与透视点大小只改善阅读，不得填平节点；
- blending、tone mapping 和曝光必须有可测的默认值与视觉回归。

点云是重复制备下的位置样本，不是同一电子随时间运行的轨迹。

## 等值面

等值面路径是：后端用 `indexing="ij"`、显式 spacing 和奇数网格生成 scalar field；marching cubes 返回顶点和 faces；后端验证包围质量、法向/绕向和节点；前端只创建 indexed geometry 并应用材质 [@skimage-marching-cubes]。

相位由颜色承载，几何由 $|\psi|^2=c$ 承载。等值面使用未照明材质，不接收或投射阴影；点云和等值面都绕过 fog、tone mapping 以及全帧 Bloom/Vignette，使相位色不随法线、灯光、景深或后处理改变。透明度仍会按正常 alpha 合成，因此图例描述的是源数据色，不承诺半透明像素与 CSS 字节相等。

## 平面切片

切片路径是：后端在过原点的主平面上求值，返回行主序标量场（`k = row * resolution + col`，`row` 走 $v$、`col` 走 $u$）、右手 $(u,v,n)$ 标架、导出的 extent 与相位遮罩；前端把每个样本着色成一个 RGBA8 texel，上传成 `DataTexture`，贴在按同一标架旋转的 quad 上。

三条渲染决定必须写出来，不能靠默认值：

- **采样与色彩空间四项全部显式设置**：`magFilter` / `minFilter` 都是 `NearestFilter`（插值会在节线两侧编出后端从未计算过的中间值）、`flipY = false`（行主序的第 0 行就是 $v$ 的第 0 个样本，翻转即上下镜像）、`colorSpace = SRGBColorSpace`（texel 保存的是与 CSS 图例相同的 sRGB 字节，采样时先解码到线性空间，输出时再编码回 sRGB，屏幕字节才保持不变）。前三项是 three@0.185.1 `DataTexture` 的默认值，色彩空间不是；**默认值是关于当前版本的事实，不是关于本项目的决定**，所以四项都逐条写出并各带一句理由；
- **quad 的边长是 `resolution * spacing`，不是 `2 * extent`**：样本是格心，整张图比被采样的跨度正好宽一个 spacing；
- **被遮罩的样本画成全透明且为黑**，而不是画成哨兵值 `0.0` 的颜色——`0.0` 是一个完全合法的相位（“正实数”），照着画会把低振幅区域填成一片“有确定相位”的颜色。

切片显示的是那一张平面上的值，不是节面几何：遮罩标记低振幅 / 相位未定义区域，不是节点证书。

## 信息层

界面按当前资产显示：

- 本征态的 $n,\ell,m,Z$ 与 real/complex basis，或叠加态的逐项系数、$Z,a_\mu$、basis 与时刻；
- observable 和 representation；
- 单位、归一化和计算域；
- 对应表示法实际拥有的点数、线数、网格分辨率、质量或连续性诊断；
- 与 shader 一致的相位图例；
- 阻断警告，不能只写入后端 metadata 后在 UI 隐藏。

## 目标性能预算，而非现有承诺

| 资产 | 初始设计预算 | 达标前必须测量 |
|---|---:|---|
| 点云 | 20k–80k 点 | 帧时、显存、透明叠加稳定性 |
| 等值面 | 10k–150k triangles | 生成时间、传输体积、法向质量 |
| 标量体 | $64^3$ 起 | 纹理上传、ray-march 步数、误差 |
| 流线 | 200–2000 条 | 积分误差、节点遮罩、帧时 |

WebGL 2 是当前基础。WebGPU、体渲染、GPU sampling、renderer adapter、SMAA 和完整 Fresnel 材质均属于后续设计，未出现在[当前状态](../project/status.md)的“已验证”栏前不得写成已有功能。

## 视觉反例

- 用彩虹色表示实数大小，却不说明相位；
- Bloom 过强，把节点光晕填平；
- 透明等值面排序错误，产生假结构；
- 为了“更饱满”而移动采样点；
- 不同轨道使用不同自动尺度，却暗示物理尺寸可直接比较；
- 把慢速旋转点云描述成电子运动。
