"""Vessel (AIS) and aircraft (ADS-B) position services.

Vessels proxy the public AIS snapshot API; aircraft come from the adsb.lol
community ADS-B feed, which is genuinely real-time (seconds behind the
receiver) and keyless, unlike the credit-limited OpenSky anonymous tier —
OpenSky is kept only for on-demand flight-track history, where a handful of
requests per day fits its free quota.

Aircraft rows are normalised to the conventions the UI already expects
(altitudes in metres, speeds in m/s, matching OpenSky's units) so both
surfaces share one rendering path. Caller-supplied parts (MMSI, ICAO24) are
validated by the HTTP boundary before they reach here.
"""
from __future__ import annotations

import json
import math
import time
import urllib.error
from urllib.parse import urlencode

from ..config import (
    ADSB_POINT_URL,
    AIR_SNAPSHOT_TTL_S,
    DEFAULT_VESSELS_BBOX,
    OPENWATERS_TRACK_URL,
    OPENWATERS_VESSELS_URL,
    OPENSKY_TRACKS_URL,
    TRACKING_BBOX,
    VESSELS_MAX_SQ_DEG,
    VESSELS_TTL_S,
)
from ..core.cache import TTLCache
from ..core.http_client import fetch
from ..core.pool import shared_pool

# Default home region for the vessels endpoint: lat_min,lon_min,lat_max,lon_max.
_BBOX_PARAM = ",".join(
    str(TRACKING_BBOX[key]) for key in ("lamin", "lomin", "lamax", "lomax")
)

# adsb.lol caps a point query at 250 nm; three circles tile the Black Sea box
# (40-46N / 25-41E) with margin — worst-case corner is ~220 nm from a centre.
_ADSB_COVER_POINTS = ((43.0, 27.5), (43.0, 33.0), (43.0, 38.5))
_ADSB_RADIUS_NM = 250

_JSON_ACCEPT = "application/json"

_FT_PER_M = 3.28084
_MS_PER_KT = 1 / 1.94384
_MS_PER_FTPMIN = 1 / 196.85

# Brief snapshot caches: smooth multi-tab polling and serve as 429 back-off
# windows (see aircraft_snapshot).
_air_cache: TTLCache[dict] = TTLCache(AIR_SNAPSHOT_TTL_S)
_vessel_cache: TTLCache[dict] = TTLCache(VESSELS_TTL_S)

# When the ADS-B feed answers 429, stop polling it for a while — retrying
# sooner only extends the throttle.
_adsb_banned_until = 0.0
ADSB_429_BACKOFF_S = 120


def _parse_bbox(raw: str | None) -> str:
    """Normalise a ``minLat,minLon,maxLat,maxLon`` viewport into a query box.

    Values are clamped to sane ranges and the box shrinks around its centre
    when it exceeds the source's ~100 square-degree cap. Garbage in, default
    region out — a malformed viewport must never 500 the feed.
    """
    if not raw:
        return DEFAULT_VESSELS_BBOX
    try:
        min_lat, min_lon, max_lat, max_lon = (float(x) for x in raw.split(","))
    except ValueError:
        return DEFAULT_VESSELS_BBOX
    min_lat = max(-85.0, min(85.0, min_lat))
    max_lat = max(-85.0, min(85.0, max_lat))
    min_lon = max(-180.0, min(180.0, min_lon))
    max_lon = max(-180.0, min(180.0, max_lon))
    if min_lat >= max_lat or min_lon >= max_lon:
        return DEFAULT_VESSELS_BBOX
    d_lat, d_lon = max_lat - min_lat, max_lon - min_lon
    if d_lat * d_lon > VESSELS_MAX_SQ_DEG:
        scale = (VESSELS_MAX_SQ_DEG / (d_lat * d_lon)) ** 0.5
        c_lat, c_lon = (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
        d_lat, d_lon = d_lat * scale, d_lon * scale
        min_lat, max_lat = c_lat - d_lat / 2, c_lat + d_lat / 2
        min_lon, max_lon = c_lon - d_lon / 2, c_lon + d_lon / 2
    # Round the outward edges inward so the 2-dp output can never exceed the
    # cap; boxes too small for inward rounding pass through unrounded.
    if d_lat >= 0.02 and d_lon >= 0.02:
        min_lat, max_lat = math.ceil(min_lat * 100) / 100, math.floor(max_lat * 100) / 100
        min_lon, max_lon = math.ceil(min_lon * 100) / 100, math.floor(max_lon * 100) / 100
        if min_lat >= max_lat or min_lon >= max_lon:
            return DEFAULT_VESSELS_BBOX
    return f"{min_lat:.2f},{min_lon:.2f},{max_lat:.2f},{max_lon:.2f}"


def _parse_boxes(raw: str | None) -> list[str]:
    """Parse a ``;``-separated box list into up to nine clamped query boxes."""
    if not raw:
        return [DEFAULT_VESSELS_BBOX]
    boxes = [_parse_bbox(part) for part in raw.split(";") if part.strip()]
    return boxes[:9] or [DEFAULT_VESSELS_BBOX]


def _parse_circles(raw: str | None) -> list[tuple[float, float, int]]:
    """Parse a ``;``-separated circle list (``lat,lon,radiusNm``) for adsb.lol.

    Up to nine circles; each is clamped to sane ranges with a 25-250 nm
    radius. Garbage parts are dropped; an unusable list yields the default
    three-circle home coverage.
    """
    circles: list[tuple[float, float, int]] = []
    if raw:
        for part in raw.split(";"):
            try:
                lat, lon, radius = (float(x) for x in part.split(","))
            except ValueError:
                continue
            if not (-85.0 <= lat <= 85.0 and -180.0 <= lon <= 180.0):
                continue
            circles.append((
                round(max(-85.0, min(85.0, lat)), 1),
                round(max(-180.0, min(180.0, lon)), 1),
                int(max(25.0, min(250.0, radius))),
            ))
            if len(circles) >= 9:
                break
    if not circles:
        circles = [(lat, lon, _ADSB_RADIUS_NM) for lat, lon in _ADSB_COVER_POINTS]
    return circles


def vessel_snapshot(boxes: str | None = None) -> tuple[int, dict]:
    """Return the AIS snapshot for up to nine viewport boxes.

    ``boxes`` is ``;``-separated ``minLat,minLon,maxLat,maxLon`` boxes — the
    UI sends one per coverage cell, so at low zoom several sampled clusters
    appear and zooming in swaps them for full-density boxes. Without it the
    default home region (Black Sea) is served. On upstream failure the
    payload keeps the ``features`` key (empty) so the UI's GeoJSON reader
    degrades to "no positions" instead of crashing.
    """
    regions = _parse_boxes(boxes)
    cache_key = ";".join(regions)
    cached = _vessel_cache.get(cache_key)
    if cached is not None:
        return 200, cached
    try:
        merged: dict = {"type": "FeatureCollection", "features": []}
        seen_ids: set = set()

        def _fetch_one_box(box: str) -> dict | None:
            try:
                body = fetch(OPENWATERS_VESSELS_URL.format(bbox=box), "application/geo+json, application/json")
                return json.loads(body)
            except Exception:
                return None

        fetched = list(shared_pool().map(_fetch_one_box, regions))
        any_success = False
        for data in fetched:
            if not isinstance(data, dict):
                continue
            any_success = True
            merged["attribution"] = data.get("attribution", merged.get("attribution", {}))
            merged["received_at"] = data.get("received_at", merged.get("received_at"))
            for feature in data.get("features", []):
                mmsi = (feature.get("properties") or {}).get("mmsi")
                dedupe_key = mmsi if mmsi else id(feature)
                if dedupe_key in seen_ids:
                    continue
                seen_ids.add(dedupe_key)
                merged["features"].append(feature)
        merged["region"] = cache_key
        if any_success:
            _vessel_cache.store(cache_key, merged)
            return 200, merged
        stale = _vessel_cache.get_entry(cache_key)
        if stale and stale.value.get("features"):
            return 200, stale.value
        return 502, {"error": "Upstream AIS sources unavailable", "features": [], "region": cache_key}
    except Exception as exc:
        stale = _vessel_cache.get_entry(cache_key)
        if stale and stale.value.get("features"):
            return 200, stale.value
        return 502, {"error": str(exc), "features": [], "region": cache_key}


def vessel_track(mmsi: str) -> tuple[int, dict]:
    """Return the movement history for one vessel MMSI as ``(status, payload)``."""
    try:
        data = json.loads(fetch(OPENWATERS_TRACK_URL.format(mmsi=mmsi), "application/geo+json, application/json"))
        return 200, data
    except Exception as exc:
        return 502, {"error": str(exc)}


def aircraft_snapshot(circles_raw: str | None = None) -> tuple[int, dict]:
    """Return the live ADS-B snapshot for up to nine circles of coverage.

    ``circles_raw`` is ``;``-separated ``lat,lon,radiusNm`` circles — one per
    coverage cell the UI computed for its zoom level: at low zoom several
    sampled clusters appear across the view, and zooming in swaps them for
    full-density coverage of the smaller area. Without parameters the
    three-circle Black Sea home region is served. Rows are deduplicated by
    ICAO24 and normalised to the UI's unit conventions. Circles are fetched
    sequentially ~1.1 s apart because the feed asks for at most ~1
    request/second; the snapshot is cached briefly and rate-limit responses
    are cached for the same window so a pile-up of UI tabs backs off instead
    of deepening the throttle.
    """
    circles = _parse_circles(circles_raw)
    global _adsb_banned_until
    cache_key = ";".join(f"{lat},{lon},{radius}" for lat, lon, radius in circles)
    cached = _air_cache.get(cache_key)
    if cached is not None:
        return (502 if "error" in cached else 200), cached
    if time.time() < _adsb_banned_until:
        stale = _air_cache.get_entry(cache_key)
        if stale and stale.value.get("aircraft"):
            return 200, stale.value
        return 502, {"error": "ADSB.LOL rate limit cooling down", "aircraft": [], "region": cache_key}
    try:
        seen: dict[str, dict] = {}
        for position, (lat, lon, radius) in enumerate(circles):
            url = ADSB_POINT_URL.format(lat=lat, lon=lon, radius=radius)
            data = json.loads(fetch(url, _JSON_ACCEPT))
            now_s = (data.get("now") or time.time() * 1000) / 1000  # feed reports ms
            for ac in data.get("ac", []):
                lat_a, lon_a = ac.get("lat"), ac.get("lon")
                if lat_a is None or lon_a is None:
                    continue
                alt_baro = ac.get("alt_baro")
                ground = alt_baro == "ground"
                gs = ac.get("gs")
                baro_rate = ac.get("baro_rate")
                alt_geom = ac.get("alt_geom")
                seen_pos = ac.get("seen_pos")
                key = ac.get("hex") or f"{lat_a},{lon_a}"
                seen[key] = {
                    "id": key,
                    "callsign": (ac.get("flight") or "").strip(),
                    "reg": ac.get("r") or "",
                    "type": ac.get("t") or "",
                    "lat": float(lat_a),
                    "lon": float(lon_a),
                    "altM": round(alt_baro / _FT_PER_M, 1) if isinstance(alt_baro, (int, float)) else None,
                    "ground": ground,
                    "speedMs": round(gs * _MS_PER_KT, 2) if isinstance(gs, (int, float)) else None,
                    "course": ac.get("track"),
                    "vertRateMs": round(baro_rate * _MS_PER_FTPMIN, 3) if isinstance(baro_rate, (int, float)) else None,
                    "geoAltM": round(alt_geom / _FT_PER_M, 1) if isinstance(alt_geom, (int, float)) else None,
                    "squawk": str(ac.get("squawk") or ""),
                    "ageS": seen_pos,
                    "lastContact": round(now_s - seen_pos) if isinstance(seen_pos, (int, float)) else None,
                }
            if position < len(circles) - 1:
                time.sleep(1.3)  # stay within the feed's 1 req/s courtesy limit
        payload = {"source": "ADSB.LOL", "time": time.time(), "aircraft": list(seen.values()), "region": cache_key}
        _air_cache.store(cache_key, payload)
        return 200, payload
    except Exception as exc:
        stale = _air_cache.get_entry(cache_key)
        if stale and stale.value.get("aircraft"):
            return 200, stale.value
        payload = {"error": str(exc), "aircraft": [], "region": cache_key}
        if "429" in str(exc):
            # One window of back-off, then a longer cooldown before the next
            # attempt — retrying inside a throttle only extends it.
            _adsb_banned_until = time.time() + ADSB_429_BACKOFF_S
            _air_cache.store(cache_key, payload)
        return 502, payload


def aircraft_track(icao24: str) -> tuple[int, dict]:
    """Return the flight track for one aircraft ICAO24 address.

    Track history still comes from OpenSky (adsb.lol serves only current
    positions). OpenSky answers 404 for aircraft without a live track; that
    common case is surfaced as a friendly empty result (HTTP 200) rather
    than an error. On-demand use keeps OpenSky's anonymous quota manageable.
    """
    try:
        url = OPENSKY_TRACKS_URL + "?" + urlencode({"icao24": icao24, "time": 0})
        data = json.loads(fetch(url, _JSON_ACCEPT))
        return 200, data
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return 200, {"error": "OpenSky has no live track for this aircraft.", "path": []}
        return exc.code, {"error": f"OpenSky track endpoint returned HTTP {exc.code}.", "path": []}
    except Exception as exc:
        return 502, {"error": str(exc), "path": []}
