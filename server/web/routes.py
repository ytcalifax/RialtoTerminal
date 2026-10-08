"""API route table.

Each entry maps an endpoint path to a handler that receives the parsed query
parameters and returns a ``(status, payload)`` pair. Routes form the service
boundary: they validate untrusted query input and shape the response, while
services assume validated input.

Adding an endpoint means adding an entry here — the HTTP handler itself
never changes (Open/Closed Principle).
"""

from __future__ import annotations

import re
from collections.abc import Callable

from ..services.airinfo import aircraft_info
from ..core.external_metrics import debug_snapshot
from ..services.conflict import disease_outbreak_snapshot, war_snapshot
from ..services.marketplace import listing_search
from ..services.markets.quotes import (
    market_snapshot,
    quotes_for_symbols,
    search_symbols,
)
from ..services.news.aggregator import aggregate_news
from ..services.tracking import (
    aircraft_snapshot,
    aircraft_track,
    vessel_snapshot,
    vessel_track,
)

Params = dict[str, list[str]]
RouteHandler = Callable[[Params], tuple[int, dict]]


def _first(params: Params, name: str, default: str = "") -> str:
    vals = params.get(name)
    return vals[0] if (vals and len(vals) > 0) else default


def _news(params: Params) -> tuple[int, dict]:
    return 200, aggregate_news(
        _first(params, "feed", "global"),
        _first(params, "q"),
        _first(params, "country"),
    )


def _market(params: Params) -> tuple[int, dict]:
    return 200, market_snapshot(_first(params, "group", "CORE").upper())


def _symbol_search(params: Params) -> tuple[int, dict]:
    return 200, search_symbols(_first(params, "q"))


def _quotes(params: Params) -> tuple[int, dict]:
    return 200, quotes_for_symbols(_first(params, "symbols"))


def _marketplace(params: Params) -> tuple[int, dict]:
    return 200, listing_search(_first(params, "q"), _first(params, "limit", "80"))


def _vessels(params: Params) -> tuple[int, dict]:
    return vessel_snapshot(_first(params, "boxes") or None)


def _vessel_track(params: Params) -> tuple[int, dict]:
    mmsi = _first(params, "mmsi")
    if not mmsi.isdigit():
        return 400, {"error": "A numeric MMSI is required."}
    return vessel_track(mmsi)


def _air(params: Params) -> tuple[int, dict]:
    return aircraft_snapshot(_first(params, "bbox") or None)


def _air_info(params: Params) -> tuple[int, dict]:
    hex_id = _first(params, "id").strip().lower()
    callsign = _first(params, "callsign").strip().upper()
    hex_ok = re.fullmatch(r"[0-9a-f]{6}", hex_id or "")
    callsign_ok = re.fullmatch(r"[A-Z0-9]{2,10}", callsign or "")
    if not hex_ok and not callsign_ok:
        return 400, {"error": "A six-character ICAO24 id or a callsign is required."}
    return aircraft_info(hex_id if hex_ok else None, callsign if callsign_ok else None)


def _air_track(params: Params) -> tuple[int, dict]:
    icao24 = _first(params, "icao24").lower()
    if not re.fullmatch(r"[0-9a-f]{6}", icao24):
        return 400, {"error": "A six-character ICAO24 address is required."}
    return aircraft_track(icao24)


def _conflicts(params: Params) -> tuple[int, dict]:
    return war_snapshot()


def _disease_outbreaks(params: Params) -> tuple[int, dict]:
    return disease_outbreak_snapshot()


def _debug_stats(params: Params) -> tuple[int, dict]:
    snapshot = debug_snapshot()
    return (200, snapshot) if snapshot["enabled"] else (404, {"error": "Debug mode is disabled."})


API_ROUTES: dict[str, RouteHandler] = {
    "/api/news": _news,
    "/api/market": _market,
    "/api/symbol-search": _symbol_search,
    "/api/quotes": _quotes,
    "/api/marketplace": _marketplace,
    "/api/vessels": _vessels,
    "/api/vessel-track": _vessel_track,
    "/api/air": _air,
    "/api/air-info": _air_info,
    "/api/air-track": _air_track,
    "/api/conficts": _conflicts,
    "/api/health/outbreaks": _disease_outbreaks,
    "/api/debug/stats": _debug_stats,
}
