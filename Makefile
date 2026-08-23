.PHONY: sync test lint typecheck docs web web-test web-build api dev refs check links

sync:
	uv sync --all-groups
	cd web && npm install

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
# `--changed-since <ref>` (used by CI on pull requests) fails on anything not OK.
links:
	uv run --group docs python scripts/check_links.py --include-doi
