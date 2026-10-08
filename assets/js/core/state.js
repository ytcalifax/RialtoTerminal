/**
 * Application state.
 *
 * One plain, serialisable store shared by all feature modules. Every key is
 * declared up front — no ad-hoc property creation at runtime — so the shape
 * of the state is auditable in a single place. Features read and mutate
 * their own slices; no module reassigns the object itself.
 */

import { loadPins } from './pins.js';

const state = {
  // Navigation
  page: 'top',            // current page: top|news|markets|ships|air|marketplace
  screen: '1',            // visible screen tab (1-4)
  history: [],            // command-line history (newest first)
  historyIndex: -1,       // position while browsing history
  activeSuggestion: -1,   // highlighted command suggestion

  // News
  feed: 'global',         // current feed: global|bulgaria|balkans
  newsCountry: '',        // active Balkan country code or empty for all
  filter: 'all',          // topic filter chip
  news: [],               // merged headline rows
  newsSources: [],        // per-feed health statuses from the last fetch
  newsQuery: '',          // current headline search term
  selectedNews: '',       // URL of the highlighted headline
  notifications: [],
  alertSettings: {
    news: true,
    conflict: true,
    markets: true,
    keywords: 'Bulgaria, Balkans, Black Sea, Ukraine, Russia, NATO, EU, energy, gas, oil, Sofia',
    marketMovePct: 2,
  },
  alertBaselines: { news: null, conflict: null, markets: null },
  marketplace: [],        // latest marketplace listings
  marketplaceQuery: '',   // latest marketplace search

  // Markets
  market: [],             // quote rows (stale rows are carried forward)
  marketGroup: 'INDICES', // active market group tab
  marketQuery: '',        // instrument filter text
  marketGroupExpected: {},// expected symbol count per group (gap detection)
  marketHistory: {},      // per-symbol quote snapshots for trend analysis
  pins: loadPins(),       // cookie-backed pinned dashboard symbols

  // Selected instrument/track
  selectedInstrument: null,
  selectedTrack: null,    // last selected vessel/aircraft row
  airInfo: null,          // { id, info } — enrichment for the selected aircraft

  // Tracking
  ships: [],              // normalised AIS positions (current region)
  aircraft: [],           // normalised ADS-B positions (current region)
  warReports: [],
  warFrontline: [],
  warGpsJam: { date: '', features: [] },
  warSelectedId: null,
  conflictQuery: '',
  conflictType: 'ALL',
  shipsRegion: null,      // last fetched vessel region: 'minLat,minLon,maxLat,maxLon'
  airRegion: null,        // last fetched aircraft region: 'minLat,minLon,maxLat,maxLon'
  vesselAttribution: {},  // AIS source credits from the snapshot payload
  trackQuery: '',         // active tracking search text
  trackQueries: { ships: '', air: '' }, // remembered search text per page
  trackMoving: false,     // "moving only" filter
  refreshingShips: false, // re-entrancy guards so intervals cannot stack
  refreshingAir: false,

  // Feed health, shown in the header indicator
  health: { news: 'idle', market: 'idle', vessels: 'idle', air: 'idle' },
  errors: {},
  timestamps: {},         // last data timestamp per feed (ms)

  // Monotonic request ids per feed: responses from superseded requests
  // are discarded instead of being rendered. Market is per group because
  // the dashboard polls CORE and the pinned CUSTOM set in parallel.
  request: { news: 0, market: {}, marketplace: 0, track: 0, airInfo: 0 },

  // Map viewports per surface; userMoved suspends auto-centering.
  mapViews: {
    home:      { lat: 43, lon: 33, zoom: 6 },
    homeReset: { lat: 43, lon: 33, zoom: 6 },
    ship:      { lat: 43, lon: 33, zoom: 6 },
    air:       { lat: 43, lon: 33, zoom: 6 },
    war:       { lat: 48, lon: 32, zoom: 5 },
  },
};

export { state };
