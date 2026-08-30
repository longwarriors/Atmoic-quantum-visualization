from __future__ import annotations

from pathlib import Path

import numpy as np
from typer.testing import CliRunner

import quviz.cli as cli_module
from quviz import __version__
from quviz.cli import app

runner = CliRunner()


def test_version_command() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == __version__


def test_sample_command_writes_reproducible_npz(tmp_path: Path) -> None:
    output = tmp_path / "nested" / "cloud.npz"
    result = runner.invoke(
        app,
        [
            "sample",
            str(output),
            "--n",
            "1",
            "--l",
            "0",
            "--m",
            "0",
            "--count",
            "100",
            "--seed",
            "4",
        ],
    )
    assert result.exit_code == 0, result.stdout
    assert output.exists()
    with np.load(output) as payload:
        assert payload["positions"].shape == (100, 3)
        assert payload["intensity"].shape == (100,)
        assert float(payload["radial_mass_captured"]) > 0.999


def test_serve_command_forwards_options(monkeypatch) -> None:
    calls: list[tuple[str, str, int, bool, list[str] | None]] = []

    def fake_run(
        target: str,
        *,
        host: str,
        port: int,
        reload: bool,
        reload_dirs: list[str] | None,
    ) -> None:
        calls.append((target, host, port, reload, reload_dirs))

    monkeypatch.setattr("quviz.cli.uvicorn.run", fake_run)
    result = runner.invoke(app, ["serve", "--host", "0.0.0.0", "--port", "8123", "--reload"])
    assert result.exit_code == 0, result.stdout
    source_package = str(Path(cli_module.__file__).resolve().parent)
    assert calls == [("quviz.api.app:app", "0.0.0.0", 8123, True, [source_package])]


def test_serve_without_reload_does_not_configure_a_watch_directory(monkeypatch) -> None:
    calls: list[tuple[bool, list[str] | None]] = []

    def fake_run(
        target: str,
        *,
        host: str,
        port: int,
        reload: bool,
        reload_dirs: list[str] | None,
    ) -> None:
        assert target == "quviz.api.app:app"
        assert host == "127.0.0.1"
        assert port == 8000
        calls.append((reload, reload_dirs))

    monkeypatch.setattr("quviz.cli.uvicorn.run", fake_run)
    result = runner.invoke(app, ["serve"])
    assert result.exit_code == 0, result.stdout
    assert calls == [(False, None)]


def test_doctor_reports_repository_assets() -> None:
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0
    for label in ("references.bib", "mkdocs.yml", "frontend package", "frontend build"):
        line = next(line for line in result.stdout.splitlines() if label in line)
        assert {"ok", "missing"} & set(line.split())
