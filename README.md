# 🏛️ Rialto Terminal

> **A private dashboard for markets, world news, vessel and aircraft tracking, and conflict reporting.**

Rialto brings public data into one keyboard-driven terminal. Scan market quotes, follow headlines, watch ships and aircraft move across a map, review reported conflict activity and an assessed Ukraine front line, and search public listings—all from a lightweight app that runs on your own machine.

## ✨ Features

- **📈 Market Monitor**: Follow global indices, currencies, rates, commodities, crypto, ETFs, and selected stocks with intraday charts.
- **📰 News Desk**: Browse public news feeds, search headlines, and switch between global and English-language Bulgarian coverage.
- **🚢 Vessel Tracking**: View public AIS positions and current vessel counts around major maritime chokepoints.
- **✈️ Aircraft Tracking**: Explore OpenSky live state vectors, aircraft details, and available flight tracks.
- **⚠️ Conflict Monitor**: Filter news reports, UCDP/ACLED armed-conflict events, and internet outages alongside the weekly UN OCHA / ISW & CTP Ukraine front line and daily GPSJam cells.
- **⌨️ Keyboard-First Navigation**: Jump between workspaces with `TOP`, `NEWS`, `MKT`, `SHIP`, `AIR`, `CON`, and `MPL`; press `/` to focus the command line and `F2` for help.
- **🧰 Lightweight by Design**: Vanilla JavaScript frontend, a small Python backend, and no frontend build step.

## 🚀 Quick Start

**Requirements:** Python 3.12 or newer.

Install the runtime dependency, then run from the project directory:

```bash
pip install .
cp .env.example .env
# Edit .env with provider credentials you want enabled.
python3 run.py
```

Then open [http://localhost:8765](http://localhost:8765).

When a Python debugger is attached, Rialto logs outbound API calls and shows a
live **DEBUG** panel in the header. It reports request counts, failures, elapsed
time, and uploaded/downloaded bytes by service and request target, plus the most
recent calls. Query parameters are visible for request-level diagnosis, while
credential values are redacted; headers and request bodies are omitted. Metrics
stay in memory for the current server process and reset when the debugger
attaches or disconnects.

The World Monitor layers use a short-lived anonymous session minted by the API
and refreshed by the local Python server. No World Monitor API key is required
in `.env`; endpoints with subscription-only access may still return no data.

To install the optional `rialto` command in the current Python environment:

```bash
pip install -e .
rialto
```

(`rialto` can also be run directly with `python3 -m server`.)

## 🐳 Docker

Build and start the hardened container with Docker Compose:

```bash
cp .env.example .env
# Edit .env with provider credentials you want enabled.
docker compose up --build -d
```

Sample `compose.yaml`:

```yaml
services:
  rialto:
    build: .
    restart: unless-stopped
    init: true
    ports:
      - "127.0.0.1:8765:8765"
    env_file:
      - .env
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

Open [http://localhost:8765](http://localhost:8765). The image runs as a
non-root user and includes a health check.
The sample publishes only on the host loopback interface; put a secured
reverse proxy in front if you need access from other devices.
Compose reads credentials from the ignored `.env` file and passes them only to
the container process. For direct `docker run`, pass the file with
`--env-file .env`. Diagnostics appear automatically when a Python debugger is
attached to the server process.

## 🧭 Workspaces

| Command | Workspace | What you can do |
|---|---|---|
| `TOP` | Home | Scan top stories, market highlights, and recent vessel reports. |
| `NEWS` | News | Search headlines and switch between global and English-language Bulgarian feeds. |
| `MKT` | Markets | Browse market groups, charts, and instrument details. |
| `CON` | Conflict monitor | Review geolocated reports, the weekly UN OCHA / ISW & CTP Ukraine front line, and GPSJam interference hexes. |
| `SHIP` | Vessels | Search vessel reports, explore AIS positions and tracks, and see nearby vessel counts at major maritime chokepoints. |
| `AIR` | Aircraft | Explore aircraft positions, details, and available tracks. |
| `ALT` | Alerts | Set alerts for headlines, conflict, outbreaks, market moves, vessels, and aircraft. |
| `MPL` | Marketplace | Search public Bazar.bg listings. |
| `CHAT` | Chat | Chat with an LLM endpoint and fetch terminal data via function calls. |

Keyboard shortcuts: `/` focuses the command line, `F2` opens help, `↑` and `↓` browse command history, and `Esc` returns to the top screen.

## 💬 Chat Setup

The `CHAT` workspace talks to any OpenAI-compatible endpoint. There is nothing
to configure on the server: open ⚙ CHAT and set the endpoint, your API key,
and the model. Settings are stored per browser in a cookie, so each person
using the terminal brings their own key and can target whichever provider they
hold an account with. The Python backend holds no LLM credential and makes no
LLM requests.

Groq free keys are available at
[console.groq.com/keys](https://console.groq.com/keys) and work with the
defaults below. Note that the key is kept in a browser cookie, which is
readable by any script running on this origin; use a key you are comfortable
storing that way.

### Staying inside the free-plan rate limit

Groq's free plan meters input and output against a single **8,000
token/minute** window. Two things make a function-calling session expensive:
every tool round re-sends the whole conversation plus the tool schemas, and
each tool result carries live JSON. Measured on a four-round session, the
untrimmed replayed history reached roughly 9,200 input tokens — over the whole
window before any output was generated.

Rialto therefore trims three things before each request:

- **Input budget** (default 3500) — `pruneConversation` drops the oldest whole
  tool rounds until the replayed history fits. Whole rounds are dropped
  together so a `tool` result is never orphaned from its call, and the system
  prompt is always kept.
- **Tool result size** (default 2500 chars) — applied by removing trailing
  records from the result's lists, so the payload stays valid JSON instead of
  being sliced mid-string.
- **Rounds** (default 4) — with the two caps above, a full session lands near
  4,000 of the 8,000 available.

Endpoint, key, model, temperature, completion cap, round cap, tool-result cap,
and input budget are all editable from the ⚙ menu on the `CHAT` screen. That
panel also shows the provider's remaining per-minute and per-day budget after
each turn when the endpoint exposes those headers. These defaults assume the
8,000 token/minute free plan; raise the input budget and completion cap if you
move to a plan with a larger window.

## 🔌 Data Sources

Rialto reads public data from Yahoo Finance, the Bulgarian Stock Exchange, publisher RSS feeds and Google News, OpenSky, Open Waters AIS, ADSBDB aircraft enrichment, Bazar.bg, GDELT, UN OCHA, and GPSJam. It also reads World Monitor's fear/greed index, UCDP/ACLED and internet outage feeds using a periodically refreshed anonymous API session. Coverage, update timing, access tier, and available fields depend on each provider. The app does not place orders.

Publisher news feeds and Google News searches refresh every five minutes. Other
sources use their own polling and cache intervals to match provider update rates
and request limits.

The SHIP map marks major maritime chokepoints and counts loaded AIS positions within 25 nautical miles of each marker. Counts depend on receiver coverage and the currently loaded map area; they are not a global traffic census. The CON workspace combines GDELT’s 15-minute coded event export, the UN OCHA Ukraine front-line layer, and GPSJam’s latest daily H3 hex data. GPSJam aggregates aircraft-reported navigation accuracy over 24 hours; the hexes indicate possible interference, not verified jammer locations. GDELT event locations and actor names are derived from reporting, not verified live positions for units or equipment. Front-line recency follows OCHA’s published date.

## 🛡️ Local-Only by Default

The native server binds to `127.0.0.1`. Inside Docker it binds to the container
interface so port forwarding works; the sample Compose file still publishes it
only on host loopback. Static serving is limited to the frontend entry point and
`assets/`; project configuration and source files are not served. Rialto uses
Python's built-in HTTP server, which does not provide TLS or authentication.
Keep it behind a secured reverse proxy for remote access; do not expose the app
directly to an untrusted network.

## 🧱 Built With

- Python **3.12+**; runtime dependency: [`h3`](https://pypi.org/project/h3/)
- Browser-native HTML, CSS, and JavaScript modules
- Public data feeds and APIs

## 🧹 Development

Install the optional Ruff linter and import sorter, then run it with:

```bash
pip install -e ".[dev]"
ruff check .
```

## 🤝 Contributing

Issues and pull requests are welcome. Include the workspace, steps to reproduce, and relevant feed or browser-console errors when reporting a problem.

---

*Built for curious people who like their news, markets, and moving objects in one place.*
