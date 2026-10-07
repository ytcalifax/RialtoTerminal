# 🏛️ Rialto Terminal

> **A private dashboard for markets, world news, vessel and aircraft tracking, and conflict reporting.**

Rialto brings public data into one keyboard-driven terminal. Scan market quotes, follow headlines, watch ships and aircraft move across a map, review reported conflict activity and an assessed Ukraine front line, and search public listings—all from a lightweight app that runs on your own machine.

## ✨ Features

- **📈 Market Monitor**: Follow global indices, currencies, rates, commodities, crypto, ETFs, and selected stocks with intraday charts.
- **📰 News Desk**: Browse public news feeds, search headlines, and switch between global and Bulgarian coverage.
- **🚢 Vessel Tracking**: View public AIS positions and recent vessel reports on an interactive map with major shipping chokepoints.
- **✈️ Aircraft Tracking**: Explore OpenSky live state vectors, aircraft details, and available flight tracks.
- **⚠️ Conflict Monitor**: Explore coded event reports, the UN OCHA Ukraine front line, and daily GPS interference cells from GPSJam.
- **⌨️ Keyboard-First Navigation**: Jump between workspaces with `TOP`, `NEWS`, `MKT`, `SHIP`, `AIR`, `WAR`, and `MPL`; press `/` to focus the command line and `F2` for help.
- **🧰 Lightweight by Design**: Vanilla JavaScript frontend, a small Python backend, and no frontend build step.

## 🚀 Quick Start

**Requirements:** Python 3.12 or newer.

Install the runtime dependency, then run from the project directory:

```bash
pip install .
python3 server.py
```

Then open [http://localhost:8765](http://localhost:8765).

To install the optional `rialto` command in the current Python environment:

```bash
pip install -e .
rialto
```

(`rialto` can also be run directly with `python3 -m server`.)

## 🐳 Docker

Build and start the hardened container with Docker Compose:

```bash
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

## 🧭 Workspaces

| Command | Workspace | What you can do |
|---|---|---|
| `TOP` | Home | Scan top stories, market highlights, and recent vessel reports. |
| `NEWS` | News | Search headlines and switch between global and Bulgarian feeds. |
| `MKT` | Markets | Browse market groups, charts, and instrument details. |
| `SHIP` | Vessels | Search vessel reports, explore AIS positions and tracks, and locate major shipping chokepoints. |
| `AIR` | Aircraft | Explore aircraft positions, details, and available tracks. |
| `WAR` | Conflict monitor | Review geolocated reports, the UN OCHA Ukraine front line, and GPSJam interference hexes. |
| `MPL` | Marketplace | Search public Bazar.bg listings. |

Keyboard shortcuts: `/` focuses the command line, `F2` opens help, `↑` and `↓` browse command history, and `Esc` returns to the top screen.

## 🔌 Data Sources

Rialto reads public data from Yahoo Finance, the Bulgarian Stock Exchange, publisher RSS feeds and Google News, OpenSky, Open Waters AIS, ADSBDB aircraft enrichment, Bazar.bg, GDELT, UN OCHA, and GPSJam. Coverage, update timing, and available fields depend on each provider. Market quotes may be delayed or indicative; the app does not place orders.

The SHIP map includes reference markers for major global maritime chokepoints. The WAR workspace combines GDELT’s 15-minute coded event export, the UN OCHA Ukraine front-line layer, and GPSJam’s latest daily H3 hex data. GPSJam aggregates aircraft-reported navigation accuracy over 24 hours; the hexes indicate possible interference, not verified jammer locations. GDELT event locations and actor names are derived from reporting, not verified live positions for units or equipment. Front-line recency follows OCHA’s published date.

## 🛡️ Local-Only by Default

The native server binds to `127.0.0.1`. Inside Docker it binds to the container
interface so port forwarding works; the sample Compose file still publishes it
only on host loopback. Rialto uses Python's built-in HTTP server, which does
not provide TLS or authentication. Keep it behind a secured reverse proxy for
remote access; do not expose the app directly to an untrusted network.

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
