"""The generated HTTP parameter reference must stay tied to live OpenAPI."""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

from quviz.api.app import app

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "render_openapi_reference.py"
OUTPUT = ROOT / "docs" / "reference" / "http-schema.md"


def _load_script(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


renderer = _load_script(SCRIPT)


def test_generated_http_reference_is_current() -> None:
    assert OUTPUT.read_text(encoding="utf-8") == renderer.render()


def test_every_live_api_get_operation_has_one_generated_section() -> None:
    rendered = renderer.render()
    paths = [path for path, item in app.openapi()["paths"].items() if "get" in item]
    for path in paths:
        assert rendered.count(f"## `GET {path}`") == 1


def test_query_default_mutation_changes_the_generated_reference() -> None:
    document: dict[str, Any] = app.openapi()
    mutated: dict[str, Any] = copy.deepcopy(document)
    parameters = mutated["paths"]["/api/orbitals/point-cloud"]["get"]["parameters"]
    samples = next(parameter for parameter in parameters if parameter["name"] == "samples")
    samples["schema"]["default"] = 12345

    assert renderer.render(mutated) != renderer.render(document)
    assert "`12345`" in renderer.render(mutated)
