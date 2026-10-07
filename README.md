# Rialto Terminal

**Rialto** — a real-time terminal for markets, news and tracking. Named for
the Rialto, the Venice market square where merchants read prices, caught up
on news and learned which ships had made port — "what news on the Rialto?"
— the questions this terminal answers on one screen. Vanilla-JS frontend,
Python standard-library backend, public data feeds behind a small JSON API.
No frameworks, no build step.

## Run

```bash
python3 server.py          # or: python3 -m server
```

Then open http://localhost:8765.

> **Deployment note:** the backend uses Python's `http.server`, which the
> standard library documents as *not* production-grade (no TLS, no auth).
> It therefore binds to `127.0.0.1` only. If you ever need to share it over
> a network, put a real WSGI server or reverse proxy in front — do not
> expose this process directly.

Keyboard: `/` focuses the command line · `F2` opens help · `↑/↓` history ·
`ESC` back to the top screen. Commands: `TOP`, `NEWS [terms]`, `MKT`,
`SHIP`, `AIR`, `MPL` (+ aliases).

## Architecture

Dependencies point one way only — nothing lower in this list imports
anything higher:

```
index.html                  entry page (loads the CSS partials + ES modules)

server.py                   thin launcher (keeps `python3 server.py` working)
server/
├── config.py               all tunable constants (ports, timeouts, TTLs)
├── app.py                  server assembly + graceful shutdown
├── core/                   infrastructure, no domain knowledge
│   ├── http_client.py      boundary-safe fetch (scheme guard, size cap, timeouts)
│   ├── cache.py            thread-safe bounded TTL cache
│   ├── pool.py             one shared bounded thread pool
│   ├── text.py             whitespace + timestamp parsing helpers
│   └── parsing/
│       ├── rss.py          RSS/Atom normalisation
│       └── listings.py     Bazar.bg listing extraction
├── services/               domain packages: one folder per multi-file domain
│   ├── news/               feed registry (feeds.py) + aggregator
│   ├── markets/            symbol universe (symbols.py) + quotes (quotes.py)
│   ├── tracking.py         AIS/ADS-B snapshot + track proxies
│   └── marketplace.py      listing search
└── web/                    HTTP boundary
    ├── routes.py           path → handler table (validation lives here)
    └── handler.py          dispatch + JSON encoding + static files

assets/
├── css/
│   ├── base.css            tokens + resets (loaded first)
│   ├── layout.css          terminal frame
│   ├── components.css      shared widgets/rows
│   ├── modules.css         module pages
│   ├── maps.css            map surfaces
│   └── responsive.css      <900px overrides (loaded last)
└── js/
    ├── main.js             composition root: hooks, boot, poll intervals
    ├── core/               dom, state, constants, format, net, status, hooks
    ├── maps/               projection, tiles, view, interaction, shells
    ├── features/           news, markets, tracking, marketplace
    ├── pages/              per-page module shells + dispatcher
    └── ui/                 navigation, command line, chrome (clock/nav)
```

### Design rules

- **Single responsibility** — config, transport, parsing, domain logic and
  HTTP concerns each live in their own layer; each JS module owns one
  surface (a feature, a map concern, one page shell).
- **Open/closed** — adding a backend endpoint means adding one entry to
  `API_ROUTES`; the handler never changes. Adding a news source means one
  entry in `news_feeds.py`.
- **Dependency inversion** — the frontend has no import cycles: features
  never import pages or navigation. Cross-cutting requests go through the
  tiny synchronous hook registry (`core/hooks.js`), wired in `main.js`,
  which is the only place that knows every layer.
- **Defensive programming**
  - Backend: only fixed upstream URLs are fetched (SSRF-safe by
    construction); responses are size-capped; one shared bounded thread
    pool; TTL caches serve last-known-good data when a feed fails;
    per-feed/per-symbol failures degrade independently; the API always
    answers with structured JSON, including a last-ditch 500 guard.
  - Frontend: every upstream value is HTML-escaped (`esc`) before it enters
    markup; superseded async responses are dropped via monotonic request
    ids; polls are re-entrancy guarded; fetches have a client timeout;
    scroll position and keyboard focus survive every repaint.

## Data sources (all public, all indicative)

Yahoo Finance chart endpoint (1-minute bars + live last price) · BSE Sofia
SOFIX widget (3-min delayed) · public RSS feeds (Bloomberg, BBC, Guardian,
CNBC, MarketWatch, Investing.com, Euronews, France 24, Google News index) ·
Bulgarian press (Dnevnik, Capital, Novinite, OffNews, Sofia Globe, Balkan
Insight) · adsb.lol community ADS-B (live) with OpenSky for on-demand track
history · Open Waters AIS · Bazar.bg listings.

Nothing here is investment advice; quotes are delayed/indicative and no
order routing exists. Headlines and listings link to the original
publishers.

## Rollback

`Pre-Refactor.zip` (and the timestamped copy next to it) contains the
original four-file version of the app, byte-identical to the pre-refactor
state.
