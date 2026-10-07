# 🏛️ Rialto Terminal

> **A private, real-time dashboard for markets, world news, vessels, and aircraft.**

Rialto brings live public data into one keyboard-driven terminal. Scan market quotes, follow headlines, watch ships and aircraft move across a map, and search public listings—all from a lightweight app that runs on your own machine.

## ✨ Features

- **📈 Market Monitor**: Follow global indices, currencies, rates, commodities, crypto, ETFs, and selected stocks with intraday charts.
- **📰 News Desk**: Browse public news feeds, search headlines, and switch between global and Bulgarian coverage.
- **🚢 Vessel Tracking**: View public AIS positions and recent vessel reports on an interactive map.
- **✈️ Aircraft Tracking**: Explore OpenSky live state vectors, aircraft details, and available flight tracks.
- **⌨️ Keyboard-First Navigation**: Jump between workspaces with `TOP`, `NEWS`, `MKT`, `SHIP`, `AIR`, and `MPL`; press `/` to focus the command line and `F2` for help.
- **🧰 Lightweight by Design**: Vanilla JavaScript frontend, Python standard-library backend, and no frontend build step or runtime dependencies.

## 🚀 Quick Start

**Requirements:** Python 3.12 or newer.

Run directly from the project directory:

```bash
python3 server.py
```

Then open [http://localhost:8765](http://localhost:8765).

To install the optional `rialto` command in the current Python environment:

```bash
pip install -e .
rialto
```

(`rialto` can also be run directly with `python3 -m server`.)

## 🧭 Workspaces

| Command | Workspace | What you can do |
|---|---|---|
| `TOP` | Home | Scan top stories, market highlights, and recent vessel reports. |
| `NEWS` | News | Search headlines and switch between global and Bulgarian feeds. |
| `MKT` | Markets | Browse market groups, charts, and instrument details. |
| `SHIP` | Vessels | Search vessel reports and explore AIS positions and tracks. |
| `AIR` | Aircraft | Explore aircraft positions, details, and available tracks. |
| `MPL` | Marketplace | Search public Bazar.bg listings. |

Keyboard shortcuts: `/` focuses the command line, `F2` opens help, `↑` and `↓` browse command history, and `Esc` returns to the top screen.

## 🔌 Data Sources

Rialto reads public data from Yahoo Finance, the Bulgarian Stock Exchange, public publisher RSS feeds and Google News, OpenSky, Open Waters AIS, ADSBDB aircraft enrichment, and Bazar.bg. Coverage, update timing, and available fields depend on each provider. Market quotes may be delayed or indicative; the app does not place orders.

## 🛡️ Local-Only by Default

The server binds to `127.0.0.1` and is intended for local use. It uses Python's built-in HTTP server, which is not a production web server and does not provide TLS or authentication. Do not expose it directly to a network; use an appropriately secured reverse proxy or production server if you intentionally deploy it elsewhere.

## 🧱 Built With

- Python **3.12+**; runtime dependencies: **none**
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
