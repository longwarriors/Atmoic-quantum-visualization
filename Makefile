.PHONY: sync test lint typecheck docs web web-build api dev refs check

sync:
	uv sync --all-groups
	cd web && npm install

test:
	uv run pytest --cov=quviz --cov-report=term-missing

lint:
	uv run ruff check .
	uv run ruff format --check .

typecheck:
	uv run mypy

docs:
	uv run --group docs python scripts/render_reference_index.py
	uv run --group docs mkdocs build --strict

web:
	cd web && npm run dev

web-build:
	cd web && npm run build

api:
	uv run quviz serve

refs:
	uv run --group docs python scripts/render_reference_index.py

check: lint typecheck test docs web-build
