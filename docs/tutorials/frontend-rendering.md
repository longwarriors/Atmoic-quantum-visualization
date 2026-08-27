# 3D 前端渲染

本页把 Phase 0 已验证实现和后续目标分开 [@threejs; @react-three-fiber]。

## 当前原型

仓库使用 React、TypeScript、Vite、React Three Fiber、Drei、Three.js `BufferGeometry`、自定义点云 shader 和后处理。生产构建已通过，并完成以下 M0R 修复：

- 点云使用普通 alpha blending 和统一 marker 权重，密度只由空间点浓度编码；
- 点云与等值面使用同一 HSV 周期相位映射，实基相位 0 为红、相位 $\pi$ 为青；
- 曝光、雾、Bloom 和 opacity 控件实际驱动 renderer；
- 新资产到达后按轨道方向重新选择观察轴并 fit camera；
- Inspector 从服务端 metadata 显示标签、能量、单位、几何/颜色语义和引用；
- 等值面默认不透明并使用已校正绕向的 front faces，避免透明排序制造假结构。

PR-8B/8C 又加了 $\psi$/相位平面切片：后端返回行主序标量场与右手 $(u,v,n)$ 标架，前端把它上传成一张 `DataTexture` 贴在一块按同一标架旋转的 quad 上（`src/scene/SliceField.tsx`）。

截图回归的接线已经进 CI（`web/e2e/`、`npm run test:visual`、`ci.yml` 的 `web-visual` job），但**基线 PNG 还没有**：它们只能由 Linux/SwiftShader 产生，且必须有人逐张看过第一次失败运行的 `*-actual.png` 之后才提交，见[质量门禁](../reference/quality-gates.md)。交互回归仍只有 vitest 层的组件测试，主 bundle 也需要拆分。完整边界见[当前状态](../project/status.md)。

## 当前渲染契约

前端只能映射数据，不能重新发明物理语义。每个 layer 至少接收：

- 状态标签、basis、observable 和 representation；
- 坐标、长度单位、归一化与有限域质量；
- 点数或网格分辨率、阈值和包围概率；
- phase colormap 的数学映射；
- 来源键与计算警告。

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

相位由颜色承载，几何由 $|\psi|^2=c$ 承载。透明度、Fresnel rim、Bloom 或雾都必须足够克制，不能让彼此分离的叶瓣看似连接。

## 平面切片

切片路径是：后端在过原点的主平面上求值，返回行主序标量场（`k = row * resolution + col`，`row` 走 $v$、`col` 走 $u$）、右手 $(u,v,n)$ 标架、导出的 extent 与相位遮罩；前端把每个样本着色成一个 RGBA8 texel，上传成 `DataTexture`，贴在按同一标架旋转的 quad 上。

三条渲染决定必须写出来，不能靠默认值：

- **采样与色彩空间四项全部显式设置**：`magFilter` / `minFilter` 都是 `NearestFilter`（插值会在节线两侧编出后端从未计算过的中间值）、`flipY = false`（行主序的第 0 行就是 $v$ 的第 0 个样本，翻转即上下镜像）、`colorSpace = NoColorSpace`（texel 已经是要显示的字节，再做一次 sRGB 转换等于把色标解码两次）。这四项恰好是 three@0.185.1 `DataTexture` 的默认值，但**默认值是关于当前版本的事实，不是关于本项目的决定**，所以逐条写出并各带一句理由；
- **quad 的边长是 `resolution * spacing`，不是 `2 * extent`**：样本是格心，整张图比被采样的跨度正好宽一个 spacing；
- **被遮罩的样本画成全透明且为黑**，而不是画成哨兵值 `0.0` 的颜色——`0.0` 是一个完全合法的相位（“正实数”），照着画会把低振幅区域填成一片“有确定相位”的颜色。

切片显示的是那一张平面上的值，不是节面几何：遮罩标记低振幅 / 相位未定义区域，不是节点证书。

## 信息层

界面始终显示：

- $n,\ell,m,Z$ 与 real/complex basis；
- observable 和 representation；
- 单位、归一化和计算域；
- 点数或网格分辨率；
- 截断概率或目标包围概率；
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
