# QuViz validation record

> **SUPERSEDED — do not cite these numbers.**
>
> This file is a frozen snapshot of the 2026-08-22 delivery environment, which
> had no package registry. Its counts are stale: it reports 40 tests, 25
> BibTeX entries and 18 cited keys, whereas the repository now has materially
> more of each. The live, verified numbers live in
> [`docs/project/status.md`](docs/project/status.md), whose live snapshot is
> manually updated from an actual `check.ps1` run.
>
> Retained only as a record of what could and could not be checked offline.

Validation date: 2026-08-22 (historical)

## Checks completed in the delivery environment

- Python source and tests compiled successfully with Python 3.13.5.
- `pytest`: **40 passed, 1 skipped**.
- The skipped module is the MkDocs Markdown-extension integration test because the optional documentation dependency group could not be downloaded in this environment.
- Core runtime branch coverage: **88.47%**, above the configured 85% gate. Documentation-build tooling is excluded from the runtime coverage denominator and has separate functional checks.
- The scientific tests cover normalization, corrected 3p/4d nodes, real-harmonic directions, stationary probability current, independent sampling statistics, tetrahedral $sp^3$ geometry, grid spacing, binary transport, API responses and fixed-probability isosurfaces.
- `references.bib`: 25 entries.
- Documentation citation keys used: 18; missing keys: 0.
- Generated citation index is synchronized with `references.bib`.
- TypeScript syntax transpilation succeeded for 16 source files.
- `mkdocs.yml` and the GitHub Actions workflow parse as YAML.

## Checks requiring an online package registry

The container could not resolve PyPI or npm registry hosts, so the following dependency-installing checks were not executed end to end:

- `uv sync --all-groups` and generation of `uv.lock`;
- Ruff and mypy from the declared development group;
- `mkdocs build --strict` with Material, mkdocstrings and Markdown installed;
- `npm install`, full TypeScript module resolution and `vite build`;
- generation of `web/package-lock.json`.

The commands below were the bootstrap instructions on 2026-08-22. They are no
longer instructions for the current checkout: both `uv.lock` and
`web/package-lock.json` are now committed. Current validation must consume
those exact dependency trees:

```bash
uv sync --locked --all-groups
cd web
npm ci --no-audit --no-fund
cd ..
make check
```

Do not regenerate either lockfile as a side effect of setup. Dependency updates
are separate, intentional changes whose manifest and lockfile diffs must be
reviewed together. CI unconditionally uses the locked/frozen installation and
fails when a lockfile is missing or stale.
