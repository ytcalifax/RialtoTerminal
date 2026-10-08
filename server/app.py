"""Application assembly and entry point.

Wires the route table into a threaded HTTP server. Run either as
``python3 server.py`` (root shim) or ``python3 -m server``.
"""

from __future__ import annotations

from http.server import ThreadingHTTPServer

from .config import BIND_HOST, PORT
from .core.logging_config import configure_logging, logger
from .web.handler import TerminalRequestHandler


def create_server() -> ThreadingHTTPServer:
    """Build the terminal server bound to the loopback interface.

    Loopback-only binding is deliberate: the stdlib HTTP stack provides no
    TLS or authentication, so the service must never be exposed directly to
    untrusted networks. (For a shared deployment, put a real WSGI server or
    reverse proxy in front instead.)
    """
    configure_logging()
    return ThreadingHTTPServer((BIND_HOST, PORT), TerminalRequestHandler)


def main() -> None:
    """Serve until interrupted, releasing the socket cleanly on Ctrl+C."""
    server = create_server()
    logger.info("server.started url=http://localhost:%s", PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass  # normal shutdown path, not an error
    finally:
        server.server_close()
