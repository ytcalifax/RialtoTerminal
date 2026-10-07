"""News aggregation service.

Fans a configurable feed list out in parallel, falls back to cached items
per feed when an upstream fails, optionally narrows by search term via the
Google News index, then deduplicates and sorts the merged timeline.
"""
from __future__ import annotations

import re
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

from ...config import GOOGLE_NEWS_SEARCH_URL, NEWS_TTL_S
from ...core.cache import TTLCache
from ...core.parsing.rss import rss_items
from ...core.pool import shared_pool
from ...core.text import clean, parse_timestamp
from .feeds import NEWS_FEEDS

# Per-feed cache: on upstream failure the last good rows are served stale.
_feed_cache: TTLCache[list[dict]] = TTLCache(NEWS_TTL_S)

# Google News result rows that came from an explicit search are tagged so the
# term filter below cannot discard them even when the term is absent from the
# headline itself.
_DIRECT_QUERY_TAG = "directQuery"


def google_news(
    query: str,
    language: str = "en",
    country: str = "US",
    edition: str = "US:en",
) -> list[dict]:
    """Query the Google News RSS index and normalise its rows."""
    params = urlencode({"q": query, "hl": language, "gl": country, "ceid": edition})
    is_bulgarian = country == "BG"
    return rss_items(
        GOOGLE_NEWS_SEARCH_URL + "?" + params,
        "GOOGLE NEWS",
        "BULGARIA" if is_bulgarian else "WORLD",
        "BULGARIA" if is_bulgarian else "GLOBAL",
        language,
    )


def _cached_feed(config: dict) -> tuple[list[dict], dict]:
    """Fetch one feed, or serve its cached rows when the upstream fails.

    Returns ``(rows, status)`` where ``status`` describes the outcome for the
    UI's feed-health strip. Never raises: a broken feed must not take the
    whole news request down.
    """
    feed_id = config["id"]
    now = time.time()
    cached = _feed_cache.get_entry(feed_id)

    if cached and now - cached.checked_at < NEWS_TTL_S:
        return cached.value, {
            "id": feed_id, "source": config["source"], "ok": True,
            "count": len(cached.value), "stale": False,
        }
    try:
        rows = rss_items(
            config["url"],
            config["source"],
            config["category"],
            config["region"],
            config.get("language", ""),
        )
        _feed_cache.store(feed_id, rows)
        return rows, {
            "id": feed_id, "source": config["source"], "ok": True,
            "count": len(rows), "stale": False,
        }
    except Exception as exc:
        if cached:
            return cached.value, {
                "id": feed_id, "source": config["source"], "ok": False,
                "count": len(cached.value), "stale": True,
                "error": str(exc)[:120],
            }
        return [], {
            "id": feed_id, "source": config["source"], "ok": False,
            "count": 0, "stale": False, "error": str(exc)[:120],
        }


def _deduplicate(rows: list[dict]) -> list[dict]:
    """Drop repeats by canonical URL and normalised title, in arrival order.

    Tracking parameters are stripped so publishers' campaign links collapse
    onto one canonical form.
    """
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    output: list[dict] = []
    for row in rows:
        parts = urlsplit(row["url"])
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        canonical = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        canonical = canonical.rstrip("/").casefold()
        title_key = re.sub(r"[^\w]+", "", row["title"].casefold())
        if canonical in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(canonical)
        seen_titles.add(title_key)
        row["url"] = url
        output.append(row)
    return output


def aggregate_news(feed: str = "global", query: str = "") -> dict:
    """Merge all configured feeds into the news payload served to the UI.

    ``feed`` selects the publisher set (``global`` or ``bulgaria``); a
    non-empty ``query`` filters by headline/source and adds a Google News
    search so fresh stories are reachable before they hit the static feeds.
    """
    term = clean(query)
    selected = [
        config for config in NEWS_FEEDS
        if feed != "bulgaria" or config["region"] in {"BULGARIA", "BALKANS"}
    ]

    batches = list(shared_pool().map(_cached_feed, selected))
    results = [row for batch, _ in batches for row in batch]
    statuses = [status for _, status in batches]

    if feed == "bulgaria":
        rows, status = _google_bulgaria(term)
        results.extend(rows)
        statuses.append(status)

    if term:
        results = [
            row for row in results
            if row.get(_DIRECT_QUERY_TAG)
            or term.casefold() in row["title"].casefold()
            or term.casefold() in row["source"].casefold()
        ]
        if feed != "bulgaria":
            searched_rows, search_status = _google_search(term)
            results.extend(searched_rows)
            statuses.append(search_status)

    output = _deduplicate(results)
    output.sort(key=lambda item: parse_timestamp(item.get("published", "")), reverse=True)
    return {
        "items": output[:160],
        "feed": feed,
        "query": term,
        "sources": statuses,
        "sourceCount": sum(bool(status["ok"]) for status in statuses),
        "fetched": time.time(),
    }


def _google_bulgaria(term: str) -> tuple[list[dict], dict]:
    """Bulgarian-language Google News slice for the BULGARIA feed view."""
    local_query = term or "site:bta.bg OR site:bnr.bg OR site:bntnews.bg OR site:btvnovinite.bg"
    try:
        rows = google_news(local_query, "bg", "BG", "BG:bg")
        for row in rows:
            if row["source"] == "GOOGLE NEWS":
                row["source"] = "BULGARIA · GOOGLE NEWS INDEX"
            if term:
                row[_DIRECT_QUERY_TAG] = True
        return rows, {"id": "google-bg", "source": "GOOGLE NEWS INDEX", "ok": True,
                      "count": len(rows), "stale": False}
    except Exception as exc:
        return [], {"id": "google-bg", "source": "GOOGLE NEWS INDEX", "ok": False,
                    "count": 0, "stale": False, "error": str(exc)[:120]}


def _google_search(term: str) -> tuple[list[dict], dict]:
    """Global Google News search for the current headline query."""
    try:
        rows = google_news(term, "en", "US", "US:en")
        return rows, {"id": "google-search", "source": "GOOGLE NEWS SEARCH", "ok": True,
                      "count": len(rows), "stale": False}
    except Exception as exc:
        return [], {"id": "google-search", "source": "GOOGLE NEWS SEARCH", "ok": False,
                    "count": 0, "stale": False, "error": str(exc)[:120]}
