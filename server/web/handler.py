"""The HTTP request handler: JSON API dispatch plus static file serving.

``SimpleHTTPRequestHandler`` is development-grade (no TLS, no auth — see the
Python docs warning), so the server binds to loopback only and serves files
from the project root regardless of the process working directory.
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from http.server import SimpleHTTPRequestHandler

from .routes import API_ROUTES

# server/web/handler.py -> server/ -> project root (holds index.html, assets/).
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class TerminalRequestHandler(SimpleHTTPRequestHandler):
    """Serve ``/api/*`` from the route table and everything else from disk."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def end_headers(self) -> None:
        # no-store: every panel polls for fresh data; nosniff: the API serves
        # JSON only and must never be reinterpreted by the browser.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, payload: dict, status: int = 200) -> None:
        """Serialize ``payload`` as UTF-8 JSON with explicit length."""
        try:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # noinspection PyPep8Naming — do_GET/do_POST are the stdlib dispatch names
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = API_ROUTES.get(parsed.path)
        if route is None:
            super().do_GET()  # not an API path: serve a static asset
            return
        try:
            status, payload = route(parse_qs(parsed.query))
        except Exception as exc:
            # Last-ditch guard: a bug in one route must never kill the worker
            # thread silently; the client gets a structured 500 instead.
            status, payload = 500, {"error": f"Internal error: {exc}"}
        self.send_json(payload, status)
