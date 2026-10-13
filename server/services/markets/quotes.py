from __future__ import annotations

import html
import json
import math
import re
import statistics
import threading
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

from ...config import (
    BSE_SOFIX_URL,
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
_QUOTE_FAILURE_CACHE: TTLCache[bool] = TTLCache(1, max_entries=512)
_SOFIX_CACHE: TTLCache[dict] = TTLCache(SOFIX_TTL_S)
_SEARCH_CACHE: TTLCache[list] = TTLCache(SEARCH_TTL_S)
_YAHOO_REQUEST_SLOTS = threading.BoundedSemaphore(4)
# Cache checks and upstream fetches must be one operation per symbol. A fixed
# stripe set coalesces duplicate misses without retaining arbitrary user keys.
_QUOTE_LOCKS = tuple(threading.Lock() for _ in range(16))

# Yahoo symbols: letters/digits plus the ^ . = - convention characters.
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9^.\-=]{1,15}$")

MARKET_SOURCE_NOTE = (
    "Yahoo Finance public chart endpoint · daily bars + consolidated last price; "
    "BSE Sofia SOFIX · 3-minute delay · indicative"
)

# Quote-age limits permit normal closed sessions/weekends without treating a
# feed that stops updating indefinitely as current. These are fallback bounds;
# they are not exchange holiday calendars.
_STALE_AFTER_BY_GROUP = {
    "INDICES": 72 * 60 * 60,
    "STOCKS": 72 * 60 * 60,
    "ETFS": 72 * 60 * 60,
    "COMMODITIES": 36 * 60 * 60,
    "RATES": 36 * 60 * 60,
    "FX": 36 * 60 * 60,
    "CRYPTO": 2 * 60 * 60,
}
_OPEN_STALE_AFTER_S = 15 * 60
_EXCHANGE_BY_SYMBOL = {
    "BZ=F": "ICE_BRENT",  # ICE Brent session uses London-local trading hours
    "^VIX": "XCBF",  # Cboe Futures Exchange VIX index sessions
    "CL=F": "CMES", "RB=F": "CMES", "HO=F": "CMES", "NG=F": "CMES",
    "GC=F": "CMES", "SI=F": "CMES", "ZW=F": "CMES",  # CBOT wheat uses CME Group calendar
    "^GSPC": "XNYS", "RTX": "XNYS", "LMT": "XNYS", "DAL": "XNYS",
    "TSM": "XNYS", "SMH": "XNYS", "XLE": "XNYS", "USO": "XNYS", "UNG": "XNYS",
}
_EXCHANGE_BY_YAHOO_NAME = {
    "NMS": "XNYS", "NGM": "XNYS", "NCM": "XNYS", "NYQ": "XNYS", "PCX": "XNYS",
    "BTS": "XNYS", "ASE": "XNYS", "CBO": "XCBF", "CBT": "CMES", "CMX": "CMES",
    "NYM": "CMES", "ICE": "IEPA", "LSE": "XLON", "GER": "XFRA", "PAR": "XPAR",
    "HKG": "XHKG", "JPX": "XTKS", "SHH": "XSHG", "TAI": "XTAI", "BSE": "XBOM",
}


def _exchange_calendar(symbol: str, group: str, meta: dict) -> str:
    if symbol in _EXCHANGE_BY_SYMBOL:
        return _EXCHANGE_BY_SYMBOL[symbol]
    if group == "CRYPTO":
        return "24/7"
    if group == "FX":
        return "24/5"
    return _EXCHANGE_BY_YAHOO_NAME.get(str(meta.get("exchangeName") or "").upper(), "UNKNOWN")


def _market_state(calendar_name: str, now: float) -> str:
    """Return the exchange-calendar state for the instrument at ``now``."""
    if calendar_name == "ICE_BRENT":
        try:
            import exchange_calendars as xcals
            from zoneinfo import ZoneInfo

            london_now = datetime.fromtimestamp(now, timezone.utc).astimezone(ZoneInfo("Europe/London"))
            business_calendar = xcals.get_calendar("XLON")
            if london_now.weekday() == 6:
                next_business_day = london_now.date() + timedelta(days=1)
                return "OPEN" if london_now.hour >= 22 and business_calendar.is_session(next_business_day.isoformat()) else "CLOSED"
            if london_now.weekday() < 5 and business_calendar.is_session(london_now.date().isoformat()):
                return "OPEN" if 1 <= london_now.hour < 23 else "CLOSED"
            return "CLOSED"
        except Exception:
            return "UNKNOWN"
    if calendar_name == "24/7":
        return "OPEN"
    if calendar_name == "24/5":
        instant = datetime.fromtimestamp(now, timezone.utc)
        return "CLOSED" if instant.weekday() == 5 or (instant.weekday() == 4 and instant.hour >= 21) or (instant.weekday() == 6 and instant.hour < 21) else "OPEN"
    if calendar_name:
        try:
            import exchange_calendars as xcals

            calendar = xcals.get_calendar(calendar_name)
            instant = datetime.fromtimestamp(now, timezone.utc)
            start = (instant.date() - timedelta(days=1)).isoformat()
            end = (instant.date() + timedelta(days=1)).isoformat()
            sessions = calendar.schedule.loc[start:end]
            for _, session in sessions.iterrows():
                opened = session["open"].timestamp()
                closed = session["close"].timestamp()
                if opened <= now < closed:
                    break_start = session["break_start"].timestamp() if session["break_start"] is not None and str(session["break_start"]) != "NaT" else None
                    break_end = session["break_end"].timestamp() if session["break_end"] is not None and str(session["break_end"]) != "NaT" else None
                    if break_start is not None and break_end is not None and break_start <= now < break_end:
                        return "BREAK"
                    return "OPEN"
            return "CLOSED"
        except Exception:
            return "UNKNOWN"
    return "UNKNOWN"


def _quote_staleness(asof: float, now: float, market_state: str, group: str) -> tuple[bool, int]:
    stale_after = _OPEN_STALE_AFTER_S if market_state == "OPEN" else _STALE_AFTER_BY_GROUP.get(group, 24 * 60 * 60)
    return (not asof or now - asof > stale_after), stale_after


def _change_reference(meta: dict, closes: list[float]) -> tuple[float | None, str | None]:
    """Use the last completed daily bar, not Yahoo's sometimes stale metadata field."""
    # Yahoo's chartPreviousClose has been observed to point at the first bar in
    # the requested range on several instruments. The bar immediately before
    # the latest daily bar is the preceding session close and keeps the move
    # daily. Fall back to metadata only when history has fewer than two bars.
    raw = closes[-2] if len(closes) >= 2 else meta.get("chartPreviousClose") or meta.get("previousClose")
    source = "precedingDailyBar" if len(closes) >= 2 else (
        "chartPreviousClose" if meta.get("chartPreviousClose") is not None else "previousClose"
    )
    if raw is None:
        return None, None
    try:
        previous = float(raw)
    except (TypeError, ValueError, OverflowError):
        return None, None
    reference = next((close for close in closes if close > 0), None)
    scale = previous / reference if reference else 1
    if not math.isfinite(previous) or previous <= 0 or scale < 0.1 or scale > 10:
        return None, None
    return previous, source


def _reference_consistency(previous: float | None, closes: list[float], metadata_reference: float | None = None) -> dict:
    """Expose Yahoo metadata discrepancies without allowing them into scoring."""
    if previous is None or len(closes) < 2 or closes[-2] <= 0:
        return {"status": "UNAVAILABLE", "comparison": "preceding completed daily bar from Yahoo", "differencePct": None}
    metadata_difference = abs(metadata_reference / previous - 1) * 100 if metadata_reference and previous else None
    if metadata_difference is not None and metadata_difference > 0.2:
        return {
            "status": "METADATA_DISAGREEMENT",
            "comparison": "Yahoo chart metadata versus preceding completed daily bar; scoring uses the daily bar",
            "differencePct": round(metadata_difference, 4),
            "tolerancePct": 0.2,
            "metadataReferencePrice": metadata_reference,
            "selectedReferencePrice": previous,
        }
    return {
        "status": "DAILY_BAR_SELECTED",
        "comparison": "preceding completed daily bar from Yahoo; not independent exchange verification",
        "differencePct": round(metadata_difference, 4) if metadata_difference is not None else 0,
        "tolerancePct": 0.2,
    }


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
        return {**cached, "name": name} if name else dict(cached)
    if symbol == "^SOFIX":
        return None  # served by _bse_sofix_row, which scrapes the exchange

    quote_lock = _QUOTE_LOCKS[hash(symbol) % len(_QUOTE_LOCKS)]
    with quote_lock:
        # Another request for this ticker may have populated the cache while
        # this caller waited. The global request semaphore alone does not
        # prevent multiple same-symbol cache misses from reaching Yahoo.
        cached = _QUOTE_CACHE.get(symbol)
        if cached is not None:
            return {**cached, "name": name} if name else dict(cached)
        if _QUOTE_FAILURE_CACHE.get(symbol):
            return None

        try:
            url = YAHOO_CHART_URL.format(symbol=quote(symbol, safe=""))
            # Yahoo does not publish a limit for this public chart URL. Bound
            # parallel quote bursts, especially when the large STOCKS group loads.
            with _YAHOO_REQUEST_SLOTS:
                result = json.loads(fetch(url, "application/json"))["chart"]["result"][0]
            meta = result.get("meta") or {}
            resolved_name = name or meta.get("shortName") or meta.get("longName") or symbol
            timestamps = result.get("timestamp") or []
            quote_indicators = result.get("indicators", {}).get("quote") or []
            quote_data = quote_indicators[0] if quote_indicators else {}
            raw_closes = quote_data.get("close", [])
            bars = [
                (timestamps[index], float(value))
                for index, value in enumerate(raw_closes)
                if index < len(timestamps)
                and isinstance(value, (int, float))
                and math.isfinite(value)
                and isinstance(timestamps[index], (int, float))
            ]
            closes = [value for _, value in bars]

            # The live last price is whichever is fresher: Yahoo's consolidated
            # regularMarketPrice or the newest 1-minute bar close.
            last_bar_time, last_bar = bars[-1] if bars else (0, None)
            regular_time = meta.get("regularMarketTime") or 0
            regular_price = meta.get("regularMarketPrice")
            if regular_price is not None and regular_time >= last_bar_time:
                last = regular_price
                asof = regular_time
            else:
                last = last_bar if last_bar is not None else regular_price
                asof = last_bar_time or regular_time
            if last is None:
                _QUOTE_FAILURE_CACHE.store(symbol, True)
                return None
            try:
                last = float(last)
            except (TypeError, ValueError, OverflowError):
                _QUOTE_FAILURE_CACHE.store(symbol, True)
                return None
            if not math.isfinite(last):
                _QUOTE_FAILURE_CACHE.store(symbol, True)
                return None
            # Yahoo occasionally returns a previous close in a different
            # scale than the session bars (for example Shanghai: 0.0002 vs
            # ~3,800). The first bar is not the prior close, so omit daily
            # change values instead of publishing a nonsensical percentage.
            previous, change_reference = _change_reference(meta, closes)
            raw_meta_reference = meta.get("chartPreviousClose") or meta.get("previousClose")
            try:
                raw_meta_reference = float(raw_meta_reference) if raw_meta_reference is not None else None
            except (TypeError, ValueError, OverflowError):
                raw_meta_reference = None
            reference_consistency = _reference_consistency(previous, closes, raw_meta_reference)
            change = (last - previous) if previous is not None else None
            pct = (change / previous * 100) if (previous and previous != 0) else None
            daily_returns = [
                (closes[index] / closes[index - 1] - 1) * 100
                for index in range(1, len(closes))
                if closes[index - 1] > 0 and closes[index] > 0
            ][-20:]
            daily_volatility_pct = statistics.pstdev(daily_returns) if len(daily_returns) >= 5 else None
            move_threshold_pct = max(0.2, daily_volatility_pct * 0.5) if daily_volatility_pct is not None else None

            def valid_meta_number(key: str) -> float | None:
                value = meta.get(key)
                try:
                    parsed = float(value)
                except (TypeError, ValueError, OverflowError):
                    return None
                return parsed if math.isfinite(parsed) and parsed > 0 else None

            day_low = valid_meta_number("regularMarketDayLow")
            day_high = valid_meta_number("regularMarketDayHigh")
            low_values = [
                float(value) for value in quote_data.get("low", [])
                if isinstance(value, (int, float)) and math.isfinite(value)
            ]
            high_values = [
                float(value) for value in quote_data.get("high", [])
                if isinstance(value, (int, float)) and math.isfinite(value)
            ]
            if day_low is None and low_values:
                day_low = min(low_values)
            if day_high is None and high_values:
                day_high = max(high_values)
            group = SYMBOL_GROUP.get(symbol, "INDICES")
            exchange_calendar = _exchange_calendar(symbol, group, meta)
            quote_now = time.time()
            market_state = _market_state(exchange_calendar, quote_now)
            stale, stale_after_s = _quote_staleness(asof, quote_now, market_state, group)
            row = {
                "symbol": symbol,
                "name": resolved_name,
                "last": last,
                "change": change,
                "pct": pct,
                "dailyVolatilityPct": daily_volatility_pct,
                "moveThresholdPct": move_threshold_pct,
                "changeReference": change_reference,
                "changeReferencePrice": previous,
                "changeReferenceConsistency": reference_consistency,
                "low": day_low,
                "high": day_high,
                "series": closes[-24:],
                "currency": meta.get("currency", ""),
                "asof": asof,
                "retrievedAt": time.time(),
                "asofMeaning": "provider quote timestamp, seconds since Unix epoch; retrievedAt records this server's retrieval time",
                "stale": stale,
                "staleAfterS": stale_after_s,
                "marketState": market_state,
                "exchangeCalendar": exchange_calendar,
                "exchangeTimezoneName": meta.get("exchangeTimezoneName") or "",
                "group": group,
            }
            _QUOTE_CACHE.store(symbol, dict(row))
            return dict(row)
        except Exception:
            # One unavailable symbol must not break the snapshot; the UI flags
            # the gap via the "expected" count and carries stale rows forward.
            # A short bounded negative cache prevents lock waiters from each
            # retrying the same failed upstream request in sequence.
            _QUOTE_FAILURE_CACHE.store(symbol, True)
            return None


def _bse_sofix_row() -> dict:
    """Read the public BSE Sofia index widget (the exchange labels it 3 min delayed).

    Raises when the widget markup cannot be found or parsed; callers decide
    whether that is fatal. The HTTP Date is retrieval time; the exchange says
    the quote is delayed three minutes, so ``asof`` is an estimate.
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
    estimated_quote_time = source_time - 180

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

    def number(value: str) -> float | None:
        try:
            parsed = float(value.replace(" ", "").replace(",", "."))
        except (ValueError, TypeError):
            return None
        return parsed if math.isfinite(parsed) else None

    last_text = field("top5_issue_size primary")
    last = number(last_text)
    if last is None or last <= 0:
        raise ValueError("BSE Sofia index value unavailable")
    pct_text = field("change green") or field("change red") or field("change")
    pct = None
    if pct_text:
        try:
            pct = float(pct_text.replace("%", "").replace("+", "").replace(",", "."))
        except (ValueError, TypeError):
            pct = None
    # The widget encodes direction via colour, not sign.
    if pct is not None and "change red" in block and "change green" not in block:
        pct = -abs(pct)
    change = number(field("top5_price_change_abs"))
    if pct is not None and pct < 0 and change is not None:
        change = -abs(change)

    row = {
        "symbol": "^SOFIX",
        "name": "SOFIX",
        "last": last,
        "change": change,
        "pct": pct,
        # The widget exposes bid/ask quotes, not session extrema.
        "low": None,
        "high": None,
        "series": [],
        "currency": "EUR",
        "asof": estimated_quote_time,
        "stale": time.time() - estimated_quote_time > _STALE_AFTER_BY_GROUP["INDICES"],
        "staleAfterS": _STALE_AFTER_BY_GROUP["INDICES"],
        "marketState": "UNKNOWN",
        "changeReference": "BSE widget daily change · reference unspecified",
        "changeReferencePrice": None,
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
    with _YAHOO_REQUEST_SLOTS:
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
