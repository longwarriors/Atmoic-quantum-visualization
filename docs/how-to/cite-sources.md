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
