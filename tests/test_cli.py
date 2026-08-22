from __future__ import annotations

from pathlib import Path

import numpy as np
from typer.testing import CliRunner

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
    calls: list[tuple[str, str, int, bool]] = []

    def fake_run(target: str, *, host: str, port: int, reload: bool) -> None:
        calls.append((target, host, port, reload))

    monkeypatch.setattr("quviz.cli.uvicorn.run", fake_run)
    result = runner.invoke(app, ["serve", "--host", "0.0.0.0", "--port", "8123", "--reload"])
    assert result.exit_code == 0, result.stdout
    assert calls == [("quviz.api.app:app", "0.0.0.0", 8123, True)]


def test_doctor_reports_repository_assets() -> None:
    result = runner.invoke(app, ["doctor"])
    assert result.exit_code == 0
    assert "references.bib" in result.stdout
    assert "mkdocs.yml" in result.stdout
    assert "frontend package" in result.stdout
    assert "frontend build" in result.stdout
    assert "missing" in result.stdout
