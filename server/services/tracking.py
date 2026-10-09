"""Vessel (AIS) and aircraft (ADS-B) position services.

Vessels proxy the public AIS snapshot API; aircraft use OpenSky live state
vectors and tracks.

Aircraft rows are normalised to the conventions the UI already expects
(altitudes in metres, speeds in m/s, matching OpenSky's units) so both
surfaces share one rendering path. Caller-supplied parts (MMSI, ICAO24) are
validated by the HTTP boundary before they reach here.
"""

from __future__ import annotations

import json
import math
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlencode

from ..config import (
    AIR_SNAPSHOT_TTL_S,
    DEFAULT_VESSELS_BBOX,
    OPENSKY_CREDENTIALS,
    OPENSKY_STATES_URL,
    OPENSKY_TOKEN_URL,
    OPENSKY_TRACKS_URL,
    OPENWATERS_TRACK_URL,
    OPENWATERS_VESSELS_URL,
    TRACKING_BBOX,
    VESSELS_MAX_SQ_DEG,
    VESSELS_TTL_S,
)
from ..core.cache import TTLCache
from ..core.external_metrics import begin_request, finish_request
from ..core.http_client import fetch, fetch_response
from ..core.pool import shared_pool

# Default home region: lat_min,lon_min,lat_max,lon_max.
_BBOX_PARAM = ",".join(
    str(TRACKING_BBOX[key]) for key in ("lamin", "lomin", "lamax", "lomax")
)

_JSON_ACCEPT = "application/json"

# Brief snapshot caches: smooth multi-tab polling and serve as 429 back-off
# windows (see aircraft_snapshot).
_air_cache: TTLCache[dict] = TTLCache(AIR_SNAPSHOT_TTL_S)
_vessel_cache: TTLCache[dict] = TTLCache(VESSELS_TTL_S)
_air_request_lock = threading.Lock()
_last_air_request = 0.0
_vessel_request_slots = threading.BoundedSemaphore(3)


class _OpenSkyTokenManager:
    """Cache the OAuth2 client-credentials token until shortly before expiry."""

    def __init__(self, client_id: str, client_secret: str, slot: int = 0) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self.slot = slot
        self._token: str | None = None
        self._expires_at: float | None = None
        self._lock = threading.Lock()

    def get_token(self, force_refresh: bool = False) -> str | None:
        with self._lock:
            if (
                not force_refresh
                and self._token
                and self._expires_at
                and time.monotonic() < self._expires_at
            ):
                return self._token
            if not self._client_id or not self._client_secret:
                return None
            request = urllib.request.Request(
                OPENSKY_TOKEN_URL,
                data=urllib.parse.urlencode(
                    {
                        "grant_type": "client_credentials",
                        "client_id": self._client_id,
                        "client_secret": self._client_secret,
                    }
                ).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            metric = begin_request(OPENSKY_TOKEN_URL, "POST", len(request.data or b""))
            try:
                with urllib.request.urlopen(request, timeout=12) as response:
                    body = response.read()
                    finish_request(metric, response.status, len(body))
                    data = json.loads(body.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                finish_request(metric, exc.code, 0, f"HTTP {exc.code}")
                raise
            except Exception as exc:
                finish_request(metric, None, 0, type(exc).__name__)
                raise RuntimeError(f"OpenSky authentication failed: {exc}") from exc
            token = data.get("access_token")
            if not token:
                raise RuntimeError("OpenSky authentication returned no access token")
            # Keep each configured key's token in memory for almost its full
            # advertised lifetime. Monotonic time avoids clock changes causing
            # needless re-authentication; the small margin avoids expiry races.
            expires_in = max(1, int(data.get("expires_in", 1800)) - 30)
            self._token = token
            self._expires_at = time.monotonic() + expires_in
            return token

    def invalidate(self) -> None:
        with self._lock:
            self._token = None
            self._expires_at = None


_air_tokens = [
    _OpenSkyTokenManager(client_id, client_secret, index)
    for index, (client_id, client_secret) in enumerate(OPENSKY_CREDENTIALS)
]
if not _air_tokens:
    _air_tokens = [_OpenSkyTokenManager("", "")]
_air_token_index = 0
_air_token_index_lock = threading.Lock()


def _next_air_token_manager() -> _OpenSkyTokenManager:
    global _air_token_index
    with _air_token_index_lock:
        manager = _air_tokens[_air_token_index]
        _air_token_index = (_air_token_index + 1) % len(_air_tokens)
        return manager


def _fetch_air_source(url: str) -> bytes:
    """Serialize OpenSky calls and keep them at or below one request/second."""
    global _last_air_request
    with _air_request_lock:
        wait = 1.0 - (time.monotonic() - _last_air_request)
        if wait > 0:
            time.sleep(wait)
        _last_air_request = time.monotonic()
        token_manager = _next_air_token_manager()
        token = token_manager.get_token()
        headers = {"Authorization": f"Bearer {token}"} if token else None
        endpoint_bucket = urllib.parse.urlsplit(url).path.rstrip("/").split("/")[-2]
        retry_scope = f"opensky:{token_manager.slot}:{endpoint_bucket}"
        try:
            return fetch_response(
                url, _JSON_ACCEPT, headers=headers, retry_scope=retry_scope
            )[0]
        except urllib.error.HTTPError as exc:
            if exc.code != 401 or not token:
                raise
            token_manager.invalidate()
            refreshed = token_manager.get_token(force_refresh=True)
            return fetch_response(
                url,
                _JSON_ACCEPT,
                headers={"Authorization": f"Bearer {refreshed}"},
                retry_scope=retry_scope,
            )[0]


def _parse_bbox(raw: str | None, max_area: float | None = VESSELS_MAX_SQ_DEG) -> str:
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
    if not all(math.isfinite(value) for value in (min_lat, min_lon, max_lat, max_lon)):
        return DEFAULT_VESSELS_BBOX
    min_lat = max(-85.0, min(85.0, min_lat))
    max_lat = max(-85.0, min(85.0, max_lat))
    min_lon = max(-180.0, min(180.0, min_lon))
    max_lon = max(-180.0, min(180.0, max_lon))
    if min_lat >= max_lat or min_lon >= max_lon:
        return DEFAULT_VESSELS_BBOX
    d_lat, d_lon = max_lat - min_lat, max_lon - min_lon
    if max_area is not None and d_lat * d_lon > max_area:
        scale = (max_area / (d_lat * d_lon)) ** 0.5
        c_lat, c_lon = (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
        d_lat, d_lon = d_lat * scale, d_lon * scale
        min_lat, max_lat = c_lat - d_lat / 2, c_lat + d_lat / 2
        min_lon, max_lon = c_lon - d_lon / 2, c_lon + d_lon / 2
    # Round outward edges inward so a capped box stays within its limit.
    if d_lat >= 0.02 and d_lon >= 0.02:
        min_lat, max_lat = (
            math.ceil(min_lat * 100) / 100,
            math.floor(max_lat * 100) / 100,
        )
        min_lon, max_lon = (
            math.ceil(min_lon * 100) / 100,
            math.floor(max_lon * 100) / 100,
        )
        if min_lat >= max_lat or min_lon >= max_lon:
            return DEFAULT_VESSELS_BBOX
    return (
        f"{float(min_lat):.2f},{float(min_lon):.2f},"
        f"{float(max_lat):.2f},{float(max_lon):.2f}"
    )


def _parse_boxes(raw: str | None) -> list[str]:
    """Parse a ``;``-separated box list into up to nine clamped query boxes."""
    if not raw:
        return [DEFAULT_VESSELS_BBOX]
    boxes = [_parse_bbox(part) for part in raw.split(";") if part.strip()]
    return boxes[:9] or [DEFAULT_VESSELS_BBOX]


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
                with _vessel_request_slots:
                    body = fetch(
                        OPENWATERS_VESSELS_URL.format(bbox=box),
                        "application/geo+json, application/json",
                    )
                return json.loads(body)
            except Exception:
                return None

        fetched = list(shared_pool().map(_fetch_one_box, regions))
        any_success = False
        for data in fetched:
            if not isinstance(data, dict):
                continue
            any_success = True
            merged["attribution"] = data.get(
                "attribution", merged.get("attribution", {})
            )
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
        return 502, {
            "error": "Upstream AIS sources unavailable",
            "features": [],
            "region": cache_key,
        }
    except Exception as exc:
        stale = _vessel_cache.get_entry(cache_key)
        if stale and stale.value.get("features"):
            return 200, stale.value
        return 502, {"error": str(exc), "features": [], "region": cache_key}


def vessel_track(mmsi: str) -> tuple[int, dict]:
    """Return the movement history for one vessel MMSI as ``(status, payload)``."""
    try:
        data = json.loads(
            fetch(
                OPENWATERS_TRACK_URL.format(mmsi=mmsi),
                "application/geo+json, application/json",
            )
        )
        return 200, data
    except Exception as exc:
        return 502, {"error": str(exc)}


def aircraft_snapshot(bbox_raw: str | None = None) -> tuple[int, dict]:
    """Return a live OpenSky state-vector snapshot for the current map box."""
    # Keep the query within OpenSky's 100 sq° / 2-credit band. A global
    # viewport is narrowed around its centre before it reaches the provider.
    bbox = _parse_bbox(bbox_raw, max_area=100)
    cache_key = bbox
    cached = _air_cache.get(cache_key)
    if cached is not None:
        return (502 if "error" in cached else 200), cached
    try:
        min_lat, min_lon, max_lat, max_lon = bbox.split(",")
        query = urlencode(
            {"lamin": min_lat, "lomin": min_lon, "lamax": max_lat, "lomax": max_lon}
        )
        data = json.loads(_fetch_air_source(f"{OPENSKY_STATES_URL}?{query}"))
        snapshot_time = data.get("time") or int(time.time())
        rows = []
        for s in data.get("states") or []:
            if len(s) < 17 or s[5] is None or s[6] is None:
                continue
            contact = s[4]
            rows.append(
                {
                    "id": s[0],
                    "callsign": (s[1] or "").strip(),
                    "reg": "",
                    "type": "",
                    "lat": s[6],
                    "lon": s[5],
                    "altM": s[7],
                    "ground": bool(s[8]),
                    "speedMs": s[9],
                    "course": s[10],
                    "vertRateMs": s[11],
                    "geoAltM": s[13],
                    "squawk": s[14] or "",
                    "ageS": max(0, snapshot_time - contact) if contact else None,
                    "lastContact": contact,
                }
            )
        payload = {
            "source": "OpenSky",
            "time": snapshot_time,
            "aircraft": rows,
            "region": cache_key,
        }
        _air_cache.store(cache_key, payload)
        return 200, payload
    except Exception as exc:
        stale = _air_cache.get_entry(cache_key)
        if stale and stale.value.get("aircraft"):
            return 200, stale.value
        payload = {"error": str(exc), "aircraft": [], "region": cache_key}
        return 502, payload


def aircraft_track(icao24: str) -> tuple[int, dict]:
    """Return the flight track for one aircraft ICAO24 address.

    Track history also comes from OpenSky. OpenSky answers 404 for aircraft without a live track; that
    common case is surfaced as a friendly empty result (HTTP 200) rather
    than an error. On-demand use keeps OpenSky's anonymous quota manageable.
    """
    try:
        url = OPENSKY_TRACKS_URL + "?" + urlencode({"icao24": icao24, "time": 0})
        data = json.loads(_fetch_air_source(url))
        return 200, data
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return 200, {
                "error": "OpenSky has no live track for this aircraft.",
                "path": [],
            }
        return exc.code, {
            "error": f"OpenSky track endpoint returned HTTP {exc.code}.",
            "path": [],
        }
    except Exception as exc:
        return 502, {"error": str(exc), "path": []}
