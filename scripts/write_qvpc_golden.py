"""Regenerate the QVPC/1 cross-language contract fixture.

The committed ``tests/fixtures/qvpc_golden.bin`` is the exact byte stream the
Python encoder must produce and the TypeScript parser must consume. Run this
only when the format version deliberately changes -- a surprise diff here means
the wire format moved, which is a breaking change for the frontend.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from quviz.sampling.point_cloud import OrbitalPointCloud
from quviz.scene.binary import encode_point_cloud

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def build() -> bytes:
    spec = json.loads((FIXTURES / "qvpc_golden.json").read_text(encoding="utf-8"))
    cloud = OrbitalPointCloud(
        positions=np.asarray(spec["positions"], dtype=np.float32),
        intensity=np.asarray(spec["intensity"], dtype=np.float32),
        phase=np.asarray(spec["phase"], dtype=np.float32),
        radial_mass_captured=1.0,
        extent_bohr=100.0,
    )
    return encode_point_cloud(cloud)


if __name__ == "__main__":
    target = FIXTURES / "qvpc_golden.bin"
    target.write_bytes(build())
    print(f"{target} ({target.stat().st_size} bytes)")
