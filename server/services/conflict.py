from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
import re
import time
import zipfile
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit

from ..core.cache import TTLCache
from ..core.http_client import fetch, fetch_response
from ..core.pool import shared_pool

_WAR_TTL_S = 900  # GDELT's event exports update every 15 minutes
_war_cache: TTLCache[dict] = TTLCache(_WAR_TTL_S, max_entries=2)
_outbreak_cache: TTLCache[dict] = TTLCache(900, max_entries=1)
_frontline_cache: TTLCache[dict] = TTLCache(86400, max_entries=1)
_gpsjam_cache: TTLCache[dict] = TTLCache(86400, max_entries=1)

_GDELT_MANIFEST_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"
_FRONTLINE_URL = (
    "https://gis.unocha.org/server/rest/services/Hosted/UKR_Front_Line/"
    "FeatureServer/0/query?where=1%3D1&outFields=source,date&returnGeometry=true&"
    "outSR=4326&f=geojson"
)
_GPSJAM_MANIFEST_URL = "https://gpsjam.org/data/manifest.csv"
_WORLDMONITOR_API = "https://api.worldmonitor.app"


def _worldmonitor_json(path: str, params: dict[str, str] | None = None) -> dict:
    key = os.environ.get("WORLDMONITOR_API_KEY", "").strip()
    if not key:
        raise ValueError("WORLDMONITOR_API_KEY is not configured")
    query = f"?{urlencode(params)}" if params else ""
    body, _ = fetch_response(
        f"{_WORLDMONITOR_API}{path}{query}",
        "application/json",
        headers={"X-WorldMonitor-Key": key},
    )
    result = json.loads(body)
    if not isinstance(result, dict):
        raise ValueError("World Monitor returned an invalid payload")
    return result


def _worldmonitor_layers() -> dict:
    def read(name: str, path: str, key: str, params: dict[str, str] | None = None) -> tuple[str, list]:
        try:
            payload = _worldmonitor_json(path, params)
            items = payload.get(key, [])
            if not isinstance(items, list):
                raise ValueError("unexpected response shape")
            return name, items
        except Exception:
            return name, []

    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="worldmonitor") as pool:
        jobs = {
            "ucdp": pool.submit(read, "ucdp", "/api/conflict/v1/list-ucdp-events", "events"),
            "acled": pool.submit(read, "acled", "/api/conflict/v1/list-acled-events", "events"),
            "outages": pool.submit(read, "outages", "/api/infrastructure/v1/list-internet-outages", "outages"),
        }
        layers = {name: future.result()[1] for name, future in jobs.items()}
    layers["armed"] = [
        {**event, "source": "UCDP"}
        for event in layers["ucdp"]
    ] + [
        {**event, "source": "ACLED"}
        for event in layers["acled"]
    ]
    layers["configured"] = bool(os.environ.get("WORLDMONITOR_API_KEY", "").strip())
    layers["source"] = "World Monitor API"
    layers["updated_at"] = int(time.time())
    return layers


def disease_outbreak_snapshot() -> tuple[int, dict]:
    cached = _outbreak_cache.get("latest")
    if cached is not None:
        return 200, cached
    stale = _outbreak_cache.get_entry("latest")
    try:
        payload = _worldmonitor_json("/api/health/v1/list-disease-outbreaks")
        outbreaks = payload.get("outbreaks", [])
        if not isinstance(outbreaks, list):
            raise ValueError("World Monitor returned an invalid outbreak list")
        result = {
            "outbreaks": [item for item in outbreaks if isinstance(item, dict)],
            "source": "World Monitor API",
            "updated_at": int(time.time()),
        }
        _outbreak_cache.store("latest", result)
        return 200, result
    except Exception:
        if stale is not None:
            return 200, {**stale.value, "stale": True}
        return 200, {"outbreaks": [], "partial": True, "source": "World Monitor API"}


def _features(data: object) -> list[dict]:
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        return []
    return [x for x in data["features"] if isinstance(x, dict)]


def _conflict_events() -> list[dict]:
    manifest = fetch(_GDELT_MANIFEST_URL, "text/plain").decode("utf-8", "replace")
    first_line = next((line for line in manifest.splitlines() if line.strip()), "")
    parts = first_line.split()
    match = re.search(r"/(\d{14})\.export\.CSV\.zip$", parts[-1]) if len(parts) >= 3 else None
    if not match:
        raise ValueError("GDELT update manifest did not list an event export")
    archive_url = f"https://data.gdeltproject.org/gdeltv2/{match.group(1)}.export.CSV.zip"
    archive = zipfile.ZipFile(io.BytesIO(fetch(archive_url, "application/zip")))
    stream = io.TextIOWrapper(archive.open(archive.namelist()[0]), encoding="utf-8", errors="replace", newline="")
    cutoff = datetime.now(timezone.utc).date().toordinal() - 7
    labels = {"18": "ASSAULT", "19": "FIGHT", "20": "MASS VIOLENCE"}
    military_actor_types = {"MIL", "REB", "INS", "SEP"}
    results = []
    for row in csv.reader(stream, delimiter="\t"):
        if len(row) < 61 or row[28] not in labels or not military_actor_types.intersection((*row[12:15], *row[22:25])):
            continue
        try:
            event_day = datetime.strptime(row[1], "%Y%m%d").date()
        except (ValueError, IndexError):
            continue
        if event_day.toordinal() < cutoff:
            continue
        try:
            lat, lon = float(row[56]), float(row[57])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                lat, lon = None, None
        except (ValueError, IndexError):
            lat, lon = None, None
        url = row[60]
        domain = urlsplit(url).hostname or "GDELT"
        actors = " vs ".join(actor for actor in (row[6], row[16]) if actor)
        props = {
            "event_id": row[0],
            "name": row[52] or "REPORTED LOCATION",
            "url": url,
            "domain": domain,
            "mentionednames": actors or "ACTORS NOT CODED",
            "mentionedthemes": f"{labels[row[28]]} · CAMEO {row[26]} · {row[33]} ARTICLES",
            "geores": int(row[51]) if row[51].isdigit() else 0,
            "event_date": event_day.isoformat(),
        }
        geometry = {"type": "Point", "coordinates": [lon, lat]} if lat is not None and lon is not None else None
        results.append({"type": "Feature", "geometry": geometry, "properties": props})
        if len(results) >= 250:
            break
    return results


def _gpsjam_coverage() -> dict:
    cached = _gpsjam_cache.get("latest")
    if cached is not None:
        return cached
    import h3

    manifest = csv.DictReader(
        io.StringIO(fetch(_GPSJAM_MANIFEST_URL, "text/csv").decode("utf-8", "replace"))
    )
    latest = next(
        (row for row in reversed(list(manifest)) if row.get("date") and row.get("source")),
        None,
    )
    if not latest:
        raise ValueError("GPSJam manifest has no daily data")
    date, source = latest["date"], latest["source"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or source not in {
        "adsbexchange", "airplaneslive", "merged"
    }:
        raise ValueError("GPSJam manifest contains an unsupported data entry")
    url = f"https://gpsjam.org/data/{source}/{date}-h3_4.csv"
    rows = csv.DictReader(
        io.StringIO(fetch(url, "text/csv").decode("utf-8", "replace"))
    )
    features = []
    for row in rows:
        try:
            bad = int(row["count_bad_aircraft"])
            good = int(row["count_good_aircraft"])
            if bad < 2 or bad + good == 0:
                continue
            boundary = h3.cell_to_boundary(row["hex"])
        except (KeyError, TypeError, ValueError):
            continue
        ring = [[lon, lat] for lat, lon in boundary]
        if ring:
            ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "bad": bad,
                    "good": good,
                    # GPSJam subtracts one bad aircraft to reduce isolated
                    # small-sample false positives; match its published metric.
                    "percent": round(100 * max(0, bad - 1) / (bad + good), 1),
                    "date": date,
                },
            }
        )
    if not features:
        raise ValueError("GPSJam daily data contains no qualifying hexes")
    result = {"date": date, "source": "GPSJam", "features": features}
    _gpsjam_cache.store("latest", result)
    return result


def war_snapshot() -> tuple[int, dict]:
    cached = _war_cache.get("global")
    if cached is not None:
        return 200, cached
    stale = _war_cache.get_entry("global")

    def _read_frontline() -> dict | None:
        cached = _frontline_cache.get("latest")
        if cached is not None:
            return cached
        stale = _frontline_cache.get_entry("latest")
        try:
            payload = json.loads(fetch(_FRONTLINE_URL, "application/geo+json, application/json"))
            if isinstance(payload, dict) and isinstance(payload.get("features"), list):
                _frontline_cache.store("latest", payload)
                return payload
        except Exception:
            pass
        return stale.value if stale else None

    def _read_gpsjam() -> dict | None:
        try:
            return _gpsjam_coverage()
        except Exception:
            return None

    try:
        pool = shared_pool()
        reports_future = pool.submit(_conflict_events)
        front_future = pool.submit(_read_frontline)
        gpsjam_future = pool.submit(_read_gpsjam)
        wm_future = pool.submit(_worldmonitor_layers)
        try:
            reports = reports_future.result()
        except Exception:
            reports = []
        front = front_future.result()
        gpsjam = gpsjam_future.result()
        worldmonitor = wm_future.result()
        report_features = reports if isinstance(reports, list) else []
        frontline_features = _features(front)
        if not report_features and not frontline_features:
            raise ValueError("Conflict feeds returned no map features")
        payload = {
            "source": "GDELT Event Database",
            "reports": report_features,
            "frontline": frontline_features,
            "frontline_source": "UN OCHA / ISW & CTP Ukraine Front Line",
            "gpsjam": gpsjam or {"date": "", "source": "GPSJam", "features": []},
            "worldmonitor": worldmonitor,
            "partial": not report_features or not frontline_features or gpsjam is None,
            "updated_at": int(time.time()),
        }
        _war_cache.store("global", payload)
        return 200, payload
    except Exception as exc:
        if stale:
            return 200, {**stale.value, "stale": True}
        return 502, {
            "error": f"Public conflict feeds unavailable: {exc}",
            "reports": [],
            "frontline": [],
        }
