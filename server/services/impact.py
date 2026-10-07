"""Conservative, explainable impact signals from the terminal's live feeds."""

from __future__ import annotations

import json
import math
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from statistics import median
from urllib.parse import urlencode

from ..core.cache import TTLCache
from ..core.http_client import fetch
from ..core.pool import shared_pool
from .conflict import war_snapshot
from .markets.quotes import market_snapshot, quotes_for_symbols
from .news.aggregator import aggregate_news
from .tracking import aircraft_snapshot, vessel_snapshot

_SNAPSHOT_TTL_S = 240
_WEATHER_TTL_S = 900
_QUAKE_TTL_S = 120
_GDACS_TTL_S = 300
_payload_cache: TTLCache[dict] = TTLCache(_SNAPSHOT_TTL_S, max_entries=1)
_source_cache: TTLCache[dict] = TTLCache(_WEATHER_TTL_S, max_entries=4)
_history: dict[str, deque[tuple[float, float]]] = {"ais": deque(maxlen=9000), "air": deque(maxlen=9000)}
_detections: dict[str, dict] = {}
_lock = threading.Lock()

_BALKAN_BOX = (34.0, 13.0, 50.0, 31.0)  # south, west, north, east
_BG_AIR_BOX = "40,25,46,41"
_BG_AIS_BOX = "40,25,46,41"
_WEATHER_POINTS = [
    ("Sofia", "BG", 42.6977, 23.3219),
    ("Varna", "BG", 43.2141, 27.9147),
    ("Burgas", "BG", 42.5048, 27.4626),
    ("Ruse", "BG", 43.8356, 25.9657),
    ("Plovdiv", "BG", 42.1354, 24.7453),
    ("Bucharest", "RO", 44.4268, 26.1025),
    ("Thessaloniki", "GR", 40.6401, 22.9444),
    ("Belgrade", "RS", 44.7866, 20.4489),
]
_COUNTRY_NAMES = {
    "BGR": "Bulgaria", "ROU": "Romania", "GRC": "Greece", "SRB": "Serbia",
    "MKD": "North Macedonia", "ALB": "Albania", "XKX": "Kosovo", "MNE": "Montenegro",
    "BIH": "Bosnia and Herzegovina", "HRV": "Croatia", "SVN": "Slovenia",
    "TUR": "Türkiye", "MDA": "Moldova",
}


def _cached_json(key: str, url: str, ttl: int) -> tuple[dict | list, bool, str]:
    cached = _source_cache.get_entry(key)
    if cached and time.time() - cached.checked_at < ttl:
        return cached.value, False, ""
    try:
        data = json.loads(fetch(url, "application/geo+json, application/json"))
        _source_cache.store(key, data)
        return data, False, ""
    except Exception as exc:
        if cached:
            return cached.value, True, str(exc)[:160]
        raise


def _read_earthquakes() -> tuple[list[dict], dict]:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=3)).date().isoformat()
    south, west, north, east = _BALKAN_BOX
    params = urlencode({
        "format": "geojson", "starttime": start, "minlatitude": south,
        "maxlatitude": north, "minlongitude": west, "maxlongitude": east,
        "minmagnitude": 2.5, "orderby": "time",
    })
    data, stale, error = _cached_json(
        "usgs-earthquakes",
        f"https://earthquake.usgs.gov/fdsnws/event/1/query?{params}",
        _QUAKE_TTL_S,
    )
    features = data.get("features", []) if isinstance(data, dict) else []
    return [feature for feature in features if isinstance(feature, dict)], {
        "id": "usgs", "name": "USGS EARTHQUAKE CATALOG", "ok": not error,
        "stale": stale, "error": error, "asof": (data.get("metadata", {}).get("generated", 0) / 1000) if isinstance(data, dict) else 0,
        "count": len(features), "url": "https://earthquake.usgs.gov/earthquakes/feed/",
    }


def _read_gdacs() -> tuple[list[dict], dict]:
    now = datetime.now(timezone.utc)
    params = urlencode({
        "eventlist": "EQ;FL;TC;WF", "fromdate": (now - timedelta(days=7)).date().isoformat(),
        "todate": now.date().isoformat(), "alertlevel": "red;orange",
    })
    data, stale, error = _cached_json(
        "gdacs-events", f"https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?{params}", _GDACS_TTL_S
    )
    features = data.get("features", []) if isinstance(data, dict) else []
    regional = [feature for feature in features if isinstance(feature, dict) and _gdacs_is_regional(feature)]
    return regional, {
        "id": "gdacs", "name": "GDACS RED / ORANGE ALERTS", "ok": not error,
        "stale": stale, "error": error, "asof": time.time(), "count": len(regional),
        "url": "https://www.gdacs.org/",
    }


def _inside_balkans(lon: float, lat: float) -> bool:
    south, west, north, east = _BALKAN_BOX
    return west <= lon <= east and south <= lat <= north


def _gdacs_is_regional(feature: dict) -> bool:
    props = feature.get("properties") or {}
    codes = {str(code).upper() for code in props.get("affectedcountries", [])}
    codes.update({str(props.get("iso3", "")).upper(), str(props.get("countryonland", "")).upper()})
    if codes.intersection(_COUNTRY_NAMES):
        return True
    coords = (feature.get("geometry") or {}).get("coordinates")
    while isinstance(coords, list) and coords and isinstance(coords[0], list):
        coords = coords[0]
    try:
        return _inside_balkans(float(coords[0]), float(coords[1]))
    except (TypeError, ValueError, IndexError):
        return False


def _read_weather() -> tuple[list[dict], dict]:
    params = urlencode({
        "latitude": ",".join(str(point[2]) for point in _WEATHER_POINTS),
        "longitude": ",".join(str(point[3]) for point in _WEATHER_POINTS),
        "current": "temperature_2m,precipitation,rain,wind_speed_10m,wind_gusts_10m",
        "hourly": "precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m",
        "forecast_days": 3, "timezone": "Europe/Sofia",
    })
    data, stale, error = _cached_json(
        "open-meteo-balkans", f"https://api.open-meteo.com/v1/forecast?{params}", _WEATHER_TTL_S
    )
    locations = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
    rows = []
    now = datetime.now().astimezone()
    for (name, country, lat, lon), location in zip(_WEATHER_POINTS, locations):
        if not isinstance(location, dict):
            continue
        current = location.get("current") or {}
        hourly = location.get("hourly") or {}
        times = hourly.get("time") or []
        indexes = []
        for index, value in enumerate(times):
            try:
                if datetime.fromisoformat(value).replace(tzinfo=now.tzinfo) <= now + timedelta(hours=24):
                    indexes.append(index)
            except (TypeError, ValueError):
                continue
        def values(field: str) -> list[float]:
            source = hourly.get(field) or []
            return [float(source[i]) for i in indexes if i < len(source) and source[i] is not None]
        rain = values("precipitation")
        gust = values("wind_gusts_10m")
        probability = values("precipitation_probability")
        rows.append({
            "location": name, "country": country,
            "lat": lat, "lon": lon,
            "current": {key: current.get(key) for key in ("time", "temperature_2m", "precipitation", "rain", "wind_speed_10m", "wind_gusts_10m")},
            "next_24h": {
                "precipitation_mm": round(sum(rain), 1), "max_wind_gust_kmh": round(max(gust), 1) if gust else None,
                "max_precip_probability_pct": max(probability) if probability else None,
            },
            "model_time": current.get("time", ""),
        })
    return rows, {
        "id": "open-meteo", "name": "OPEN-METEO FORECAST", "ok": not error,
        "stale": stale, "error": error, "asof": time.time(), "count": len(rows),
        "url": "https://open-meteo.com/en/docs",
    }


def _sample_baseline(key: str, value: int, now: float) -> dict:
    with _lock:
        samples = _history[key]
        if not samples or now - samples[-1][0] >= 240:
            samples.append((now, value))
        cutoff = now - 30 * 86400
        while samples and samples[0][0] < cutoff:
            samples.popleft()
        duration = now - samples[0][0] if samples else 0
        enough = len(samples) >= 24 and duration >= 24 * 3600
        baseline = median(item[1] for item in samples) if enough else None
        return {"samples": len(samples), "hours": round(duration / 3600, 1), "value": baseline}


def _signal(
    *, key: str, title: str, summary: str, relevance: str, severity: str,
    horizon: str, confidence: str, observations: list[dict], components: list[str],
    metric: float | None = None, media_count: int = 0,
) -> dict:
    now = int(time.time())
    with _lock:
        previous = _detections.get(key)
        status = "NEW"
        first_detected = now
        last_changed = now
        if previous:
            first_detected = previous["first_detected"]
            last_changed = previous["last_changed"]
            old_metric = previous.get("metric")
            if metric is not None and old_metric is not None and abs(metric - old_metric) > max(0.05, abs(old_metric) * 0.05):
                status = "STRENGTHENING" if metric > old_metric else "WEAKENING"
                last_changed = now
            else:
                status = "MONITORING"
            _detections[key] = {"first_detected": first_detected, "last_changed": last_changed, "metric": metric}
        else:
            _detections[key] = {"first_detected": now, "last_changed": now, "metric": metric}
    return {
        "id": key, "title": title, "summary": summary, "relevance": relevance,
        "severity": severity, "horizon": horizon, "confidence": confidence,
        "status": status, "first_detected": first_detected, "last_changed": last_changed,
        "updated_at": now, "observations": observations, "components": components,
        "media_count": media_count,
    }


def _event_time(feature: dict, milliseconds: bool = False) -> int:
    value = (feature.get("properties") or {}).get("time") or 0
    return int(value / 1000) if milliseconds else int(value)


def _distance_km(lon: float, lat: float, other_lon: float, other_lat: float) -> float:
    rad = math.pi / 180
    dlat, dlon = (other_lat - lat) * rad, (other_lon - lon) * rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat * rad) * math.cos(other_lat * rad) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _build_signals(
    news: dict, market: dict, gas: dict, ships: dict, aircraft: dict,
    conflict: dict, quakes: list[dict], gdacs: list[dict], weather: list[dict],
) -> list[dict]:
    now = int(time.time())
    signals: list[dict] = []
    articles = news.get("items", []) if isinstance(news, dict) else []
    recent_articles = [
        row for row in articles
        if now - int(_timestamp(row.get("published")) or 0) < 3 * 86400
    ]
    energy_words = re_compile(r"energy|gas|oil|fuel|electric|power|pipeline|refinery|нефт|енерг|горив|електро|\bgaz\b|\benergie\b|petrol")
    energy_news = [row for row in recent_articles if energy_words.search(row.get("title", ""))]
    domains = {row.get("source", "") for row in energy_news}
    market_rows = (market.get("items") or []) + (gas.get("items") or [])
    energy_moves = [row for row in market_rows if row.get("symbol") in {"BZ=F", "CL=F", "NG=F"} and abs(float(row.get("pct") or 0)) >= (4 if row.get("symbol") == "NG=F" else 2.5)]
    if energy_moves and len(domains) >= 2:
        observations = [
            {"label": f"{row.get('name')} daily move", "value": f"{float(row.get('pct')):+.2f}%", "source": "Yahoo Finance", "source_url": "https://finance.yahoo.com/", "observed_at": row.get("asof"), "series": row.get("series", [])}
            for row in energy_moves
        ]
        observations.extend({"label": row.get("title", "Regional energy headline"), "value": row.get("source", "Publisher"), "source": row.get("source", "Publisher"), "source_url": row.get("url", ""), "observed_at": _timestamp(row.get("published"))} for row in energy_news[:5])
        move = max(abs(float(row.get("pct") or 0)) for row in energy_moves)
        signals.append(_signal(
            key="regional-energy", title="ENERGY PRICE MOVE · REGIONAL REPORTING",
            summary="A notable oil or gas price move coincides with recent energy coverage from multiple Balkan publishers. This shows co-occurrence, not proof that either caused the other.",
            relevance="BULGARIA / BALKANS", severity="MEDIUM", horizon="CURRENT · 1–3 DAYS",
            confidence="MEDIUM" if len(energy_moves) + len(domains) >= 4 else "LOW",
            observations=observations, components=["MARKET", "REGIONAL NEWS"], metric=move,
            media_count=len(energy_news),
        ))

    # Recent USGS events are observations, not forecasts. Proximity to Bulgaria
    # is calculated geometrically and the popup keeps the source record link.
    for feature in quakes:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2 or float(props.get("mag") or 0) < 3.5:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        age_h = max(0, (now - _event_time(feature, milliseconds=True)) / 3600)
        if age_h > 72:
            continue
        sofia_km = _distance_km(lon, lat, 23.3219, 42.6977)
        region = "BULGARIA" if sofia_km <= 250 else "BALKANS"
        signals.append(_signal(
            key=f"quake-{feature.get('id')}", title="OBSERVED EARTHQUAKE · " + str(props.get("place") or "BALKAN REGION").upper(),
            summary=f"USGS reports a magnitude {float(props.get('mag')):.1f} earthquake about {sofia_km:.0f} km from Sofia. This is an observed event; the proximity estimate does not establish damage or future activity.",
            relevance=region, severity="MEDIUM" if float(props.get("mag")) >= 5 else "LOW",
            horizon="OBSERVED · LAST 72 HOURS", confidence="HIGH",
            observations=[{"label": "USGS earthquake report", "value": f"M{float(props.get('mag')):.1f} · {sofia_km:.0f} km from Sofia", "source": "USGS", "source_url": props.get("url", "https://earthquake.usgs.gov/earthquakes/feed/"), "observed_at": _event_time(feature, milliseconds=True), "location": [lon, lat]}],
            components=["USGS EARTHQUAKE CATALOG"], metric=float(props.get("mag")),
        ))

    for feature in gdacs:
        props = feature.get("properties") or {}
        alert = str(props.get("alertlevel", "")).upper()
        url = (props.get("url") or {}).get("report", "https://www.gdacs.org/")
        affected = [
            _COUNTRY_NAMES[code] for code in (props.get("affectedcountries") or [])
            if str(code).upper() in _COUNTRY_NAMES
        ]
        if not affected and props.get("country"):
            affected = [str(props["country"])]
        signals.append(_signal(
            key=f"gdacs-{props.get('eventtype')}-{props.get('eventid')}",
            title=f"GDACS {alert} ALERT · {str(props.get('name') or props.get('eventtype') or 'HAZARD').upper()}",
            summary="An official GDACS alert is active. Alert level is the provider’s classification; local effects depend on the event footprint and exposure.",
            relevance=", ".join(affected) if affected else "BALKANS", severity="HIGH" if alert == "RED" else "MEDIUM",
            horizon="ACTIVE ALERT", confidence="HIGH",
            observations=[{"label": "GDACS alert", "value": f"{alert} · {props.get('severitydata', {}).get('severitytext', props.get('eventtype', 'event'))}", "source": "GDACS", "source_url": url, "observed_at": props.get("datemodified") or props.get("fromdate"), "location": (feature.get("geometry") or {}).get("coordinates")}],
            components=["GDACS PUBLIC DISASTER ALERT"], metric=float(props.get("alertscore") or 0),
        ))

    hazard_rows = []
    for row in weather:
        next_day = row.get("next_24h") or {}
        rain = float(next_day.get("precipitation_mm") or 0)
        gust = float(next_day.get("max_wind_gust_kmh") or 0)
        if rain >= 50 or gust >= 90:
            hazard_rows.append((row, rain, gust))
    for row, rain, gust in hazard_rows:
        hazard = "HEAVY RAIN" if rain >= 50 else "STRONG WIND"
        level = "HIGH" if rain >= 80 or gust >= 110 else "MEDIUM"
        signals.append(_signal(
            key=f"weather-{row['location']}-{hazard.lower().replace(' ', '-')}",
            title=f"FORECAST WATCH · {hazard} NEAR {row['location'].upper()}",
            summary="Open-Meteo’s current forecast crosses a conservative watch threshold. It is model output, not an official warning or a prediction of local damage.",
            relevance="BULGARIA" if row.get("country") == "BG" else "BALKANS", severity=level,
            horizon="NEXT 24 HOURS", confidence="LOW",
            observations=[{"label": "24-hour forecast", "value": f"{rain:.1f} mm precipitation · {gust:.0f} km/h max gust", "source": "Open-Meteo", "source_url": "https://open-meteo.com/en/docs", "observed_at": row.get("model_time"), "location": [row["lon"], row["lat"]]}],
            components=["OPEN-METEO FORECAST MODEL"], metric=max(rain / 50, gust / 90),
        ))

    # A comparable baseline is shown only after the app has actually sampled
    # this same fixed region for a full day; restart means a fresh warm-up.
    baselines = {}
    for key, label, payload in (("ais", "AIS", ships), ("air", "ADS-B", aircraft)):
        if not isinstance(payload, dict):
            continue
        count = len(payload.get("features", [])) if key == "ais" else len(payload.get("aircraft", []))
        baseline = _sample_baseline(key, count, time.time())
        baselines[key] = (count, baseline)
        payload["baseline"] = baseline
        payload["count"] = count

    shipping_words = re_compile(r"ship|vessel|port|harbou?r|shipping|cargo|black sea|maritime|пристанищ|кораб|порт|naval|naviga")
    aviation_words = re_compile(r"airport|airspace|flight|aviation|airline|runway|airport|летищ|авиац|flight")
    shipping_news = [row for row in recent_articles if shipping_words.search(row.get("title", ""))]
    aviation_news = [row for row in recent_articles if aviation_words.search(row.get("title", ""))]
    ship_baseline = baselines.get("ais")
    if ship_baseline and ship_baseline[1]["value"] not in (None, 0):
        count, baseline = ship_baseline
        change = (count / baseline["value"] - 1) * 100
        publishers = {row.get("source", "") for row in shipping_news if row.get("source")}
        if abs(change) >= 30 and len(publishers) >= 2:
            observations = [
                {"label": "Loaded AIS reports · fixed Black Sea view", "value": f"{count} now · {change:+.0f}% vs {baseline['hours']:.0f}h median ({baseline['samples']} samples)", "source": "Open Waters AIS", "source_url": "https://ais.openwaters.io/", "observed_at": (ships or {}).get("received_at")},
            ]
            observations.extend({"label": row.get("title", "Shipping headline"), "value": row.get("source", "Publisher"), "source": row.get("source", "Publisher"), "source_url": row.get("url", ""), "observed_at": _timestamp(row.get("published"))} for row in shipping_news[:4])
            signals.append(_signal(
                key="black-sea-ais-news", title="BLACK SEA AIS COUNT SHIFT + REGIONAL REPORTING",
                summary="The same fixed AIS viewport differs from its locally collected 24-hour median and regional publishers also report on shipping. Receiver coverage can change, so the AIS count is a report-volume proxy, not a vessel census.",
                relevance="BULGARIA / BLACK SEA", severity="MEDIUM", horizon="CURRENT · MONITOR",
                confidence="MEDIUM", observations=observations, components=["AIS REPORT COUNT", "MULTI-PUBLISHER NEWS"],
                metric=abs(change), media_count=len(shipping_news),
            ))

    # Conflict/GPSJam are existing feeds. Expose Balkan observations only;
    # a coded event or daily GNSS cell alone is kept at monitoring confidence.
    reports = (conflict or {}).get("reports", [])
    regional_reports = []
    for feature in reports:
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        try:
            lon, lat = float(coords[0]), float(coords[1])
        except (ValueError, TypeError, IndexError):
            continue
        if _inside_balkans(lon, lat):
            regional_reports.append(feature)
    if regional_reports:
        observations = []
        for feature in regional_reports[:5]:
            props = feature.get("properties") or {}
            observations.append({"label": props.get("name", "GDELT event"), "value": props.get("mentionedthemes", "Coded event report"), "source": "GDELT", "source_url": props.get("url", ""), "observed_at": props.get("event_date"), "location": (feature.get("geometry") or {}).get("coordinates")})
        signals.append(_signal(
            key="balkan-conflict-reporting", title="GDELT-CODED SECURITY REPORTS · BALKANS",
            summary=f"{len(regional_reports)} recent locations appear in GDELT’s filtered military-actor violence export. These are media-derived coded reports, not verified unit positions.",
            relevance="BALKANS", severity="MEDIUM", horizon="REPORTS · LAST 7 DAYS",
            confidence="LOW", observations=observations, components=["GDELT CODED EVENT EXPORT"], metric=len(regional_reports),
        ))
    gpsjam = (conflict or {}).get("gpsjam") or {}
    gnss = []
    for feature in gpsjam.get("features", []):
        ring = (feature.get("geometry") or {}).get("coordinates", [[]])[0]
        if not ring:
            continue
        lon = sum(point[0] for point in ring[:-1] or ring) / len(ring[:-1] or ring)
        lat = sum(point[1] for point in ring[:-1] or ring) / len(ring[:-1] or ring)
        percent = float((feature.get("properties") or {}).get("percent") or 0)
        if _inside_balkans(lon, lat) and percent >= 10:
            gnss.append((feature, lon, lat, percent))
    if gnss:
        feature, lon, lat, percent = max(gnss, key=lambda item: item[3])
        gps_props = feature.get("properties") or {}
        signals.append(_signal(
            key="balkan-gnss-observations", title="GPSJAM GNSS ACCURACY ANOMALIES · BALKANS",
            summary="GPSJam’s daily aggregate shows aircraft-reported navigation-accuracy anomalies. It does not confirm jamming or identify a cause; coverage and sample size vary.",
            relevance="BALKANS", severity="LOW", horizon=f"DAILY AGGREGATE · {gpsjam.get('date', 'DATE UNKNOWN')}", confidence="LOW",
            observations=[{"label": "Highest Balkan hex", "value": f"{percent:.1f}% reported anomaly · {gps_props.get('bad', 0)} affected / {gps_props.get('good', 0)} unaffected", "source": "GPSJam", "source_url": "https://gpsjam.org/", "observed_at": gpsjam.get("date"), "location": [lon, lat]}],
            components=["GPSJAM DAILY H3 AGGREGATE"], metric=percent,
        ))
        air_baseline = baselines.get("air")
        if air_baseline and air_baseline[1]["value"] not in (None, 0):
            air_count, baseline = air_baseline
            air_change = (air_count / baseline["value"] - 1) * 100
            if abs(air_change) >= 30 and len({row.get("source", "") for row in aviation_news if row.get("source")}) >= 2:
                signals.append(_signal(
                    key="balkan-aviation-gnss", title="AVIATION DATA SHIFT + GNSS ANOMALY REPORTS",
                    summary="OpenSky report volume differs from its same-region rolling baseline, while GPSJam reports daily GNSS accuracy anomalies and multiple publishers cover aviation. These are co-occurring signals; GPS jamming or an operational cause is not established.",
                    relevance="BULGARIA / BALKANS", severity="MEDIUM", horizon="CURRENT · DAILY GNSS AGGREGATE",
                    confidence="LOW", observations=[
                        {"label": "OpenSky positions", "value": f"{air_count} now · {air_change:+.0f}% vs {baseline['hours']:.0f}h median", "source": "OpenSky", "source_url": "https://opensky-network.org/", "observed_at": (aircraft or {}).get("time")},
                        {"label": "GPSJam anomaly", "value": f"{percent:.1f}% in highest Balkan hex", "source": "GPSJam", "source_url": "https://gpsjam.org/", "observed_at": gpsjam.get("date"), "location": [lon, lat]},
                        *[{"label": row.get("title", "Aviation headline"), "value": row.get("source", "Publisher"), "source": row.get("source", "Publisher"), "source_url": row.get("url", ""), "observed_at": _timestamp(row.get("published"))} for row in aviation_news[:3]],
                    ], components=["OPENSKY BASELINE", "GPSJAM DAILY AGGREGATE", "MULTI-PUBLISHER NEWS"],
                    metric=max(abs(air_change), percent), media_count=len(aviation_news),
                ))

    signals.sort(key=lambda item: ({"HIGH": 3, "MEDIUM": 2, "LOW": 1}.get(item["severity"], 0), item["updated_at"]), reverse=True)
    return signals[:40]


def re_compile(pattern: str):
    import re

    return re.compile(pattern, re.IGNORECASE)


def _timestamp(value: str | None) -> float:
    if not value:
        return 0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        from email.utils import parsedate_to_datetime

        try:
            parsed = parsedate_to_datetime(value)
            return parsed.timestamp() if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc).timestamp()
        except (TypeError, ValueError, OverflowError):
            return 0


def _source(name: str, result: object, error: str = "") -> dict:
    if error:
        return {"id": name, "name": name.upper(), "ok": False, "stale": False, "error": error[:160], "asof": 0, "count": 0}
    return {"id": name, "name": name.upper(), "ok": True, "stale": False, "error": "", "asof": time.time(), "count": len(result) if isinstance(result, (list, dict)) else 0}


def impact_snapshot() -> tuple[int, dict]:
    """Return current Balkan-first signals, observations and source health."""
    cached = _payload_cache.get("latest")
    if cached is not None:
        return 200, cached

    tasks = {
        "news": lambda: aggregate_news("balkans"),
        "market": lambda: market_snapshot("CORE"),
        "gas": lambda: quotes_for_symbols("NG=F"),
        "ships": lambda: vessel_snapshot(_BG_AIS_BOX),
        "air": lambda: aircraft_snapshot(_BG_AIR_BOX),
        "conflict": lambda: war_snapshot(),
        "quakes": _read_earthquakes,
        "gdacs": _read_gdacs,
        "weather": _read_weather,
    }
    futures = {key: shared_pool().submit(task) for key, task in tasks.items()}
    results: dict[str, object] = {}
    errors: dict[str, str] = {}
    for key, future in futures.items():
        try:
            results[key] = future.result(timeout=28)
        except Exception as exc:
            errors[key] = str(exc)[:160]
            results[key] = None

    news = results.get("news") if isinstance(results.get("news"), dict) else {}
    market = results.get("market") if isinstance(results.get("market"), dict) else {}
    gas = results.get("gas") if isinstance(results.get("gas"), dict) else {}
    ship_result = results.get("ships")
    ships = ship_result[1] if isinstance(ship_result, tuple) and ship_result[0] == 200 else {}
    air_result = results.get("air")
    aircraft = air_result[1] if isinstance(air_result, tuple) and air_result[0] == 200 else {}
    conflict_result = results.get("conflict")
    conflict = conflict_result[1] if isinstance(conflict_result, tuple) and conflict_result[0] == 200 else {}
    quake_result = results.get("quakes")
    quakes = quake_result[0] if isinstance(quake_result, tuple) else []
    gdacs_result = results.get("gdacs")
    gdacs = gdacs_result[0] if isinstance(gdacs_result, tuple) else []
    weather_result = results.get("weather")
    weather = weather_result[0] if isinstance(weather_result, tuple) else []

    sources = []
    sources.append({"id": "balkan-news", "name": "BALKAN NEWS", "ok": bool(news.get("sourceCount")), "stale": False, "error": errors.get("news", ""), "asof": news.get("fetched", 0), "count": len(news.get("items", [])), "detail": f"{news.get('sourceCount', 0)}/{len(news.get('sources', []))} publisher/index feeds"})
    sources.append({"id": "market", "name": "MARKETS", "ok": bool(market.get("items")), "stale": False, "error": errors.get("market", ""), "asof": market.get("fetched", 0), "count": len(market.get("items", [])), "detail": market.get("source", "")})
    sources.append({"id": "ais", "name": "OPEN WATERS AIS", "ok": bool(isinstance(ship_result, tuple) and ship_result[0] == 200), "stale": bool((ships or {}).get("stale")), "error": errors.get("ships", ""), "asof": (ships or {}).get("received_at", 0), "count": len((ships or {}).get("features", [])), "detail": "Fixed Bulgaria / western Black Sea snapshot"})
    sources.append({"id": "opensky", "name": "OPENSKY ADS-B", "ok": bool(isinstance(air_result, tuple) and air_result[0] == 200), "stale": bool((aircraft or {}).get("stale")), "error": errors.get("air", ""), "asof": (aircraft or {}).get("time", 0), "count": len((aircraft or {}).get("aircraft", [])), "detail": "Anonymous state-vector snapshot; coverage varies"})
    for key, result in (("quakes", quake_result), ("gdacs", gdacs_result), ("weather", weather_result)):
        if isinstance(result, tuple) and len(result) == 2:
            sources.append(result[1])
        else:
            sources.append(_source(key, None, errors.get(key, "Unavailable")))
    sources.append({"id": "gdelt-gpsjam", "name": "GDELT / GPSJAM", "ok": bool(conflict), "stale": bool((conflict or {}).get("stale")), "error": errors.get("conflict", (conflict_result[1].get("error", "") if isinstance(conflict_result, tuple) else "")), "asof": (conflict or {}).get("updated_at", 0), "count": len((conflict or {}).get("reports", [])), "detail": "Coded media events + daily aircraft-reported GNSS aggregate"})

    signals = _build_signals(news, market, gas, ships, aircraft, conflict, quakes, gdacs, weather)
    healthy = sum(bool(source.get("ok")) for source in sources)
    payload = {
        "signals": signals,
        "sources": sources,
        "observations": {
            "market": market.get("items", []) + gas.get("items", []),
            "weather": weather,
            "earthquakes": quakes[:30],
            "gdacs": gdacs[:30],
            "ais": {"count": len((ships or {}).get("features", [])), "baseline": (ships or {}).get("baseline", {})},
            "air": {"count": len((aircraft or {}).get("aircraft", [])), "baseline": (aircraft or {}).get("baseline", {})},
            "news": news.get("items", [])[:60],
        },
        "updated_at": int(time.time()),
        "status": "LIVE" if healthy >= 6 else "DEGRADED" if healthy else "OFFLINE",
        "healthy_sources": healthy,
        "source_count": len(sources),
        "baseline_note": "AIS and ADS-B baselines build from this server’s same-region samples. A 24-hour baseline appears after at least 24 hours and 24 samples; restart resets collection.",
    }
    _payload_cache.store("latest", payload)
    return 200, payload
