# 添加表示方法

新增 representation 前先写一句完整语义：

> “这是 observable X 在规则 Y 下转化得到的 representation Z。”

例如：

> “这是概率密度 $|\psi|^2$ 的 90% superlevel-set 等值面，并以波函数相位着色。”

本页的清单不是从原则推导出来的，而是从**实际做完一次**倒推出来的：PR-8B/8C 加入 $\psi$/相位平面切片时，每一条都对应一件当时必须做、且漏掉就会有测试变红的事。粗体的条目是原清单没有、那次才补上的；[工程门禁要付的账](#engineering-gate-cost)一节是新表示每加一个前端模块的固定成本。

## Python 端

- 生成几何或标量场；
- **先冻结几何约定，再写生成代码**：切片的三张主平面各有一个右手 $(u,v,n)$ 标架（`src/quviz/physics/planes.py`），$\hat u\times\hat v=\hat n$ 是契约不是巧合，`xz` 的法向因此是 $-\hat y$。写成左手系时 payload 仍然自洽，只是这张平面上每一条与手性有关的结论（相位缠绕符号、概率流环绕方向）被整体镜像；
- **检查采样轴本身，不要相信 `linspace`**：`np.linspace(-E, E, R)` 以 `start + step*i` 生成再修补端点，一般 extent 下两半并非逐位互为相反数，于是对称性断言和节点位置由舍入决定。切片改用 $\texttt{spacing}\times(\texttt{arange}(R)-\texttt{half})$，并留了一条“换回 `linspace` 就变红”的负控制；
- 记录该 representation 真正导出的量，而不是套用别人的字段：等值面记阈值、包围质量、网格参数；切片记导出的 extent、行主序布局和相位遮罩的六个分项（relative、amplitude scale、threshold、numeric floor、平面最大模、masked fraction）；
- **参照量要属于状态，不属于这一张图**：切片的遮罩阈值参照 $L_{\mathrm{ref}}^{-3/2}$ 而不是切片自身最大值——恰好落在节面上的平面里，最大值是数值残渣（实基 $2p_z$ 在 `xy` 上实测 $4.5\times10^{-18}$），拿它定阈值等于把阈值重新标定到噪声上；
- 返回 Scene Contract；
- **写一份逐字节黄金 payload**：`tests/fixtures/slice_golden.json` 由脚本以 canonical dump 写出、由测试重建后逐字节比对，所以数字一旦变化必须以一份有人读的 diff 出现，而不是整套测试跟着重新推导、于是一致同意；
- 不决定页面布局。

## API 与类型：一条生成链，不是两份手写副本

新 representation 的路由落地后，类型**不是手写**的：

1. `scripts/write_openapi.py` 从活的 app 写出 `tests/fixtures/openapi.json`，`tests/test_openapi_contract.py` 比对它与今天服务的 schema；
2. `npm run codegen`（`web/scripts/generate-api-types.mjs`）以那份 fixture、而不是某台运行中的服务器为输入生成 `web/src/api/schema.gen.ts`；
3. `web/src/api/schema.gen.test.ts` 比对生成结果与提交进树的文件。

链上没有无人看管的一环，所以忘记重新生成会变红，而不是让前端悄悄按旧 schema 编译。

## TypeScript 端

- **类型不能检查跨字段规则，所以要另写一个运行时校验器**：`schema.gen.ts` 眼里 `values` 只是 `number[]`，一份少一行、遮罩与自报 fraction 不符、或标架是左手系的 payload 完全通得过类型检查，然后渲染成一张没人看得出错的图。`src/api/sliceContract.ts` 把服务端的跨字段规则在客户端**独立重述并检查**一遍——刻意重述而不是共用产物，因为客户端检查的意义正在于服务器变了而没人意识到时它会红；
- **只暴露访问器，不暴露下标算术**：`sliceValueAt` 是读取样本的唯一出口，`k = row * resolution + col` 只写一次。在每个调用点重写一遍索引算术，就是迟早会写错一次的索引算术——而 u/v 转置在对称态上完全看不出来；
- **哨兵值要在边界上变成 `null`**：被遮罩的样本携带有限哨兵 `0.0`（这样严格 JSON 解析器能通过、忽略遮罩的客户端画出确定占位值），但 `0.0` 同时是一个完全合法的相位（“正实数”），所以访问器返回 `null`；
- 把数组映射到这个 representation 真正需要的 GPU 对象——**不一定是 `BufferGeometry` attribute**：等值面是 indexed geometry，点云是 `THREE.Points`，切片是一张 `DataTexture` 贴在按 payload 标架旋转的 quad 上（`src/scene/SliceField.tsx`）；
- **凡是影响像素的决定都要显式写出来并说明理由**：切片的 `NearestFilter` / `flipY = false` 恰好与 three@0.185.1 默认值相同，`SRGBColorSpace` 则刻意偏离默认值；默认值是关于某个版本的事实，不是关于这段代码的意图，所以四项各写一行，并用测试钉住；
- 材质只消费明确命名的 attribute / uniform / 纹理通道；
- 控件变化若改变物理资产，必须重新请求后端；
- 释放旧资源：geometry、material，以及切片多出来的 texture——换 payload 时被取代的那一份也要释放，不只是卸载时。

## 工程门禁要付的账 { #engineering-gate-cost }

新表示每加一个 `web/src/` 下的生产模块，就要付这些（漏掉哪一条都会变红，不会静默通过）：

- **`web/coverage-scope.json` 两处条目**：`coverageGated` 与 `pragmaScanned` 各加一行，按字典序。这道人工复核闩是刻意的；`web/src/guards.test.ts` 会直接给出应有清单与现有清单的 diff；
- **一个 import 它的 spec**：覆盖率按文件评估（语句/函数/行 90%、分支 85%），而 `all: true` 会把没有任何 spec 引用的模块记成 0%，于是门槛失败；
- **零 skip**：`assert-no-skips.mjs` 核对 vitest 自己的结果文件，`guards.test.ts` 另扫源码；
- 如果这个 representation 要有截图基线，还要付 `web/e2e/` 那一层：固定的 payload fixture（`scripts/write_visual_fixtures.py` 写、`tests/test_visual_fixtures.py` 重建并比对——catalog 逐字节，切片按结构比对、浮点允许 1e-12 相对偏差以容纳跨平台 libm 的末位舍入——这样一次像素 diff 只能是关于渲染的）、一条 spec，以及**第一次 CI 运行必然失败**、由人逐张看过渲染结果后才提交基线的流程（见[质量门禁](../reference/quality-gates.md)）。

## 一个 representation 可以承载多个 observable

切片的四个 `slice_observable` 里，实部与虚部映射到同一个 `wavefunction`，所以 `slice_observable` 与 `observable` 是两个字段，`value_unit` 由前者唯一决定。

## 新表示往往要带上一条它自己不宣称什么的话

相位遮罩标记的是低振幅 / 相位未定义区域，**不是节点证书**：那个集合既包含节面也包含指数尾部。这句话必须写进 payload 文档、`scene-contract.md` 与 metadata warning，而不是留给渲染层的颜色去暗示。

同类的例子在概率流那边：实轨道的概率流恒为零，返回空 payload 加 warning，而不是 4xx——“不存在”与“出错”是两回事。

## 已实现的三个范例

- `probability_density` + `isosurface`：`build_isosurface` 返回目标包围质量、阈值与网格参数；
- `probability_current` + `streamlines`：`build_current_field` 返回弧长等距折线、逐顶点速度与实测连续性残差。它说明了本页第一句的要求：切换到概率流**不是换材质**，而是换 observable，所以前端必须重新请求 `/api/orbitals/current-field`；
- `probability_density` / `wavefunction` / `phase` + `slice`：`build_slice` 与 `build_superposition_slice` 在一张过原点的主平面上返回行主序标量场、平面标架、导出并报告的 extent，以及相位遮罩的六个数（见[Scene Contract](../reference/scene-contract.md)）。

## 验证

按 representation 分，不要套用别人的清单：

- 网格类（等值面）：几何顶点有限、法向归一、face index 不越界、表面阈值与 metadata 一致；
- 标量场类（切片）：布局按行主序、标架右手且逐平面对得上、遮罩样本读作 `null` 而不是哨兵、采样轴逐位反对称、`resolution` 为奇数所以原点在网格上；
- 三者共有：payload 能通过严格 JSON 解析（没有裸 `NaN` / `Infinity`），以及一份逐字节黄金 fixture。

**视觉回归图不能替代物理测试。** 现在这句话有了具体形式：截图门禁确实存在（`web/e2e/`），但每一条截图声明都另有一条与平台无关的 vitest 断言，图片只多出“固定的 Linux/Chromium/SwiftShader WebGL 管线确实把它光栅化成了这些像素”这一句。它不代表真实 GPU 或其他浏览器；一张绿的截图对物理只字未提。
