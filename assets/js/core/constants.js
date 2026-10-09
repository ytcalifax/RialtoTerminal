const REQUEST_TIMEOUT_MS = 30000;
const HISTORY_LIMIT = 30;

/**
 * Minimum time (ms) the header pulse stays in its "UPDATING" state after a
 * poll starts. Fast polls would otherwise finish inside the pulse animation
 * cycle and the updating signal becomes invisible.
 */
const MIN_UPDATE_PULSE_MS = 900;

/**
 * Wait after a map pan/zoom stops before refetching that region's traffic
 * (debounces a drag across many pointer events into one fetch).
 */
const TRACK_REFETCH_DEBOUNCE_MS = 600;

/**
 * Max coverage cells fetched per tracking refresh. At low zoom the cells are
 * sampled clusters spread across the view; zooming in shrinks the view until
 * one cell covers it fully. Each cell is one upstream request — keep the
 * budget small enough for the sources' ~1 request/second courtesy limits.
 */
const MAX_COVERAGE_CELLS = 4;
const SCREEN_BY_PAGE = { '1': 'top', '2': 'news', '3': 'markets', '4': 'ships' };
const SESSION_LABELS = {
  top: 'TOP NEWS',
  news: 'NEWS & RESEARCH',
  markets: 'MARKET MONITOR',
  ships: 'MARITIME',
  air: 'AIRCRAFT',
  war: 'CONFLICT MONITOR',
  alerts: 'ALERTS & TRENDS',
  marketplace: 'MARKETPLACE',
};
const COMMAND_PAGES = {
  TOP: 'top',
  NEWS: 'news', N: 'news', NI: 'news',
  SHIP: 'ships', VESSEL: 'ships',
  AIR: 'air', FLIGHT: 'air',
  MKT: 'markets', MARKET: 'markets', MON: 'markets',
  ALT: 'alerts', ALERTS: 'alerts',
  MPL: 'marketplace', MARKETPLACE: 'marketplace',
  CON: 'war', CONFLICT: 'war',
};
const COMMAND_NAMES = {
  TOP: 'Top News',
  NEWS: 'News Search', N: 'News Search',
  MKT: 'Market Monitor',
  CON: 'Conflict Monitor',
  SHIP: 'Vessel Tracking',
  AIR: 'Aircraft Tracking',
  ALT: 'Alert Settings',
  MPL: 'Marketplace',
};
const MENU_ITEMS = [
  ['TOP', 'Top News'],
  ['NEWS', 'News Search'],
  ['MKT', 'Market Monitor'],
  ['CON', 'Conflict Monitor'],
  ['SHIP', 'Vessel Tracking'],
  ['AIR', 'Aircraft Tracking'],
  ['ALT', 'Alert Settings'],
  ['MPL', 'Marketplace'],
];
const HELP_ITEMS = [
  ['TOP', 'Top News'],
  ['NEWS', 'News Search'],
  ['MKT', 'Market Monitor'],
  ['CON', 'Conflict Monitor'],
  ['SHIP', 'Vessel Tracking'],
  ['AIR', 'Aircraft Tracking'],
  ['ALT', 'Alert Settings'],
  ['MPL', 'Marketplace'],
];
const TOPIC_TERMS = {
  business: /business|company|market|econom|finance|trade|bank|oil|stock/i,
  politics: /politic|government|minister|election|parliament|president|war|policy/i,
  technology: /technology|tech|ai |artificial intelligence|chip|software|cyber/i,
};
const MARKET_GROUPS = [
  ['INDICES', 'Indices'],
  ['FX', 'FX'],
  ['RATES', 'Rates'],
  ['COMMODITIES', 'Commodities'],
  ['CRYPTO', 'Crypto'],
  ['ETFS', 'ETFs'],
  ['STOCKS', 'Stocks'],
];
const TICKER_SYMBOLS = ['^GSPC', '^IXIC', '^FTSE', '^SOFIX', 'EURUSD=X', 'GC=F', 'BZ=F', 'BTC-USD', 'ETH-USD', 'SOL-USD'];
const COINBASE_SLUGS = { 'BTC-USD': 'bitcoin', 'ETH-USD': 'ethereum', 'SOL-USD': 'solana' };
const PINNED_COOKIE = 'rialto_pins_v1';
const MAX_PINNED_SYMBOLS = 24;
const CUSTOM_GROUP = 'CUSTOM';
const osmTileUrl = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const OSM_CREDIT = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OPENSTREETMAP</a>';
const VESSEL_LOOKUP_URL = 'https://www.vesselfinder.com/vessels?name=';
const VESSEL_TYPE_BANDS = [
  [20, 29, 'Wing in ground'],
  [30, 30, 'Fishing'],
  [31, 32, 'Towing'],
  [33, 33, 'Dredging'],
  [34, 34, 'Diving'],
  [35, 35, 'Military'],
  [36, 36, 'Sailing'],
  [37, 37, 'Pleasure craft'],
  [40, 49, 'High-speed craft'],
  [50, 50, 'Pilot'],
  [51, 51, 'Search & rescue'],
  [52, 52, 'Tug'],
  [53, 53, 'Port tender'],
  [54, 54, 'Anti-pollution'],
  [55, 55, 'Law enforcement'],
  [58, 58, 'Medical transport'],
  [60, 69, 'Passenger'],
  [70, 79, 'Cargo'],
  [80, 89, 'Tanker'],
  [90, 99, 'Other'],
];
const vesselTypeLabel = (code) => {
  const n = Number(code);
  if (!Number.isFinite(n)) {
    if (!code) return 'AIS';
    const text = String(code);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const band = VESSEL_TYPE_BANDS.find(([lo, hi]) => n >= lo && n <= hi);
  return band ? band[2] : `Type ${n}`;
};

export {
  REQUEST_TIMEOUT_MS, HISTORY_LIMIT, MIN_UPDATE_PULSE_MS, TRACK_REFETCH_DEBOUNCE_MS, MAX_COVERAGE_CELLS,
  SCREEN_BY_PAGE, SESSION_LABELS,
  COMMAND_PAGES, COMMAND_NAMES, MENU_ITEMS, HELP_ITEMS,
  TOPIC_TERMS,
  MARKET_GROUPS, TICKER_SYMBOLS, COINBASE_SLUGS,
  PINNED_COOKIE, MAX_PINNED_SYMBOLS, CUSTOM_GROUP,
  osmTileUrl, OSM_CREDIT,
  VESSEL_LOOKUP_URL, vesselTypeLabel,
};
