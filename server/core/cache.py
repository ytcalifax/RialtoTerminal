"""A minimal thread-safe TTL cache with bounded size.

The terminal polls the same handful of feeds over and over. Keeping the last
good payload per key lets the UI degrade to slightly stale data instead of
showing an error whenever one upstream hiccups.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class Entry[V]:
    """A cached value plus the moment it was stored."""

    value: V
    checked_at: float


class TTLCache[V]:
    """Dictionary-style cache whose entries expire after ``ttl_s`` seconds.

    Bounded by ``max_entries``: when the limit is reached the oldest entry is
    evicted, so a misbehaving caller cannot grow the process without limit.
    All operations are guarded by a lock because services fan out through a
    shared thread pool.
    """

    def __init__(self, ttl_s: float, max_entries: int = 512) -> None:
        self._ttl_s = ttl_s
        self._max_entries = max_entries
        self._lock = threading.Lock()
        self._data: dict[str, Entry[V]] = {}

    def get(self, key: str) -> V | None:
        """Return the value for ``key`` if present *and* fresh, else ``None``."""
        entry = self.get_entry(key)
        if entry is None or time.time() - entry.checked_at >= self._ttl_s:
            return None
        return entry.value

    def get_entry(self, key: str) -> Entry[V] | None:
        """Return the entry for ``key`` regardless of age, else ``None``.

        Used for stale-while-error fallbacks: a caller may prefer the last
        known good value (flagged as stale) over surfacing a hard failure.
        """
        with self._lock:
            entry = self._data.get(key)
        return entry

    def store(self, key: str, value: V) -> None:
        """Insert or replace the entry for ``key``, evicting if over budget."""
        with self._lock:
            self._data[key] = Entry(value=value, checked_at=time.time())
            if len(self._data) > self._max_entries:
                oldest = min(self._data, key=lambda k: self._data[k].checked_at)
                del self._data[oldest]
