"""Static configuration for the terminal backend.

All tunable constants live here so operational behaviour can be reviewed in
one place. Nothing in this module may import other project modules: it is the
bottom of the dependency graph.
"""

import os
from pathlib import Path


def _load_local_env() -> None:
    """Load simple KEY=VALUE settings from the ignored project .env file."""
    try:
        lines = (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if name.strip():
            os.environ.setdefault(name.strip(), value)


_load_local_env()

# --- HTTP server -----------------------------------------------------------
PORT = int(os.environ.get("RIALTO_PORT", "8765"))
BIND_HOST = os.environ.get("RIALTO_BIND_HOST", "127.0.0.1")  # containers set 0.0.0.0

# --- Outbound fetch behaviour ----------------------------------------------
UPSTREAM_TIMEOUT_S = 12
SOFIX_TIMEOUT_S = 15  # the BSE site is slower than the JSON feeds
# Guard against a runaway upstream reply exhausting memory.
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
USER_AGENT = "Mozilla/5.0 (compatible; RialtoTerminal/1.0)"

# --- Cache lifetimes (seconds) ---------------------------------------------
NEWS_TTL_S = 300  # align publisher feed cache with the 5-minute UI poll
MARKET_TTL_S = 300  # per-symbol quotes; limits Yahoo refreshes to one per 5 min
MARKET_STALE_AFTER_S = 86400  # older quotes are retained but explicitly stale
SOFIX_TTL_S = 180  # BSE labels the index widget 3 min delayed

# --- Concurrency ------------------------------------------------------------
# One process-wide pool shared by news and market fan-outs. A single bounded
# pool keeps thread usage predictable even when many requests arrive at once.
MAX_WORKERS = 18

# --- Tracking snapshot window ------------------------------------------------
# Shared Black Sea extent is the default home region for vessel/aircraft
# views; the UI overrides it with the current map viewport as the user pans.
TRACKING_BBOX = {"lamin": 40, "lomin": 25, "lamax": 46, "lomax": 41}
DEFAULT_VESSELS_BBOX = ",".join(
    str(TRACKING_BBOX[key]) for key in ("lamin", "lomin", "lamax", "lomax")
)
# Open Waters caps one AIS snapshot at ~100 square degrees.
VESSELS_MAX_SQ_DEG = 100
VESSELS_TTL_S = 60  # align AIS snapshots with the UI poll; provider allows 120/min

# --- Upstream endpoints -------------------------------------------------------
# Every URL the backend talks to, in one reviewable place. The news feed
# registry (services/news/feeds.py) and the symbol universe
# (services/markets/symbols.py) are domain *data* and live beside their
# domain; these are the fixed single-source endpoints.
YAHOO_CHART_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m"
)
YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search?q={query}&quotesCount=8&newsCount=0"
SEARCH_TTL_S = 3600
QUOTES_MAX_SYMBOLS = 12
BSE_SOFIX_URL = "https://www.bse-sofia.bg/en/indices/sofix"
OPENWATERS_VESSELS_URL = "https://ais.openwaters.io/v1/vessels?bbox={bbox}"
OPENWATERS_TRACK_URL = "https://ais.openwaters.io/v1/vessels/{mmsi}/track"
OPENSKY_TRACKS_URL = "https://opensky-network.org/api/tracks/all"
OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"
OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)


OPENSKY_CREDENTIALS = tuple(dict.fromkeys(
    (client_id.strip(), client_secret.strip())
    for entry in os.environ.get("OPENSKY_CREDENTIALS", "").split(";")
    if ":" in entry
    for client_id, client_secret in (entry.split(":", 1),)
    if client_id.strip() and client_secret.strip()
))
ADSBDB_URL = "https://api.adsbdb.com/v0"
BAZAR_LISTINGS_URL = "https://bazar.bg/obiavi"
GOOGLE_NEWS_SEARCH_URL = "https://news.google.com/rss/search"

# Enrichment cache lifetimes: airframe registry entries are effectively
# static; routes change with schedule seasons.
AIRDB_AIRCRAFT_TTL_S = 86400
AIRDB_ROUTE_TTL_S = 1800
# ADS-B snapshot cache: coalesces identical concurrent viewport requests.
AIR_SNAPSHOT_TTL_S = 900  # align OpenSky snapshots with the 15-minute UI poll
