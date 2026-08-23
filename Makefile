.PHONY: sync test lint typecheck docs web web-test web-build api dev refs check links

sync:
	uv sync --all-groups
	cd web && npm install

# --group docs is load-bearing: the citation gates import python-markdown
# plainly and error without it. tests/conftest.py fails the session on any
# skipped test (QUVIZ_ALLOW_SKIPS=1 overrides), so no gate can drop silently.
test:
	uv run --group docs pytest --cov=quviz --cov-report=term-missing

lint:
	uv run ruff check .
	uv run ruff format --check .

typecheck:
	uv run mypy

# --check, not a bare run: `make check` must not rewrite a tracked file as a
# side effect. Use `make refs` to regenerate.
docs:
	uv run --group docs python scripts/render_reference_index.py --check
	uv run --group docs mkdocs build --strict

web:
	cd web && npm run dev

web-test:
	cd web && npm run test

web-build:
	cd web && npm run build

api:
	uv run quviz serve

refs:
	uv run --group docs python scripts/render_reference_index.py

check: lint typecheck test docs web-test web-build

# Network-dependent, so deliberately outside `check`. BROKEN and SUSPECT fail;
# BLOCKED (a 401/403 from a known bot-filter host, or a 429 rate limit from any
# host) is tolerated, here and under `--changed-since <ref>` (CI runs that on
# every push and pull request) alike. Cite bot-filter hosts by DOI.
links:
	uv run --group docs python scripts/check_links.py --include-doi
