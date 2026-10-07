"""Text and timestamp helpers shared by the parsers."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


def clean(value: str | None) -> str:
    """Collapse all whitespace runs to single spaces and trim the ends."""
    return re.sub(r"\s+", " ", value or "").strip()


def parse_timestamp(value: str | None) -> float:
    """Best-effort Unix timestamp for a feed date string.

    Publishers are inconsistent, so three formats are attempted in order:
    RFC 822 (RSS ``pubDate``), ISO 8601 (Atom, with or without ``Z``) and the
    compact basic-ISO form some feeds emit. Returns ``0.0`` when nothing
    parses so callers can still sort rows deterministically instead of
    crashing on one malformed date.
    """
    if not value:
        return 0.0
    try:
        val_float = float(value)
        if val_float > 1e11:
            val_float /= 1000.0
        return val_float
    except (TypeError, ValueError):
        pass
    try:
        return parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        naive = datetime.strptime(value[:15], "%Y%m%dT%H%M%S")
        return naive.replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0
