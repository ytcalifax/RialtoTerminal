"""Marketplace listing service (Bazar.bg public index).

The broad public index covers all categories; rows are capped to keep the
response bounded. Listings are metadata plus outbound links only — pricing
and availability remain with the publisher.
"""

from __future__ import annotations

import time
from urllib.parse import urlencode

from ..config import BAZAR_LISTINGS_URL
from ..core.cache import TTLCache
from ..core.http_client import fetch
from ..core.parsing.listings import ListingParser

_SOURCE_LABEL = "Bazar.bg"
_DEFAULT_LIMIT = 80
_LIMIT_CAP = 100
_MARKETPLACE_CACHE: TTLCache[list[dict]] = TTLCache(180)


def _clamp_limit(limit: str | int) -> int:
    """Coerce ``limit`` to a sane integer in ``[1, _LIMIT_CAP]``.

    Query strings are untrusted, so non-numeric input falls back to the
    default instead of raising, and extremes are clamped.
    """
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return _DEFAULT_LIMIT
    return max(1, min(_LIMIT_CAP, value))


def listing_search(query: str = "", limit: str | int = _DEFAULT_LIMIT) -> dict:
    """Return public listings, using Bazar's own text search for keywords.

    Never raises: on upstream failure the payload carries ``error`` and an
    empty list, and the UI shows a retry path alongside the direct link.
    """
    limit = _clamp_limit(limit)
    query = " ".join((query or "").split())[:100]
    search_url = (
        f"{BAZAR_LISTINGS_URL}?{urlencode({'q': query})}" if query else BAZAR_LISTINGS_URL
    )
    cache_key = f"query:{query.casefold()}" if query else "all"
    try:
        cached_rows = _MARKETPLACE_CACHE.get(cache_key)
        if cached_rows is None:
            body = fetch(search_url, "text/html").decode("utf-8", "replace")
            parser = ListingParser()
            parser.feed(body)
            cached_rows = parser.rows
            _MARKETPLACE_CACHE.store(cache_key, cached_rows)

        seen: set[str] = set()
        rows: list[dict] = []
        for row in cached_rows:
            if row["url"] in seen:
                continue
            seen.add(row["url"])
            # Search is performed upstream; retain this check as a guard
            # against recommendation/sidebar links in Bazar's HTML.
            haystack = " ".join((row["title"], row["location"], row["price"])).casefold()
            if not query or query.casefold() in haystack:
                rows.append(row)
            if len(rows) >= limit:
                break
        return {
            "items": rows,
            "source": f"{_SOURCE_LABEL} · {query}" if query else f"{_SOURCE_LABEL} · All categories",
            "url": search_url,
            "limit": limit,
            "fetched": time.time(),
        }
    except Exception as exc:
        return {
            "items": [],
            "source": _SOURCE_LABEL,
            "error": str(exc),
            "url": search_url,
            "limit": limit,
        }
