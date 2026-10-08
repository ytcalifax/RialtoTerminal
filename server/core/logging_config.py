"""Shared process-wide log formatting for Rialto."""

from __future__ import annotations

import logging
import sys


def configure_logging() -> None:
    """Send all application logs to stdout with one timestamped format."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s.%(msecs)03d %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
        force=True,
    )


logger = logging.getLogger("rialto")
