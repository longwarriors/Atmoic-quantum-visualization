"""Compact binary formats for browser-side typed arrays."""

from __future__ import annotations

import struct

import numpy as np

from quviz.sampling.point_cloud import OrbitalPointCloud

POINT_CLOUD_MAGIC = b"QVPC"
POINT_CLOUD_VERSION = 1
POINT_CLOUD_STRIDE = 5  # x, y, z, normalized intensity, phase
_HEADER = struct.Struct("<4sHHII")


def encode_point_cloud(cloud: OrbitalPointCloud) -> bytes:
    """Encode a point cloud as a fixed-header little-endian Float32 stream."""

    count = int(cloud.positions.shape[0])
    if cloud.positions.shape != (count, 3):
        raise ValueError("positions must have shape (count, 3)")
    if cloud.intensity.shape != (count,) or cloud.phase.shape != (count,):
        raise ValueError("intensity and phase must have shape (count,)")

    interleaved = np.empty((count, POINT_CLOUD_STRIDE), dtype="<f4")
    interleaved[:, :3] = cloud.positions
    interleaved[:, 3] = cloud.intensity
    interleaved[:, 4] = cloud.phase
    header = _HEADER.pack(
        POINT_CLOUD_MAGIC,
        POINT_CLOUD_VERSION,
        0,
        count,
        POINT_CLOUD_STRIDE,
    )
    return header + interleaved.tobytes(order="C")
