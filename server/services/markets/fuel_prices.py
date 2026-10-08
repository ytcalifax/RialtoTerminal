"""Optional national fuel-price commodities from fuel-prices.eu."""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone

from ...config import FUEL_PRICES_TTL_S, FUEL_PRICES_URL
from ...core.cache import TTLCache
from ...core.http_client import fetch

_CACHE: TTLCache[dict] = TTLCache(FUEL_PRICES_TTL_S)
_FUEL_SYMBOL_RE = re.compile(r"^FUEL-([A-Z]{2})-([A-Z0-9]{1,6})$")
_COUNTRIES = {
    "AT": "Austria", "AU": "Australia", "CZ": "Czechia", "DK": "Denmark",
    "ES": "Spain", "FR": "France", "GB": "United Kingdom", "GR": "Greece",
    "HR": "Croatia", "IS": "Iceland", "IT": "Italy", "RO": "Romania",
    "SI": "Slovenia",
}
_FUELS = {
    "diesel": "Diesel", "sp95": "Petrol 95", "sp98": "Petrol 98",
    "e10": "Petrol E10", "e5": "Petrol E5", "e85": "E85",
    "gpl": "LPG", "cng": "CNG", "lng": "LNG", "hvo": "HVO",
}


def fuel_price_snapshot() -> dict:
    """Return available country/fuel averages, cached for one hour."""
    cached = _CACHE.get("summary")
    if cached is not None:
        return cached

    payload = json.loads(fetch(FUEL_PRICES_URL, "application/json"))
    if not payload.get("ok"):
        raise ValueError("fuel-prices.eu returned an unavailable summary")
    data = payload.get("data") or {}
    items = []
    for country in data.get("countries") or []:
        code = str(country.get("country_code") or "").upper()
        asof = country.get("last_fetched_ts")
        if not asof:
            try:
                asof = datetime.strptime(country["last_fetched"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            except (KeyError, TypeError, ValueError):
                asof = 0
        for fuel, prices in (country.get("fuels") or {}).items():
            average = prices.get("avg")
            if not code or average is None:
                continue
            try:
                average = float(average)
            except (TypeError, ValueError):
                continue
            if average <= 0:
                continue
            fuel_code = str(fuel).lower()
            country_name = _COUNTRIES.get(code, code)
            fuel_name = _FUELS.get(fuel_code, fuel_code.upper())
            items.append({
                "symbol": f"FUEL-{code}-{fuel_code.upper()}",
                "name": f"{country_name} · {fuel_name} (€/L)",
                "country": country_name,
                "countryCode": code,
                "fuel": fuel_code,
                "fuelName": fuel_name,
                "last": average,
                "change": None,
                "pct": None,
                "low": None,
                "high": None,
                "series": [],
                "currency": "EUR/L",
                "asof": float(asof or 0),
                "stale": not asof or time.time() - float(asof) > 86400,
                "stations": int(prices.get("stations") or 0),
                "source": "fuel-prices.eu",
                "group": "COMMODITIES",
            })

    result = {
        "items": items,
        "expected": len(items),
        "fetched": time.time(),
        "source": "fuel-prices.eu national fuel averages · EUR/L",
        "attribution": payload.get("attribution") or {
            "text": "Data: fuel-prices.eu, CC BY 4.0",
            "url": "https://www.fuel-prices.eu/press/#cite",
        },
    }
    _CACHE.store("summary", result)
    return result


def fuel_quotes_for_symbols(symbols: list[str]) -> list[dict]:
    """Select cached fuel quote rows by their stable local symbol IDs."""
    wanted = {symbol for symbol in symbols if _FUEL_SYMBOL_RE.fullmatch(symbol)}
    if not wanted:
        return []
    rows = {row["symbol"]: row for row in fuel_price_snapshot()["items"]}
    return [dict(rows[symbol]) for symbol in wanted if symbol in rows]
