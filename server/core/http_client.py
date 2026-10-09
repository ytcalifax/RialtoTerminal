from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPMessage

from ..config import MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_S, USER_AGENT
from .external_metrics import begin_request, finish_request

_cooldown_lock = threading.Lock()
_host_cooldowns: dict[str, float] = {}


def _wait_for_host(host: str, retry_scope: str | None = None) -> None:
    with _cooldown_lock:
        cooldown_until = max(
            _host_cooldowns.get(host, 0.0),
            _host_cooldowns.get(retry_scope, 0.0) if retry_scope else 0.0,
        )
    remaining = cooldown_until - time.time()
    if remaining > 0:
        raise UpstreamError(f"Upstream cooldown active for {host} ({remaining:.0f}s)")


def _remember_retry_after(host: str, value: str | None) -> None:
    if value:
        try:
            delay = max(0.0, float(value))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                delay = max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError, OverflowError):
                delay = 60.0
    else:
        delay = 60.0
    with _cooldown_lock:
        _host_cooldowns[host] = max(_host_cooldowns.get(host, 0.0), time.time() + delay)


class UpstreamError(RuntimeError):
    pass


def fetch(
    url: str,
    accept: str = "*/*",
    timeout: float = UPSTREAM_TIMEOUT_S,
) -> bytes:
    """Fetch ``url`` and return the body (at most ``MAX_RESPONSE_BYTES``).

    Defensive behaviour:

    * only ``http``/``https`` schemes are honoured — the URL must never come
      from user input, but the guard makes the invariant explicit;
    * the body is truncated to ``MAX_RESPONSE_BYTES`` so an oversized or
      hostile upstream cannot exhaust memory;
    * transport failures are normalised to :class:`UpstreamError`.
      :class:`urllib.error.HTTPError` passes through unchanged because some
      callers branch on the HTTP status.
    """
    body, _ = fetch_response(url, accept=accept, timeout=timeout)
    return body


def fetch_response(
    url: str,
    accept: str = "*/*",
    timeout: float = UPSTREAM_TIMEOUT_S,
    headers: dict[str, str] | None = None,
    retry_scope: str | None = None,
) -> tuple[bytes, HTTPMessage]:
    """Like :func:`fetch` but also returns the response headers.

    Only :meth:`bse_sofix_row` needs headers (the exchange's ``Date`` header
    timestamps the index snapshot); everyone else uses :func:`fetch`.
    """
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme not in {"http", "https"}:
        raise UpstreamError(f"Refused non-HTTP upstream scheme: {scheme!r}")

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
            **(headers or {}),
        },
    )
    host = urllib.parse.urlsplit(url).hostname or "unknown"
    _wait_for_host(host, retry_scope)
    metric = begin_request(url)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES)
            finish_request(metric, response.status, len(body))
            return body, response.headers
    except urllib.error.HTTPError as exc:
        finish_request(metric, exc.code, 0, f"HTTP {exc.code}")
        if exc.code in {429, 503}:
            retry_after = None
            cooldown_scope = host
            if exc.headers:
                opensky_retry = exc.headers.get("X-Rate-Limit-Retry-After-Seconds")
                retry_after = opensky_retry or exc.headers.get("Retry-After")
                if exc.code == 429 and opensky_retry and retry_scope:
                    cooldown_scope = retry_scope
            _remember_retry_after(
                cooldown_scope,
                retry_after,
            )
        raise
    except Exception as exc:  # URLError, socket.timeout, ssl errors, ...
        finish_request(metric, None, 0, type(exc).__name__)
        raise UpstreamError(str(exc)) from exc
