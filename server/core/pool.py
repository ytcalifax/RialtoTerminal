from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

from ..config import MAX_WORKERS

_POOL: ThreadPoolExecutor | None = None
_POOL_LOCK = threading.Lock()


def shared_pool() -> ThreadPoolExecutor:
    global _POOL
    if _POOL is None:
        with _POOL_LOCK:
            if _POOL is None:
                _POOL = ThreadPoolExecutor(
                    max_workers=MAX_WORKERS, thread_name_prefix="upstream"
                )
    assert _POOL is not None
    return _POOL
