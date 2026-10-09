"""News aggregation service.

Fans a configurable feed list out in parallel, falls back to cached items
per feed when an upstream fails, optionally narrows by search term via the
Google News index, then deduplicates and sorts the merged timeline.
"""

from __future__ import annotations

import re
import threading
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

from ...config import GOOGLE_NEWS_SEARCH_URL, NEWS_TTL_S
from ...core.cache import TTLCache
from ...core.parsing.rss import rss_items
from ...core.pool import shared_pool
from ...core.text import clean, parse_timestamp
from .feeds import BALKAN_COUNTRIES, BALKAN_RSS_FEEDS, NEWS_FEEDS

# Per-feed cache: on upstream failure the last good rows are served stale.
_feed_cache: TTLCache[list[dict]] = TTLCache(NEWS_TTL_S)
# Multiple browser tabs can request the same feed at once. Serialize cache
# misses per feed so only the first caller reaches the publisher.
_feed_locks: dict[str, threading.Lock] = {}
_feed_locks_lock = threading.Lock()
_google_query_cache: TTLCache[list[dict]] = TTLCache(300, max_entries=128)

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
        country if country in BALKAN_COUNTRIES else "",
    )


def _cached_feed(config: dict) -> tuple[list[dict], dict]:
    """Fetch one feed, or serve its cached rows when the upstream fails.

    Returns ``(rows, status)`` where ``status`` describes the outcome for the
    UI's feed-health strip. Never raises: a broken feed must not take the
    whole news request down.
    """
    feed_id = config["id"]
    with _feed_locks_lock:
        lock = _feed_locks.setdefault(feed_id, threading.Lock())
    with lock:
        now = time.time()
        cached = _feed_cache.get_entry(feed_id)

        if cached and now - cached.checked_at < NEWS_TTL_S:
            return cached.value, {
                "id": feed_id,
                "source": config["source"],
                "ok": True,
                "count": len(cached.value),
                "stale": False,
            }
        try:
            rows = rss_items(
                config["url"],
                config["source"],
                config["category"],
                config["region"],
                config.get("language", ""),
                config.get("country", ""),
            )
            _feed_cache.store(feed_id, rows)
            return rows, {
                "id": feed_id,
                "source": config["source"],
                "ok": True,
                "count": len(rows),
                "stale": False,
            }
        except Exception as exc:
            if cached:
                return cached.value, {
                    "id": feed_id,
                    "source": config["source"],
                    "ok": False,
                    "count": len(cached.value),
                    "stale": True,
                    "error": str(exc)[:120],
                }
            return [], {
                "id": feed_id,
                "source": config["source"],
                "ok": False,
                "count": 0,
                "stale": False,
                "error": str(exc)[:120],
            }


def _deduplicate(rows: list[dict]) -> list[dict]:
    """Drop repeats by canonical URL and normalised title, in arrival order.

    Tracking parameters are stripped so publishers' campaign links collapse
    onto one canonical form.
    """
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    title_tokens: list[set[str]] = []
    output: list[dict] = []
    for row in rows:
        parts = urlsplit(row["url"])
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        canonical = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        canonical = canonical.rstrip("/").casefold()
        title_key = re.sub(r"[^\w]+", "", row["title"].casefold())
        tokens = {
            token for token in re.findall(r"[a-z0-9]{3,}", row["title"].casefold())
            if token not in {"the", "and", "for", "with", "from", "that", "this"}
        }
        duplicate_cluster = any(
            len(tokens & other) / max(1, min(len(tokens), len(other))) >= 0.65
            for other in title_tokens
        )
        if (
            canonical in seen_urls
            or title_key in seen_titles
            or duplicate_cluster
            or re.search(r"\bDATE\b", row["title"], re.IGNORECASE)
        ):
            continue
        seen_urls.add(canonical)
        seen_titles.add(title_key)
        title_tokens.append(tokens)
        row["url"] = url
        output.append(row)
    return output


def aggregate_news(feed: str = "global", query: str = "", country: str = "") -> dict:
    """Merge all configured feeds into the news payload served to the UI.

    ``feed`` selects the publisher set (``global`` or ``bulgaria``); a
    non-empty ``query`` filters by headline/source and adds a Google News
    search so fresh stories are reachable before they hit the static feeds.
    """
    term = clean(query)
    country = country.upper() if country.upper() in BALKAN_COUNTRIES else ""
    if feed == "balkans":
        selected = [
            config
            for config in (
                *(item for item in NEWS_FEEDS if item["id"] in {"novinite", "sofia-globe", "balkan-insight"}),
                *BALKAN_RSS_FEEDS,
            )
            if config.get("region") in {"BULGARIA", "BALKANS"}
            and (not country or config.get("country") == country)
        ]
        google_codes = [country] if country else list(BALKAN_COUNTRIES)
        selected.extend(_google_balkan_config(code) for code in google_codes)
    elif feed == "bulgaria":
        selected = [
            config
            for config in (*NEWS_FEEDS, *BALKAN_RSS_FEEDS)
            if config.get("region") in {"BULGARIA", "BALKANS"}
            and config.get("country") == "BG"
            and config.get("language", "en") == "en"
        ]
    else:
        selected = [config for config in NEWS_FEEDS if config.get("language", "en") == "en"]

    batches = list(shared_pool().map(_cached_feed, selected))
    results = [row for batch, _ in batches for row in batch]
    statuses = [status for _, status in batches]

    if feed == "bulgaria":
        rows, status = _google_bulgaria(term)
        results.extend(rows)
        statuses.append(status)

    if term:
        results = [
            row
            for row in results
            if row.get(_DIRECT_QUERY_TAG)
            or term.casefold() in row["title"].casefold()
            or term.casefold() in row["source"].casefold()
        ]
        if feed != "bulgaria":
            searched_rows, search_status = _google_search(term)
            results.extend(searched_rows)
            statuses.append(search_status)

    if feed == "balkans" and country:
        results = [row for row in results if row.get("country") == country]
    output = _deduplicate(results)
    output.sort(
        key=lambda item: parse_timestamp(item.get("published", "")), reverse=True
    )
    if feed == "balkans" and not country:
        # Keep the broad view balanced: one fast country feed cannot crowd
        # every other country out of the latest 160 rows.
        by_country = {
            code: [row for row in output if row.get("country") == code][:16]
            for code in BALKAN_COUNTRIES
        }
        general = [row for row in output if not row.get("country")][:24]
        output = [row for rank in range(16) for code in BALKAN_COUNTRIES if len(by_country[code]) > rank for row in [by_country[code][rank]]]
        output.extend(general)
        output.sort(key=lambda item: parse_timestamp(item.get("published", "")), reverse=True)
    return {
        "items": output[:240 if feed == "balkans" else 160],
        "feed": feed,
        "country": country,
        "query": term,
        "sources": statuses,
        "sourceCount": sum(bool(status["ok"]) for status in statuses),
        "fetched": time.time(),
    }


def _google_balkan_config(code: str) -> dict[str, str]:
    """Make a locale-specific Google News RSS config for one country."""
    details = BALKAN_COUNTRIES[code]
    params = urlencode(
        {
            "q": details["query"],
            "hl": details["locale"],
            "gl": code,
            "ceid": details["edition"],
        }
    )
    return {
        "id": f"google-balkan-{code.lower()}",
        "url": f"{GOOGLE_NEWS_SEARCH_URL}?{params}",
        "source": "GOOGLE NEWS INDEX",
        "category": details["name"].upper(),
        "region": "BALKANS",
        "language": details["locale"],
        "country": code,
    }


def _google_bulgaria(term: str) -> tuple[list[dict], dict]:
    """English-language Google News slice for Bulgarian news."""
    cache_key = f"bulgaria:{term.casefold()}"
    cached = _google_query_cache.get(cache_key)
    if cached is not None:
        return [dict(row) for row in cached], {
            "id": "google-bg", "source": "GOOGLE NEWS INDEX", "ok": True,
            "count": len(cached), "stale": False,
        }
    local_query = (
        term or "site:novinite.com OR site:sofiaglobe.com OR site:balkaninsight.com"
    )
    try:
        rows = google_news(local_query, "en", "BG", "BG:en")
        for row in rows:
            if row["source"] == "GOOGLE NEWS":
                row["source"] = "BULGARIA · GOOGLE NEWS INDEX"
            if term:
                row[_DIRECT_QUERY_TAG] = True
        _google_query_cache.store(cache_key, [dict(row) for row in rows])
        return rows, {
            "id": "google-bg",
            "source": "GOOGLE NEWS INDEX",
            "ok": True,
            "count": len(rows),
            "stale": False,
        }
    except Exception as exc:
        return [], {
            "id": "google-bg",
            "source": "GOOGLE NEWS INDEX",
            "ok": False,
            "count": 0,
            "stale": False,
            "error": str(exc)[:120],
        }


def _google_search(term: str) -> tuple[list[dict], dict]:
    """Global Google News search for the current headline query."""
    cache_key = f"search:{term.casefold()}"
    cached = _google_query_cache.get(cache_key)
    if cached is not None:
        return [dict(row) for row in cached], {
            "id": "google-search", "source": "GOOGLE NEWS SEARCH", "ok": True,
            "count": len(cached), "stale": False,
        }
    try:
        rows = google_news(term, "en", "US", "US:en")
        _google_query_cache.store(cache_key, [dict(row) for row in rows])
        return rows, {
            "id": "google-search",
            "source": "GOOGLE NEWS SEARCH",
            "ok": True,
            "count": len(rows),
            "stale": False,
        }
    except Exception as exc:
        return [], {
            "id": "google-search",
            "source": "GOOGLE NEWS SEARCH",
            "ok": False,
            "count": 0,
            "stale": False,
            "error": str(exc)[:120],
        }
