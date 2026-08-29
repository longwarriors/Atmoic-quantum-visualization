"""Domain exceptions for expected scientific-computation refusals."""

from __future__ import annotations


class ScientificComputationError(RuntimeError):
    """A scientifically expected numerical failure for otherwise valid input.

    API routes translate this exception to an explanatory 422 response.  It is
    deliberately narrower than :class:`RuntimeError`: interpreter failures such
    as :class:`RecursionError`, and ordinary programming defects, must remain
    server errors instead of being mislabeled as problems with the request.
    """
