from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import closing, contextmanager
from pathlib import Path

_LOCK = threading.Lock()
_LIMIT = 500


def _database_path() -> Path:
    root = Path(os.environ.get("RIALTO_DATA_DIR", Path.home() / ".local" / "share" / "rialto"))
    root.mkdir(parents=True, exist_ok=True)
    return root / "alert_activity.sqlite3"


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_database_path(), timeout=5)
    connection.execute("CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)")
    return connection


@contextmanager
def _session():
    with closing(_connect()) as connection:
        with connection:
            yield connection


def list_activity() -> dict:
    with _LOCK, _session() as connection:
        rows = connection.execute("SELECT payload FROM activity ORDER BY at DESC, rowid DESC LIMIT ?", (_LIMIT,)).fetchall()
    return {"items": [json.loads(row[0]) for row in rows], "limit": _LIMIT, "persistence": "server-local SQLite"}


def save_activity(item: object) -> tuple[int, dict]:
    if not isinstance(item, dict):
        return 400, {"error": "Activity must be a JSON object."}
    identity = str(item.get("id") or "")[:100]
    title = str(item.get("title") or "")[:500]
    detail = str(item.get("detail") or "")[:5000]
    try:
        at = int(item.get("at"))
    except (TypeError, ValueError, OverflowError):
        return 400, {"error": "Activity timestamp must be an integer Unix timestamp in milliseconds."}
    if not identity or not title or at <= 0:
        return 400, {"error": "Activity requires id, title, detail, and a positive timestamp."}
    normalized = {"id": identity, "at": at, "title": title, "detail": detail,
                  "link": str(item.get("link") or "")[:2000]}
    with _LOCK, _session() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO activity(id, at, payload) VALUES (?, ?, ?)",
            (identity, at, json.dumps(normalized, ensure_ascii=False)),
        )
        connection.execute(
            "DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ?)",
            (_LIMIT,),
        )
    return 200, {"saved": True, "id": identity}


def delete_activity(action: object) -> tuple[int, dict]:
    if not isinstance(action, dict):
        return 400, {"error": "Activity action must be a JSON object."}
    with _LOCK, _session() as connection:
        if action.get("action") == "clear":
            connection.execute("DELETE FROM activity")
            return 200, {"cleared": True}
        if action.get("action") == "delete" and action.get("id"):
            cursor = connection.execute("DELETE FROM activity WHERE id = ?", (str(action["id"])[:100],))
            return 200, {"deleted": bool(cursor.rowcount)}
    return 400, {"error": "Unknown activity action."}
