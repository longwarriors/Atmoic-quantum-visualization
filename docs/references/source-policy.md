# 信源与引用政策

## 来源等级不是一条总排名

同一来源对不同声明的权威性不同。源码是判断“这个程序怎样采样”的一手证据，却不是判断“这个采样在数学上无偏”的最高证据。

| 级别 | 来源类型 | 允许承担的责任 |
|---|---|---|
| A | 同行评审论文、学术专著、DLMF 等权威参考 | 物理定律、数学定义、实验结论 |
| B | 官方 API 文档、项目源码、大学维护的数据表 | 软件语义、实现行为、参考数据 |
| C | 教学 PDF、图库、视频、技术博客 | 叙事、视觉语言、实现思路、待复现案例 |
| D | Wikipedia、知乎等社区内容 | 术语入口、学习动机、社区语境 |

等级 C/D 不是“不能引用”，而是不能单独证明核心科学结论。

## 一条声明至少记录四件事

1. **Claim**：究竟声称了什么；
2. **Source**：哪一页、哪一节、哪个 DOI、URL 或源码 revision；
3. **Verification**：公式推导、独立计算、单元测试、数值收敛或实验复现中的哪一种；
4. **Scope**：在哪些参数、约定和误差范围内成立。

“图看起来一样”只能作为视觉回归，不能代替归一化、节点、连续性或采样分布检验。

## 引用语法：locator 是政策的一部分

上一节要求记录“哪一页、哪一节”。因此引用语法必须能表达它：

```markdown
[@griffiths2018qm, ch. 4 (pp. 131--197)]
[@dlmf-laguerre, eq. 18.5.12]
[@dlmf-spherical-harmonics, §14.30; @griffiths2018qm, ch. 4]
```

规则：

- `[@key]` 与 `[@key, locator]` 都合法，`;` 分隔多条；
- key 必须匹配 `[A-Za-z0-9_:-]+`，否则**文档构建失败**；
- locator 是自由文本，但应当是可核查的定位（章、节、页、公式号、commit），不是转述。

!!! danger "以前这里有一个静默漏洞"

    早期的引用正则要求 `]` 紧跟在 key 之后，所以 `[@key, p. 4]` **根本不匹配**：它既不会被渲染，也不会被校验，只是原样输出成字面文本。也就是说，一个带 locator 的**错误 key** 可以完全绕过门禁。现在改为宽松匹配加事后校验，畸形引用会让构建失败。

## 引用规则

- 公式优先引 A 级来源；实现接口同时引 B 级官方文档；
- 开源项目只证明其自身的设计与行为，QuViz 必须独立验证移植部分；
- 视频、图库和博客用于解释“怎样展示”时可直接引用，但正文要标明教学性质；
- 社区内容不得承担数值常数、算法正确性或实验因果结论；
- AI 审计输出只作为问题发现与复核清单；其中每项事实仍需回到仓库、测试或原始来源；
- 发现来源错误时保留引用，并在[纠错账本](corrections.md)记录错误位置、正确结论和验证方法；
- 网页记录访问日期，源码审计**必须**记录 commit，论文记录 DOI。对 `source-audit` 条目这一条由 `quviz.docs.pins.validate_source_pins` 强制：URL 必须带 `http(s)://` 协议；代码托管站 URL 必须指向仓库或其中的源码（issue / pull / discussion / wiki 页面不算），必须有小写十六进制 `commit` 且与 URL 中的 SHA 一致，tag/分支 URL 还要有 `version` 且与 URL 中的 ref 相等（至多差一个前导 `v`），`HEAD`、`main`、`master` 这类分支名与 `/releases/latest`、`/archive/...` 这类无法识别的路径都不算 pin；非代码托管站的有 URL 条目必须有 ISO `urldate`，无 URL 的必须有 `doi`；
- 每个 `references.bib` 条目都必须在**正文**中被引用；纯工具链条目标注 `keywords = {tooling}` 豁免。未被引用的条目无人复核，`scripts/render_reference_index.py --check` 与 pytest（`tests/test_bibliography.py::test_every_bibliography_entry_is_cited_or_marked_tooling`）会报 orphan 错误——`mkdocs build --strict` 本身**不**做这项检查。代码块、行内代码和块级 HTML 注释里的引用不算正文，所以示例语法不会把条目“救活”；
- 声明“某来源没有某内容”时必须记录访问日期和检查方法，并区分“我没抓到”与“它不存在”；
- 影响因子、赞同数、star 数不作为单条科学结论的证据。

## 强制与政策的边界

工具强制，但执行者各不相同：未知键与畸形键、空 locator 由 `mkdocs build --strict` 的引用扩展在渲染时抛错，也由索引脚本与 pytest 复查；orphan（排除代码块与注释）、索引同步、`source-audit` 条目的 commit/SHA/URL 一致性与访问日期只由 `scripts/render_reference_index.py --check` 与 pytest 强制（本地 `check.ps1` / `make check` 与 CI 都运行它们），`mkdocs build --strict` 对这几项一无所知；新增链接的可达性只在 CI 中由 `changed-links` 作业探测（需要网络，不在本地门禁内）。

仅政策（靠评审执行）：核心公式必须带 locator、locator 的格式与准确性、来源等级与声明的匹配。语法上 `[@key]` 与 `[@key, locator]` 都能通过检查，工具无法判断一条核心结论是否本应带 locator。

逐行对应的执行者见[添加和维护引用](../how-to/cite-sources.md#enforced-rules)。

## 仓库中的引用链

```text
references.bib
  ├─ MkDocs [@citation-key]
  ├─ generated references/index.md
  ├─ source-audit.md（逐条判定）
  ├─ source-map.md（声明到证据）
  └─ corrections.md（错误与修正）
```

新增来源的操作步骤见[添加和维护引用](../how-to/cite-sources.md)。
