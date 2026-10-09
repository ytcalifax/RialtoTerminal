"""The HTTP request handler: JSON API dispatch plus public frontend serving.

``SimpleHTTPRequestHandler`` is development-grade (no TLS, no auth — see the
Python docs warning), so the server binds to loopback only and serves files
from the project root regardless of the process working directory.
"""

from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import cast
from urllib.parse import parse_qs, unquote, urlparse

from ..core.logging_config import logger
from .routes import API_ROUTES

# server/web/handler.py -> server/ -> project root (holds index.html, assets/).
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_ASSETS_ROOT = PROJECT_ROOT / "assets"
NOT_PUBLIC_PATH = PROJECT_ROOT / "__not_public__"


class TerminalRequestHandler(SimpleHTTPRequestHandler):
    """Serve API routes and the frontend entry point plus assets only."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        """Keep static serving inside the deliberate public web surface.

        SimpleHTTPRequestHandler serves every file beneath its directory by
        default. Since the project root also contains `.env`, source, and VCS
        metadata, expose only the frontend entry point and assets tree.
        """
        raw_url_path = urlparse(path).path
        url_path = unquote(raw_url_path)
        if url_path in {"/", "/index.html"}:
            return str(PROJECT_ROOT / "index.html")
        if not url_path.startswith("/assets/"):
            return str(NOT_PUBLIC_PATH)

        # Pass the original escaped URL to the stdlib implementation, which
        # decodes it once. Decoding here and there would allow double-encoded
        # dot segments to become hidden paths on the second pass.
        candidate = Path(super().translate_path(path)).resolve()
        assets_root = PUBLIC_ASSETS_ROOT.resolve()
        if not candidate.is_relative_to(assets_root):
            return str(NOT_PUBLIC_PATH)
        if any(part.startswith(".") for part in candidate.relative_to(assets_root).parts):
            return str(NOT_PUBLIC_PATH)
        return str(candidate)

    def end_headers(self) -> None:
        # no-store: every panel polls for fresh data; nosniff: the API serves
        # JSON only and must never be reinterpreted by the browser.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        """Keep stdlib HTTP access logs in the shared application format."""
        logger.info("http.client=%s %s", self.address_string(), format % args)

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
            params = cast(dict[str, list[str]], parse_qs(parsed.query))
            status, payload = route(params)
        except Exception:
            # Last-ditch guard: a bug in one route must never kill the worker
            # thread silently; keep details in server logs, not the response.
            logger.exception("api.request_failed path=%s", parsed.path)
            status, payload = 500, {"error": "Internal server error."}
        self.send_json(payload, status)
