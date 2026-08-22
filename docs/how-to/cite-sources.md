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

## 生成索引

```bash
uv run --group docs python scripts/render_reference_index.py
```

检查索引是否同步：

```bash
uv run --group docs python scripts/render_reference_index.py --check
```

未知键会使文档构建失败。

## 资料分类

在 BibTeX `keywords` 中使用：

- `physics` / `mathematics`；
- `experiment` / `measurement`；
- `chemistry` / `symmetry`；
- `visualization` / `teaching`；
- `software` / `numerics`；
- `source-audit`。

## 来源质量要求

1. 物理结论优先教科书、DLMF、论文；
2. 软件 API 优先官方文档；
3. 网站和视频用于教学或视觉参考，不替代公式真值；
4. 对已审查出错误的资料保留引用，但必须在 [已确认纠错](../references/corrections.md) 中记录。
