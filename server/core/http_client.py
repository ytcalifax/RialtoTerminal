"""Boundary-safe HTTP fetching for the fixed upstream data sources.

Every outbound request in the service layer goes through :func:`fetch`, which
applies the defensive guards that raw ``urllib`` calls would miss:
scheme whitelisting, response-size capping, uniform timeouts and a single
exception type for callers to handle.
"""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPMessage

from ..config import MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_S, USER_AGENT


class UpstreamError(RuntimeError):
    """Raised when an upstream source cannot be read within safe limits."""


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
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read(MAX_RESPONSE_BYTES), response.headers
    except urllib.error.HTTPError:
        raise
    except Exception as exc:  # URLError, socket.timeout, ssl errors, ...
        raise UpstreamError(str(exc)) from exc
