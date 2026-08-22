"""Numerical solvers with explicit grid and boundary-condition contracts."""

from .grid import DirichletGrid1D, PeriodicGrid1D

__all__ = ["DirichletGrid1D", "PeriodicGrid1D"]
