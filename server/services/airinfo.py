"""Aircraft enrichment service (adsbdb.com public API).

For a selected aircraft this looks up, keylessly:

* the airframe registry entry — manufacturer (brand), model, registration,
  registered owner (the airline/operator) and a photo of the actual
  airframe, by ICAO24 hex;
* the flight route — airline plus origin/destination airports, by callsign.

Registry entries are near-static (24 h cache); routes rotate with schedule
seasons (30 min cache). Unknown hex/callsigns are a normal outcome, not an
error: the payload carries ``null`` sections and the UI renders dashes.
"""
from __future__ import annotations

import json
import urllib.error

from ..config import ADSBDB_URL, AIRDB_AIRCRAFT_TTL_S, AIRDB_ROUTE_TTL_S
from ..core.cache import TTLCache
from ..core.http_client import fetch

_aircraft_cache: TTLCache[dict] = TTLCache(AIRDB_AIRCRAFT_TTL_S)
_route_cache: TTLCache[dict] = TTLCache(AIRDB_ROUTE_TTL_S)


def _get_json(url: str) -> tuple[dict | None, str | None]:
    """GET a JSON document; ``(None, None)`` means a clean 404 not-found."""
    try:
        return json.loads(fetch(url, "application/json")), None
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None, None
        return None, f"HTTP {exc.code}"
    except Exception as exc:
        return None, str(exc)


def _aircraft(hex_id: str) -> dict | None:
    """Registry entry for one airframe, or None when unknown/unavailable."""
    cached = _aircraft_cache.get(hex_id)
    if cached is not None:
        return cached or None
    data, error = _get_json(f"{ADSBDB_URL}/aircraft/{hex_id}")
    raw = (data or {}).get("response", {}).get("aircraft") if data else None
    if not raw:
        return None
    info = {
        "brand": raw.get("manufacturer") or "",
        "model": raw.get("type") or "",
        "icaoType": raw.get("icao_type") or "",
        "registration": raw.get("registration") or "",
        "owner": raw.get("registered_owner") or "",
        "ownerCountry": raw.get("registered_owner_country_name") or "",
        "photo": raw.get("url_photo") or "",
        "photoThumb": raw.get("url_photo_thumbnail") or "",
    }
    _aircraft_cache.store(hex_id, info)
    return info


def _route(callsign: str) -> dict | None:
    """Route + airline for one callsign, or None when unknown/unavailable."""
    cached = _route_cache.get(callsign)
    if cached is not None:
        return cached or None
    data, error = _get_json(f"{ADSBDB_URL}/callsign/{callsign}")
    raw = (data or {}).get("response", {}).get("flightroute") if data else None
    if not raw:
        return None

    def airport(side: str) -> dict | None:
        a = raw.get(side) or {}
        if not a:
            return None
        return {
            "code": a.get("iata_code") or a.get("icao_code") or "",
            "icao": a.get("icao_code") or "",
            "name": a.get("name") or "",
            "city": a.get("municipality") or "",
            "country": a.get("country_name") or "",
        }

    airline = raw.get("airline") or {}
    info = {
        "airline": airline.get("name") or "",
        "airlineIata": airline.get("iata") or "",
        "airlineIcao": airline.get("icao") or "",
        "from": airport("origin"),
        "to": airport("destination"),
    }
    _route_cache.store(callsign, info)
    return info


def aircraft_info(hex_id: str | None, callsign: str | None) -> tuple[int, dict]:
    """Combined enrichment payload for the selected aircraft.

    Never raises: upstream failures surface as ``error`` with whichever
    sections did resolve (per-section lookup, per-section failure).
    """
    errors: list[str] = []
    aircraft = None
    route = None
    if hex_id:
        try:
            aircraft = _aircraft(hex_id)
        except Exception as exc:
            errors.append(f"registry: {exc}")
    if callsign:
        try:
            route = _route(callsign)
        except Exception as exc:
            errors.append(f"route: {exc}")
    return 200, {
        "aircraft": aircraft,
        "route": route,
        "source": "ADSBDB",
        "error": "; ".join(errors) or None,
    }
