"""Parsing for citation groups that may carry page or section locators.

``docs/references/source-policy.md`` requires a core claim to record *where* in
a source it is supported -- a page, a section, a DOI or a source revision. That
is only enforceable if the citation syntax can express a locator, so a citation
group is ``[@key]``, ``[@key, locator]``, or several of those joined by ``;``.

Shared by the MkDocs extension and the reference-index script so the two cannot
drift apart on what counts as a valid citation.
"""

from __future__ import annotations

import re
from typing import NamedTuple

KEY_PATTERN = re.compile(r"^[A-Za-z0-9_:\-]+$")
GROUP_PATTERN = re.compile(r"(?<!\\)\[@([^\]]+)\]")


class CitationReference(NamedTuple):
    """One ``key`` with an optional ``locator`` such as ``p. 4`` or ``§14.30``."""

    key: str
    locator: str | None


def parse_citation_group(raw: str) -> list[CitationReference]:
    """Split a citation group body into references.

    Raises ``ValueError`` on anything that is not a well-formed key, which is
    what turns a typo into a failed documentation build rather than stray
    literal text in the rendered page.
    """

    references: list[CitationReference] = []
    for part in raw.split(";"):
        key_text, separator, locator_text = part.partition(",")
        key = key_text.strip().lstrip("@").strip()
        if not KEY_PATTERN.match(key):
            raise ValueError(
                f"malformed citation key {key!r} in '[@{raw}]'; expected [@key] or [@key, locator]"
            )
        locator = locator_text.strip() if separator else None
        if separator and not locator:
            raise ValueError(f"malformed citation locator in '[@{raw}]'; locator is empty")
        references.append(CitationReference(key, locator))
    if not references:
        raise ValueError(f"malformed citation '[@{raw}]'; no keys found")
    return references
