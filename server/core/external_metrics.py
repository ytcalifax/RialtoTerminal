from __future__ import annotations

import logging
import sys
from collections import deque
from threading import Lock
from time import perf_counter, time
from urllib.parse import parse_qsl, urlencode, urlsplit

logger = logging.getLogger("rialto")

try:
    import debugpy
except ImportError:
    debugpy = None

_lock = Lock()
_enabled = False
_started_at = time()
_next_id = 0
_totals = {
    "requests": 0,
    "completed": 0,
    "in_flight": 0,
    "failures": 0,
    "request_bytes": 0,
    "response_bytes": 0,
    "duration_ms": 0.0,
}
_services: dict[str, dict] = {}
_events: deque[dict] = deque(maxlen=250)
_events_by_id: dict[int, dict] = {}
_SENSITIVE_QUERY_KEYS = {
    "api_key", "apikey", "token", "access_token", "secret",
    "password", "authorization",
}


def _request_target(url: str) -> tuple[str, str]:
    parsed = urlsplit(url)
    path = parsed.path or "/"
    query = urlencode([
        (key, "[redacted]" if key.casefold() in _SENSITIVE_QUERY_KEYS else value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
    ])
    return path, f"{path}?{query}" if query else path


def _debugger_attached() -> bool:
    if sys.gettrace() is not None:
        return True
    try:
        is_client_connected = getattr(debugpy, "is_client_connected", None)
        return bool(callable(is_client_connected) and is_client_connected())
    except Exception:
        return False


def _reset_locked() -> None:
    global _started_at, _next_id
    _started_at = time()
    _next_id = 0
    _totals.update({
        "requests": 0,
        "completed": 0,
        "in_flight": 0,
        "failures": 0,
        "request_bytes": 0,
        "response_bytes": 0,
        "duration_ms": 0.0,
    })
    _services.clear()
    _events.clear()
    _events_by_id.clear()


def _sync_debugger_state() -> None:
    global _enabled
    attached = _debugger_attached()
    with _lock:
        if attached != _enabled:
            _enabled = attached
            _reset_locked()


def begin_request(url: str, method: str = "GET", request_bytes: int = 0) -> dict | None:
    global _next_id
    _sync_debugger_state()
    with _lock:
        if not _enabled:
            return None
        parsed = urlsplit(url)
        service = parsed.hostname or "unknown"
        path, target = _request_target(url)
        service_key = f"{method} {service} {target}"
        _next_id += 1
        request_id = _next_id
        started = perf_counter()
        event = {
            "id": request_id,
            "time": time(),
            "service": service,
            "path": path,
            "target": target,
            "method": method,
            "status": "IN FLIGHT",
            "duration_ms": None,
            "request_bytes": max(0, int(request_bytes)),
            "response_bytes": 0,
            "error": "",
            "_started": started,
        }
        if len(_events) == _events.maxlen:
            evicted = _events.popleft()
            _events_by_id.pop(evicted["id"], None)
        _events.append(event)
        _events_by_id[request_id] = event
        _totals["requests"] += 1
        _totals["in_flight"] += 1
        _totals["request_bytes"] += event["request_bytes"]
        stats = _services.setdefault(service_key, {
            "service": service,
            "method": method,
            "target": target,
            "requests": 0,
            "completed": 0,
            "failures": 0,
            "in_flight": 0,
            "request_bytes": 0,
            "response_bytes": 0,
            "duration_ms": 0.0,
            "last_duration_ms": None,
            "last_status": "IN FLIGHT",
            "last_path": path,
        })
        stats["requests"] += 1
        stats["in_flight"] += 1
        stats["request_bytes"] += event["request_bytes"]
        stats["last_status"] = "IN FLIGHT"
        stats["last_path"] = path
    logger.info("external_api.start method=%s service=%s target=%s", method, service, target)
    return {
        "id": request_id,
        "started": started,
        "service": service,
        "path": path,
        "target": target,
        "service_key": service_key,
        "method": method,
        "request_bytes": event["request_bytes"],
    }


def finish_request(
    token: dict | None,
    status: int | None,
    response_bytes: int = 0,
    error: str = "",
) -> None:
    if token is None:
        return
    duration_ms = round((perf_counter() - token["started"]) * 1000, 1)
    response_bytes = max(0, int(response_bytes))
    failed = error != "" or status is None or status >= 400
    with _lock:
        event = _events_by_id.get(token["id"])
        service = _services.get(token["service_key"])
        if event is not None:
            event["status"] = status if status is not None else "ERROR"
            event["duration_ms"] = duration_ms
            event["response_bytes"] = response_bytes
            event["error"] = error
            event.pop("_started", None)
        _totals["completed"] += 1
        _totals["in_flight"] = max(0, _totals["in_flight"] - 1)
        _totals["response_bytes"] += response_bytes
        _totals["duration_ms"] += duration_ms
        if service is not None:
            service["completed"] += 1
            service["in_flight"] = max(0, service["in_flight"] - 1)
            service["response_bytes"] += response_bytes
            service["duration_ms"] += duration_ms
            service["last_duration_ms"] = duration_ms
            service["last_status"] = status if status is not None else "ERROR"
            service["last_path"] = token["path"]
        if failed:
            _totals["failures"] += 1
            if service is not None:
                service["failures"] += 1
        log_status = status if status is not None else "ERROR"
    logger.info(
        "external_api.done method=%s service=%s target=%s status=%s duration_ms=%s "
        "request_bytes=%s response_bytes=%s error=%s",
        token["method"], token["service"], token["target"], log_status,
        duration_ms, token["request_bytes"], response_bytes, error or "none",
    )


def debug_snapshot() -> dict:
    _sync_debugger_state()
    with _lock:
        completed = _totals["completed"]
        total = {key: value for key, value in _totals.items() if key != "duration_ms"}
        total["average_duration_ms"] = round(_totals["duration_ms"] / completed, 1) if completed else 0
        services = []
        for stats in _services.values():
            row = {key: value for key, value in stats.items() if key != "duration_ms"}
            row["average_duration_ms"] = round(stats["duration_ms"] / stats["completed"], 1) if stats["completed"] else 0
            services.append(row)
        recent = [
            {key: value for key, value in event.items() if not key.startswith("_")}
            for event in reversed(_events)
        ]
        return {
            "enabled": _enabled,
            "started_at": _started_at,
            "uptime_seconds": int(time() - _started_at),
            "totals": total,
            "services": sorted(services, key=lambda row: row["requests"], reverse=True),
            "recent": recent,
        }
