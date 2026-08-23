"""FastAPI application factory and optional production frontend mount."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from quviz import __version__
from quviz.api.routes import router


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def create_app(*, mount_frontend: bool = True) -> FastAPI:
    app = FastAPI(
        title="QuViz API",
        version=__version__,
        description="Physically explicit scene assets for browser-native quantum visualization.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
        expose_headers=["X-QuViz-Format", "X-QuViz-Radial-Mass", "X-QuViz-Extent-Bohr"],
    )
    app.include_router(router)

    web_dist = _repository_root() / "web" / "dist"
    if mount_frontend and web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    else:

        @app.get("/")
        def root() -> dict[str, str]:
            return {
                "name": "QuViz",
                "version": __version__,
                "message": "Run the Vite frontend on port 5173, or build web/dist for integrated serving.",
                "docs": "/docs",
            }

    return app


app = create_app()
