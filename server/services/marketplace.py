"""Marketplace listing service (Bazar.bg public index).

The broad public index covers all categories; rows are capped to keep the
response bounded. Listings are metadata plus outbound links only — pricing
and availability remain with the publisher.
"""
from __future__ import annotations

import time

from ..config import BAZAR_LISTINGS_URL
from ..core.cache import TTLCache
from ..core.http_client import fetch
from ..core.parsing.listings import ListingParser

_SOURCE_LABEL = "Bazar.bg · All categories"
_DEFAULT_LIMIT = 80
_LIMIT_CAP = 100
_MARKETPLACE_CACHE: TTLCache[list[dict]] = TTLCache(180)


def _clamp_limit(limit) -> int:
    """Coerce ``limit`` to a sane integer in ``[1, _LIMIT_CAP]``.

    Query strings are untrusted, so non-numeric input falls back to the
    default instead of raising, and extremes are clamped.
    """
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return _DEFAULT_LIMIT
    return max(1, min(_LIMIT_CAP, value))


def listing_search(query: str = "", limit=_DEFAULT_LIMIT) -> dict:
    """Return public listings, optionally filtered by a keyword.

    Never raises: on upstream failure the payload carries ``error`` and an
    empty list, and the UI shows a retry path alongside the direct link.
    """
    limit = _clamp_limit(limit)
    try:
        cached_rows = _MARKETPLACE_CACHE.get("all")
        if cached_rows is None:
            body = fetch(BAZAR_LISTINGS_URL, "text/html").decode("utf-8", "replace")
            parser = ListingParser()
            parser.feed(body)
            cached_rows = parser.rows
            _MARKETPLACE_CACHE.store("all", cached_rows)

        seen: set[str] = set()
        rows: list[dict] = []
        for row in cached_rows:
            if row["url"] in seen:
                continue
            seen.add(row["url"])
            haystack = " ".join((row["title"], row["location"], row["price"])).casefold()
            if not query or query.casefold() in haystack:
                rows.append(row)
            if len(rows) >= limit:
                break
        return {
            "items": rows,
            "source": _SOURCE_LABEL,
            "url": BAZAR_LISTINGS_URL,
            "limit": limit,
            "fetched": time.time(),
        }
    except Exception as exc:
        return {
            "items": [],
            "source": _SOURCE_LABEL,
            "error": str(exc),
            "url": BAZAR_LISTINGS_URL,
            "limit": limit,
        }
