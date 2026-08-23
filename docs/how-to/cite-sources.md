# 添加和维护引用

## 单一真值源

所有正式来源放在根目录：

```text
references.bib
```

文档正文使用：

```markdown
这一结论来自实验 [@stodolna2013stark]。
```

多个来源：

```markdown
点云可视化已有教育研究与开源实现 [@tully2013pointillist; @evanescence]。
```

带页码或章节（核心科学声明必须带）：

```markdown
径向函数与 Laguerre 约定 [@griffiths2018qm, ch. 4 (pp. 131--197); @dlmf-laguerre, eq. 18.5.12]。
```

key 写错或格式畸形会让 `mkdocs build --strict` 失败，不会静默输出成普通文本。

## 生成索引

```bash
uv run --group docs python scripts/render_reference_index.py
```

检查索引是否同步：

```bash
uv run --group docs python scripts/render_reference_index.py --check
```

未知键、畸形引用，以及**没有被任何正文引用的条目**（orphan）都会使检查失败。工具链条目用 `keywords = {tooling}` 豁免 orphan 检查。

## 哪些规则由工具强制 { #enforced-rules }

下面这些由工具强制，但**执行者不同**：`mkdocs build --strict` 只在渲染引用时校验键与 locator 的语法；orphan、索引同步和 `source-audit` 锚定由 `scripts/render_reference_index.py --check` 与 `uv run --group docs pytest` 执行（两者都在本地 `check.ps1` / `make check` 和 CI 内）；链接可达性需要网络，只在 CI 中运行。“执行者”列写明违反时是哪一步失败：

| 检查 | 规则 | 执行者 |
|---|---|---|
| 未知键 / 畸形键 | 正文中每个 `[@key]` 必须存在于 `references.bib`，key 匹配 `[A-Za-z0-9_:-]+` | `mkdocs build --strict`（引用扩展抛错）；`render_reference_index.py --check` 与 pytest 复查未知键——本地 + CI |
| 空 locator | `[@key, ]` 这种逗号后为空的写法是错误 | `mkdocs build --strict`；`render_reference_index.py --check` 与 pytest——本地 + CI |
| orphan | 每个非 `tooling` 条目至少在一处**正文**中被引用；围栏代码块、行内代码和 `<!-- -->` 注释里的引用**不算** | `render_reference_index.py --check` 与 pytest——本地 + CI；`mkdocs build` 不检查 |
| 索引同步 | `docs/references/index.md` 必须与生成结果一致 | `render_reference_index.py --check` 与 pytest——本地 + CI；`mkdocs build` 不检查 |
| 源码 commit 锚定 | `source-audit` 且 URL 在代码托管站（GitHub、GitLab、Bitbucket、Codeberg、Gitee）的条目必须有 7–40 位十六进制 `commit`；URL 中若含 SHA，必须与 `commit` 一致；URL 指向 tag/分支时还必须有 `version` 且其出现在 URL 里 | `render_reference_index.py --check` 与 pytest（`tests/test_citation_gates.py`）——本地 + CI；`mkdocs build` 不检查 |
| 非源码审计条目 | `source-audit` 但不在代码托管站的条目：有 URL 就必须有 ISO 格式 `urldate`，没有 URL 就必须有 `doi` | 同上 |
| 新增链接可达 | 新增的 URL/DOI 由 `scripts/check_links.py --changed-since` 探测，任何非 OK 结果都失败；每周另有全量扫描 | **仅 CI，需网络**（`changed-links` 作业）；不在本地 `check.ps1` / `make check` 内 |

pytest 必须带 `--group docs` 运行（`check.ps1`、`make test`、CI 都已如此）；缺少该依赖组时 `tests/test_citation_gates.py` 会直接报错，而不是静默跳过。

下面这些**仍只是政策**，没有工具检查：

- 核心公式必须带 locator（页、节、公式号）——工具只检查 locator 不为空，不检查是否存在、是否可核查；
- locator 的格式与准确性；
- 来源等级是否配得上它承担的声明（见[信源与引用政策](../references/source-policy.md)）；
- 重定向到 200 落地页的链接仍算 OK，链接检查不验证页面内容。

## 资料分类

在 BibTeX `keywords` 中使用：

- `physics` / `mathematics`；
- `experiment` / `measurement`；
- `chemistry` / `symmetry`；
- `visualization` / `teaching`；
- `software` / `numerics`；
- `source-audit`。

## 来源质量要求

1. 先写清 claim，再按该 claim 选择来源；不存在对所有声明都通用的总排名；
2. 物理结论优先教科书、DLMF、论文，软件行为优先官方文档和具体源码 revision；
3. 网站、视频、博客和社区回答用于教学、视觉参考或待复现想法，不替代公式真值；
4. 记录验证方式和适用范围，截图相似不能替代数学或数值测试；
5. 对已审查出错误的资料保留引用，但必须在[已确认纠错](../references/corrections.md)中记录。

完整等级、责任和审计链见[信源与引用政策](../references/source-policy.md)。
