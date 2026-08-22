"""QuViz command-line interface."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import typer
import uvicorn

from quviz import __version__
from quviz.conventions import BasisKind
from quviz.sampling.point_cloud import sample_orbital_point_cloud

app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False)


@app.command()
def version() -> None:
    """Print the installed QuViz version."""

    typer.echo(__version__)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Bind address."),
    port: int = typer.Option(8000, min=1, max=65535, help="HTTP port."),
    reload: bool = typer.Option(False, help="Reload when Python files change."),
) -> None:
    """Run the scientific API and, when built, the production frontend."""

    uvicorn.run("quviz.api.app:app", host=host, port=port, reload=reload)


@app.command()
def sample(
    output: Path = typer.Argument(Path("outputs/orbital_points.npz")),
    n: int = typer.Option(2),
    l: int = typer.Option(1),
    m: int = typer.Option(0),
    basis: BasisKind = typer.Option(BasisKind.REAL),
    count: int = typer.Option(20_000, min=100, max=200_000),
    seed: int = typer.Option(7, min=0),
) -> None:
    """Export a reproducible point cloud for offline analysis."""

    cloud = sample_orbital_point_cloud(n, l, m, basis=basis, count=count, seed=seed)
    output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        output,
        positions=cloud.positions,
        intensity=cloud.intensity,
        phase=cloud.phase,
        radial_mass_captured=cloud.radial_mass_captured,
    )
    typer.echo(str(output))


@app.command()
def doctor() -> None:
    """Check the repository's expected development assets."""

    root = Path(__file__).resolve().parents[2]
    checks = {
        "references.bib": root / "references.bib",
        "mkdocs.yml": root / "mkdocs.yml",
        "frontend package": root / "web" / "package.json",
        "frontend build": root / "web" / "dist" / "index.html",
    }
    for label, path in checks.items():
        status = "ok" if path.exists() else "missing"
        typer.echo(f"{label:20s} {status:8s} {path}")
