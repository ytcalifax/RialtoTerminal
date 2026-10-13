from __future__ import annotations

import re
import threading
import time
from collections import defaultdict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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

# This ranks stories for a risk-monitor terminal; it is a deterministic display
# heuristic, not an assessment of truth or a market forecast.
_RISK_TERMS = re.compile(
    r"\b(attack|attacked|strike|strikes|missile|drone|war|conflict|clash|"
    r"ceasefire|invasion|sanction|sanctions|shipping|tanker|strait|port|"
    r"blockade|disruption|outage|cyberattack|explosion|evacuat|casualt|"
    r"oil|crude|gas|brent|energy|pipeline|nuclear|earthquake|flood|"
    r"wildfire|epidemic|outbreak|pandemic|central bank|inflation|tariff)\b",
    re.IGNORECASE,
)
_HIGH_URGENCY_TERMS = re.compile(
    r"\b(attack|attacked|strike|missile|drone|explosion|killed|dead|"
    r"emergency|evacuat|blockade|closed|halt|outage|breaking)\b",
    re.IGNORECASE,
)


def _rank_news(rows: list[dict], now: float | None = None) -> list[dict]:
    """Rank risk-monitor headlines by topical relevance and freshness.

    The rank is an ordering aid only. The reason tags are exported with each
    item so the UI can explain why a story was promoted.
    """
    now = time.time() if now is None else now
    ranked: list[tuple[float, float, dict]] = []
    for row in rows:
        title = str(row.get("title") or "")
        category = str(row.get("category") or "")
        published = parse_timestamp(row.get("published", ""))
        age_hours = max(0.0, (now - published) / 3600) if published else float("inf")
        reasons: list[str] = []
        topical = bool(_RISK_TERMS.search(title))
        urgency = bool(_HIGH_URGENCY_TERMS.search(title))
        category_relevant = bool(re.search(r"conflict|security|energy|markets|business|health|disaster", category, re.I))
        if topical:
            reasons.append("RISK TOPIC")
        if urgency:
            reasons.append("URGENT WORDING")
        if category_relevant:
            reasons.append("RELEVANT SECTION")
        if age_hours <= 1:
            freshness = 4
        elif age_hours <= 6:
            freshness = 3
        elif age_hours <= 24:
            freshness = 2
        elif age_hours <= 72:
            freshness = 1
        else:
            freshness = 0
        if freshness:
            reasons.append("FRESH")
        score = (2 * topical) + (2 * urgency) + category_relevant + freshness
        row["priorityScore"] = int(score)
        row["priorityReasons"] = reasons or ["RECENCY ONLY"]
        host = (urlsplit(str(row.get("url") or "")).hostname or "").lower()
        row["publisherDomain"] = host.removeprefix("www.") or "UNKNOWN"
        ranked.append((score, published or 0, row))
    # Keep relevance tiers intact; within a tier, rotate publisher domains so
    # one prolific outlet does not occupy every adjacent slot.
    buckets: dict[int, list[tuple[float, float, dict]]] = defaultdict(list)
    for item in ranked:
        buckets[int(item[0])].append(item)
    output: list[dict] = []
    for score in sorted(buckets, reverse=True):
        domains: dict[str, list[tuple[float, float, dict]]] = defaultdict(list)
        for item in sorted(buckets[score], key=lambda entry: entry[1], reverse=True):
            domains[item[2]["publisherDomain"]].append(item)
        while domains:
            for domain in sorted(tuple(domains)):
                output.append(domains[domain].pop(0)[2])
                if not domains[domain]:
                    del domains[domain]
    return output


def google_news(
    query: str,
    language: str = "en",
    country: str = "US",
    edition: str = "US:en",
) -> list[dict]:
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
    seen_urls: dict[str, dict] = {}
    seen_titles: dict[str, dict] = {}
    output: list[dict] = []
    for row in rows:
        parts = urlsplit(row["url"])
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        query = [
            (key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.casefold() not in {"fbclid", "gclid", "dclid", "msclkid", "ref_src"}
            and not key.casefold().startswith("utm_")
        ]
        canonical = urlunsplit((parts.scheme.casefold(), parts.netloc.casefold(), parts.path.rstrip("/"), urlencode(sorted(query), doseq=True), ""))
        title_key = re.sub(r"[^\w]+", "", row["title"].casefold())
        domain = (parts.hostname or "").lower().removeprefix("www.") or "UNKNOWN"
        duplicate = seen_urls.get(canonical) or seen_titles.get(title_key)
        if duplicate:
            # Keep exact-title syndications as one story for scoring while
            # retaining the publisher provenance for inspection. Multiple
            # copies of one headline do not count as independent reports.
            domains = set(duplicate.get("publisherDomains", []))
            if domain != "UNKNOWN":
                domains.add(domain)
            duplicate["publisherDomains"] = sorted(domains)
            labels = set(duplicate.get("syndicatedSources", []))
            if row.get("source"):
                labels.add(str(row["source"]))
            duplicate["syndicatedSources"] = sorted(labels)
            duplicate["syndicationCount"] = len(domains)
            continue
        row["url"] = url
        row["publisherDomain"] = domain
        row["publisherDomains"] = [domain] if domain != "UNKNOWN" else []
        row["syndicatedSources"] = [str(row["source"])] if row.get("source") else []
        row["syndicationCount"] = len(row["publisherDomains"])
        output.append(row)
        seen_urls[canonical] = row
        seen_titles[title_key] = row
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
    output = _rank_news(output)
    available_count = len(output)
    # Retain the complete deduplicated set. Ranking changes display order, but
    # threshold signals compare adjacent time windows and must see the same
    # population instead of a relevance-filtered prefix.
    returned = output
    return {
        "items": returned,
        "availableCount": available_count,
        "returnedCount": len(returned),
        "truncated": available_count > len(returned),
        "publisherDomainCount": len({domain for item in returned for domain in item.get("publisherDomains", [item["publisherDomain"]]) if domain != "UNKNOWN"}),
        "ranking": "risk-topic relevance, urgent wording, freshness, then publisher-domain rotation within equal relevance tiers; reasons attached to each row; deterministic display heuristic, not a forecast",
        "feed": feed,
        "country": country,
        "query": term,
        "sources": statuses,
        "sourceCount": sum(bool(status["ok"]) for status in statuses),
        "fetched": time.time(),
    }


def _google_balkan_config(code: str) -> dict[str, str]:
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
