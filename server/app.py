"""Application assembly and entry point.

Wires the route table into a threaded HTTP server. Run either as
``python3 server.py`` (root shim) or ``python3 -m server``.
"""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from http.server import ThreadingHTTPServer

from .config import BIND_HOST, PORT
from .core.external_metrics import set_debug_enabled
from .web.handler import TerminalRequestHandler


def create_server() -> ThreadingHTTPServer:
    """Build the terminal server bound to the loopback interface.

    Loopback-only binding is deliberate: the stdlib HTTP stack provides no
    TLS or authentication, so the service must never be exposed directly to
    untrusted networks. (For a shared deployment, put a real WSGI server or
    reverse proxy in front instead.)
    """
    return ThreadingHTTPServer((BIND_HOST, PORT), TerminalRequestHandler)


def main(argv: Sequence[str] | None = None) -> None:
    """Serve until interrupted, releasing the socket cleanly on Ctrl+C."""
    parser = argparse.ArgumentParser(description="Run the Rialto Terminal web app.")
    parser.add_argument("--debug", action="store_true", help="log and expose outbound API request metrics")
    args = parser.parse_args(argv)
    set_debug_enabled(args.debug)
    server = create_server()
    print(f"Terminal UI running at http://localhost:{PORT}")
    if args.debug:
        print("External API metrics enabled; open the DEBUG button in the UI or /api/debug/stats.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass  # normal shutdown path, not an error
    finally:
        server.server_close()
