"""Market quote service.

Quotes come from Yahoo Finance's public chart endpoint (1-minute bars plus
the live consolidated last price); SOFIX, the Bulgarian blue-chip index, is
scraped from BSE Sofia's public widget because no free JSON endpoint exists.
Per-symbol failures return ``None`` so one dead symbol never breaks the
whole snapshot, and successful quotes are cached so repeated polls stay
within upstream courtesy limits.
"""

from __future__ import annotations

import html
import json
import re
import time
from email.utils import parsedate_to_datetime
from urllib.parse import quote

from ...config import (
    BSE_SOFIX_URL,
    MARKET_STALE_AFTER_S,
    MARKET_TTL_S,
    QUOTES_MAX_SYMBOLS,
    SEARCH_TTL_S,
    SOFIX_TIMEOUT_S,
    SOFIX_TTL_S,
    YAHOO_CHART_URL,
    YAHOO_SEARCH_URL,
)
from ...core.cache import TTLCache
from ...core.http_client import fetch, fetch_response
from ...core.pool import shared_pool
from ...core.text import clean
from .symbols import CORE_MARKETS, MARKET_GROUPS, SYMBOL_GROUP

_QUOTE_CACHE: TTLCache[dict] = TTLCache(MARKET_TTL_S)
_SOFIX_CACHE: TTLCache[dict] = TTLCache(SOFIX_TTL_S)
_SEARCH_CACHE: TTLCache[list] = TTLCache(SEARCH_TTL_S)

# Yahoo symbols: letters/digits plus the ^ . = - convention characters.
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9^.\-=]{1,15}$")

MARKET_SOURCE_NOTE = (
    "Yahoo Finance public chart endpoint · 1-minute bars + live last price; "
    "BSE Sofia SOFIX · 3-minute delay · indicative"
)


def _yahoo_quote(symbol: str, name: str | None = None) -> dict | None:
    """Return one quote row for ``symbol``, or ``None`` when unavailable.

    The row carries the last price, net/percent change, day range and the
    most recent 24 intraday closes (the sparkline series). ``name`` comes
    from the symbol universe when the caller knows it; otherwise it is
    resolved from Yahoo's own metadata. Failures — bad symbol, rate limit,
    schema change — degrade to ``None`` by design.
    """
    cached = _QUOTE_CACHE.get(symbol)
    if cached is not None:
        return dict(cached)
    if symbol == "^SOFIX":
        return None  # served by _bse_sofix_row, which scrapes the exchange

    try:
        url = YAHOO_CHART_URL.format(symbol=quote(symbol, safe=""))
        result = json.loads(fetch(url, "application/json"))["chart"]["result"][0]
        meta = result.get("meta") or {}
        resolved_name = name or meta.get("shortName") or meta.get("longName") or symbol
        timestamps = result.get("timestamp") or []
        quote_indicators = result.get("indicators", {}).get("quote") or []
        raw_closes = quote_indicators[0].get("close", []) if quote_indicators else []
        closes = [float(v) for v in raw_closes if isinstance(v, (int, float))]

        # The live last price is whichever is fresher: Yahoo's consolidated
        # regularMarketPrice or the newest 1-minute bar close.
        last_bar_time = timestamps[-1] if timestamps else 0
        regular_time = meta.get("regularMarketTime") or 0
        regular_price = meta.get("regularMarketPrice")
        if regular_price is not None and regular_time >= last_bar_time:
            last = regular_price
        else:
            last = closes[-1] if closes else regular_price
        if last is None:
            return None
        previous = (
            meta.get("chartPreviousClose")
            or meta.get("previousClose")
            or (closes[0] if closes else None)
        )
        change = (
            (last - previous) if (last is not None and previous is not None) else 0.0
        )
        pct = (change / previous * 100) if (previous and previous != 0) else None
        if previous is None:
            change = None
        asof = meta.get("regularMarketTime") or (timestamps[-1] if timestamps else 0)
        row = {
            "symbol": symbol,
            "name": resolved_name,
            "last": last,
            "change": change,
            "pct": pct,
            "low": min(closes) if closes else None,
            "high": max(closes) if closes else None,
            "series": closes[-24:],
            "currency": meta.get("currency", ""),
            "asof": asof,
            "stale": not asof or time.time() - asof > MARKET_STALE_AFTER_S,
            "group": SYMBOL_GROUP.get(symbol, "INDICES"),
        }
        _QUOTE_CACHE.store(symbol, dict(row))
        return dict(row)
    except Exception:
        # One unavailable symbol must not break the snapshot; the UI flags
        # the gap via the "expected" count and carries stale rows forward.
        return None


def _bse_sofix_row() -> dict:
    """Read the public BSE Sofia index widget (the exchange labels it 3 min delayed).

    Raises when the widget markup cannot be found or parsed; callers decide
    whether that is fatal. The exchange's ``Date`` response header is used as
    the snapshot time, falling back to local now if the header is missing.
    """
    now = time.time()
    cached = _SOFIX_CACHE.get("^SOFIX")
    if cached is not None:
        return dict(cached)

    body, headers = fetch_response(
        BSE_SOFIX_URL,
        accept="text/html",
        timeout=SOFIX_TIMEOUT_S,
    )
    page = body.decode("utf-8", "replace")
    try:
        source_time = parsedate_to_datetime(headers.get("Date", "")).timestamp()
    except (TypeError, ValueError, OverflowError):
        source_time = now

    # The index sits in the first row of the exchange's "top 5" widget.
    match = re.search(
        r'<div class="top5_row secondary" data-id="0">(.*?)(?=<div class="top5_row secondary")',
        page,
        re.S,
    )
    if not match:
        raise ValueError("BSE Sofia index widget unavailable")
    block = match.group(1)

    def field(class_name: str) -> str:
        found = re.search(
            r'<div class="' + re.escape(class_name) + r'"[^>]*>(.*?)</div>', block, re.S
        )
        return (
            clean(html.unescape(re.sub(r"<[^>]+>", " ", found.group(1))))
            if found
            else ""
        )

    def number(value: str) -> float:
        try:
            return float(value.replace(" ", "").replace(",", "."))
        except (ValueError, TypeError):
            return 0.0

    last = number(field("top5_issue_size primary"))
    pct_text = field("change green") or field("change red") or field("change")
    pct = 0.0
    if pct_text:
        try:
            pct = float(pct_text.replace("%", "").replace("+", "").replace(",", "."))
        except (ValueError, TypeError):
            pct = 0.0
    # The widget encodes direction via colour, not sign.
    if "change red" in block and "change green" not in block:
        pct = -abs(pct)
    change = number(field("top5_price_change_abs"))
    if pct < 0:
        change = -abs(change)
    # The widget's ask side bounds the low, its bid side the high.
    low_parts = field("top5_price_ask").split()
    low = number(low_parts[-1]) if low_parts else 0.0
    high_parts = field("top5_price_bid").split()
    high = number(high_parts[-1]) if high_parts else 0.0

    row = {
        "symbol": "^SOFIX",
        "name": "SOFIX",
        "last": last,
        "change": change,
        "pct": pct,
        "low": low,
        "high": high,
        "series": [],
        "currency": "EUR",
        "asof": source_time,
        "source": "BSE SOFIA · 3 MIN DELAY",
        "group": "INDICES",
    }
    _SOFIX_CACHE.store("^SOFIX", dict(row))
    return dict(row)


def market_snapshot(group: str = "CORE") -> dict:
    """Return the full quote payload for a market group.

    ``group`` is an upper-cased key of :data:`MARKET_GROUPS`, or ``CORE`` for
    the dashboard cross-section. Unknown groups fall back to ``CORE``.
    """
    symbols = (
        CORE_MARKETS if group == "CORE" else MARKET_GROUPS.get(group, CORE_MARKETS)
    )
    rows = [
        row
        for row in shared_pool().map(_quoted_pair, symbols.items())
        if row is not None
    ]
    if "^SOFIX" in symbols:
        try:
            rows.append(_bse_sofix_row())
        except Exception:
            # Keep the other quotes usable when the exchange site is unavailable.
            pass
    return {
        "items": rows,
        "group": group,
        "fetched": time.time(),
        "source": MARKET_SOURCE_NOTE,
        "expected": len(symbols),
    }


def _quoted_pair(pair: tuple[str, str]) -> dict | None:
    """Map a ``(symbol, name)`` pair through :func:`_yahoo_quote`."""
    return _yahoo_quote(*pair)


def search_symbols(query: str) -> dict:
    """Resolve free text into tradeable Yahoo symbols (name/type/exchange).

    Results are cached an hour — symbol directories barely change.
    """
    term = clean(query)[:40]
    if not term:
        return {"results": [], "query": ""}
    cache_key = term.casefold()
    cached = _SEARCH_CACHE.get(cache_key)
    if cached is not None:
        return {"results": cached, "query": term}
    data = json.loads(
        fetch(YAHOO_SEARCH_URL.format(query=quote(term)), "application/json")
    )
    results = []
    for entry in (data.get("quotes") or [])[:8]:
        symbol = entry.get("symbol")
        if not symbol or not _SYMBOL_RE.fullmatch(symbol):
            continue
        results.append(
            {
                "symbol": symbol,
                "name": entry.get("shortname") or entry.get("longname") or symbol,
                "type": entry.get("quoteType") or "",
                "exchange": entry.get("exchDisp") or entry.get("exchange") or "",
            }
        )
    _SEARCH_CACHE.store(cache_key, results)
    return {"results": results, "query": term}


def quotes_for_symbols(raw: str | None) -> dict:
    """Quotes for an explicit symbol list (the user's pinned dashboard set).

    Rows are tagged with the ``CUSTOM`` group so they surface under the
    custom tab and never mix into the universe groups. At most
    ``QUOTES_MAX_SYMBOLS`` symbols; malformed entries are skipped.
    """
    symbols: list[str] = []
    if raw:
        for part in raw.split(","):
            symbol = part.strip().upper()
            if symbol and _SYMBOL_RE.fullmatch(symbol) and symbol not in symbols:
                symbols.append(symbol)
            if len(symbols) >= QUOTES_MAX_SYMBOLS:
                break
    rows = [
        {**row, "group": "CUSTOM"}
        for row in shared_pool().map(lambda s: _yahoo_quote(s), symbols)
        if row is not None
    ]
    return {
        "items": rows,
        "group": "CUSTOM",
        "expected": len(symbols),
        "fetched": time.time(),
    }
