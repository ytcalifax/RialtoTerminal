"""Public conflict reporting and GPSJam coverage feeds."""

from __future__ import annotations

import csv
import io
import json
import re
import time
import zipfile
from datetime import datetime, timezone
from urllib.parse import urlsplit

from ..core.cache import TTLCache
from ..core.http_client import fetch
from ..core.pool import shared_pool

_WAR_TTL_S = 600
_war_cache: TTLCache[dict] = TTLCache(_WAR_TTL_S, max_entries=2)
_gpsjam_cache: TTLCache[dict] = TTLCache(3600, max_entries=1)

_GDELT_MANIFEST_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"
_FRONTLINE_URL = (
    "https://gis.unocha.org/server/rest/services/UKR_HNS_Front_Line_Overlap_MIL1/"
    "MapServer/0/query?where=1%3D1&outFields=Source,Date&returnGeometry=true&"
    "outSR=4326&f=geojson"
)
_GPSJAM_MANIFEST_URL = "https://gpsjam.org/data/manifest.csv"


def _features(data: object) -> list[dict]:
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        return []
    return [x for x in data["features"] if isinstance(x, dict)]


def _conflict_events() -> list[dict]:
    """Read recent violent events from GDELT's public 15-minute export."""
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
            lat, lon = float(row[56]), float(row[57])
        except (ValueError, IndexError):
            continue
        if event_day.toordinal() < cutoff or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        if lat == 0 and lon == 0:
            continue
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
        results.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
        if len(results) >= 250:
            break
    return results


def _gpsjam_coverage() -> dict:
    """Return GPSJam's latest daily aircraft-reported interference hexes."""
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
    """Return news-derived conflict references and the public Ukraine front line."""
    cached = _war_cache.get("global")
    if cached is not None:
        return 200, cached
    stale = _war_cache.get_entry("global")

    def _read_frontline() -> dict | None:
        try:
            return json.loads(fetch(_FRONTLINE_URL, "application/geo+json, application/json"))
        except Exception:
            return None

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
        try:
            reports = reports_future.result()
        except Exception:
            reports = []
        front = front_future.result()
        gpsjam = gpsjam_future.result()
        report_features = reports if isinstance(reports, list) else []
        frontline_features = _features(front)
        if not report_features and not frontline_features:
            raise ValueError("Conflict feeds returned no map features")
        payload = {
            "source": "GDELT Event Database",
            "reports": report_features,
            "frontline": frontline_features,
            "frontline_source": "UN OCHA Ukraine Front Line layer",
            "gpsjam": gpsjam or {"date": "", "source": "GPSJam", "features": []},
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
