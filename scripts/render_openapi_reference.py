"""Render the live FastAPI query contract as deterministic Markdown.

The hand-written HTTP API page explains scientific semantics and fail-closed
conditions. This generated companion owns the mechanical facts that otherwise
drift fastest: endpoint inventory, query defaults and schema bounds, and 200
response media types.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from quviz.api.app import app

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "reference" / "http-schema.md"
CONSTRAINT_KEYS = (
    "minimum",
    "exclusiveMinimum",
    "maximum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
)


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _resolve_ref(document: dict[str, Any], ref: str) -> dict[str, Any]:
    prefix = "#/components/schemas/"
    if not ref.startswith(prefix):
        raise ValueError(f"unsupported OpenAPI reference: {ref}")
    resolved = document["components"]["schemas"][ref.removeprefix(prefix)]
    if not isinstance(resolved, dict):
        raise TypeError(f"OpenAPI reference {ref} did not resolve to an object")
    return resolved


def _type_label(document: dict[str, Any], schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        resolved = _resolve_ref(document, str(schema["$ref"]))
        enum = resolved.get("enum")
        if isinstance(enum, list):
            return " / ".join(f"`{value}`" for value in enum)
        return str(resolved.get("title", str(schema["$ref"]).rsplit("/", 1)[-1]))
    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        labels = [
            _type_label(document, branch) for branch in any_of if branch.get("type") != "null"
        ]
        return " / ".join(labels) + " / `null`"
    kind = str(schema.get("type", "unspecified"))
    if kind == "array" and isinstance(schema.get("items"), dict):
        return f"array[{_type_label(document, schema['items'])}]"
    return kind


def _constraints(schema: dict[str, Any]) -> str:
    labels = {
        "minimum": "min",
        "exclusiveMinimum": ">",
        "maximum": "max",
        "exclusiveMaximum": "<",
        "minLength": "minLength",
        "maxLength": "maxLength",
        "pattern": "pattern",
    }
    parts = [f"{labels[key]} `{_json(schema[key])}`" for key in CONSTRAINT_KEYS if key in schema]
    if not parts and isinstance(schema.get("anyOf"), list):
        nested = [
            value
            for branch in schema["anyOf"]
            if branch.get("type") != "null"
            for value in [_constraints(branch)]
            if value != "—"
        ]
        parts.extend(nested)
    return "; ".join(parts) if parts else "—"


def _cell(value: object) -> str:
    return str(value).replace("|", r"\|").replace("\n", "<br>")


def render(document: dict[str, Any] | None = None) -> str:
    schema = app.openapi() if document is None else document
    lines = [
        "# HTTP schema (自动生成)",
        "",
        '!!! warning "不要手工编辑本页"',
        "",
        "    本页由 `scripts/render_openapi_reference.py` 直接读取 FastAPI 的 live OpenAPI schema 生成。",
        "    查询参数、默认值、外层 schema 边界或响应媒体类型变更后, `--check` 会要求同步提交本页。",
        "    参数之间的关系、数值收敛条件与 422 原因见[HTTP API 科学语义](api.md)。",
        "",
    ]
    paths = schema.get("paths")
    if not isinstance(paths, dict):
        raise TypeError("OpenAPI document has no paths object")
    for path in sorted(value for value in paths if str(value).startswith("/api/")):
        operation = paths[path].get("get")
        if not isinstance(operation, dict):
            continue
        lines.extend([f"## `GET {path}`", ""])
        parameters = operation.get("parameters", [])
        if parameters:
            lines.extend(
                [
                    "| 查询参数 | 类型 / 枚举 | 必填 | 默认值 | OpenAPI 外层约束 |",
                    "|---|---|---:|---|---|",
                ]
            )
            for parameter in parameters:
                parameter_schema = parameter.get("schema", {})
                default = parameter_schema.get("default", "—")
                default_text = f"`{_json(default)}`" if default != "—" else "—"
                row = (
                    f"| `{_cell(parameter['name'])}` | {_cell(_type_label(schema, parameter_schema))} | "
                    f"{'是' if parameter.get('required') else '否'} | {default_text} | "
                    f"{_cell(_constraints(parameter_schema))} |"
                )
                lines.append(row)
            lines.append("")
        else:
            lines.extend(["无查询参数。", ""])

        response = operation.get("responses", {}).get("200", {})
        content = response.get("content", {}) if isinstance(response, dict) else {}
        media_types = sorted(content) if isinstance(content, dict) else []
        rendered_types = ", ".join(f"`{value}`" for value in media_types) or "未声明"
        lines.extend([f"成功响应媒体类型: {rendered_types}。", ""])

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail instead of rewriting on drift")
    args = parser.parse_args()
    rendered = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            raise SystemExit(
                f"{OUTPUT.relative_to(ROOT)} is stale; run "
                "`uv run python scripts/render_openapi_reference.py` and review the API diff"
            )
        print(f"{OUTPUT.relative_to(ROOT)} is current")
        return 0
    OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"{OUTPUT.relative_to(ROOT)} ({len(rendered.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
