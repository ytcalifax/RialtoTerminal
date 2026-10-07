"""Shared bounded worker pool for concurrent upstream fetches.

News and market fan-outs used to build a throwaway ``ThreadPoolExecutor`` per
request. A single process-wide pool with a fixed worker count gives the same
parallelism while keeping total thread usage predictable under load.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from ..config import MAX_WORKERS

_POOL: ThreadPoolExecutor | None = None


def shared_pool() -> ThreadPoolExecutor:
    """Return the process-wide executor, creating it on first use."""
    global _POOL
    if _POOL is None:
        _POOL = ThreadPoolExecutor(
            max_workers=MAX_WORKERS, thread_name_prefix="upstream"
        )
    return _POOL
