# QuViz validation record

Validation date: 2026-08-22

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

Run the following on the first online development machine:

```bash
uv sync --all-groups
cd web
npm install
cd ..
make check
```

Commit `uv.lock` and `web/package-lock.json` after that first successful resolution. The CI workflow automatically uses locked/frozen installation once those files exist.
