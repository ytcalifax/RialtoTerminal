/**
 * Application-wide constants — the single place where every knob, list and
 * fixed label lives. If it is a value someone might tweak or break, it
 * belongs here, not beside the logic that consumes it. Feature-specific
 * *data* (the news feed list equivalent: the symbol universe) stays in its
 * domain module only when it is genuinely domain data; UI knobs do not.
 */

// --- Networking -------------------------------------------------------------

/** Client-side abort timeout for API calls (ms). */
const REQUEST_TIMEOUT_MS = 30000;

/** Command-line history length. */
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

// --- Navigation ---------------------------------------------------------------

/** Screen number (1-4) → default page shown when the tab is clicked. */
const SCREEN_BY_PAGE = { '1': 'top', '2': 'news', '3': 'markets', '4': 'ships' };

/** Header session label per page (falls back to the page name upper-cased). */
const SESSION_LABELS = {
  top: 'GLOBAL MARKETS',
  news: 'NEWS & RESEARCH',
  markets: 'MARKET MONITOR',
  ships: 'MARITIME',
  war: 'CONFLICT MONITOR',
  impact: 'EARLY WARNING · BALKAN IMPACT',
};

// --- Command line ---------------------------------------------------------------

/** Command word → page. */
const COMMAND_PAGES = {
  TOP: 'top',
  NEWS: 'news', N: 'news', NI: 'news',
  SHIP: 'ships', VESSEL: 'ships',
  AIR: 'air', FLIGHT: 'air',
  MKT: 'markets', MARKET: 'markets', MON: 'markets',
  MPL: 'marketplace', MARKETPLACE: 'marketplace',
  CON: 'war', CONFLICT: 'war',
  IMP: 'impact', IMPACT: 'impact', EARLY: 'impact',
};

/** Command word → description, used for autocomplete suggestions. */
const COMMAND_NAMES = {
  TOP: 'Top News',
  NEWS: 'News Search', N: 'News Search',
  SHIP: 'Vessel Tracking',
  AIR: 'Aircraft Tracking',
  MKT: 'Market Monitor',
  MPL: 'Marketplace',
  CON: 'Conflict Monitor',
  IMP: 'Early Warning & Impact',
};

/** Function menu entries, in their own display order: [command, description]. */
const MENU_ITEMS = [
  ['TOP', 'Top News'],
  ['NEWS', 'News Search'],
  ['MKT', 'Market Monitor'],
  ['SHIP', 'Vessel Tracking'],
  ['AIR', 'Aircraft Tracking'],
  ['MPL', 'Marketplace'],
  ['CON', 'Conflict Monitor'],
  ['IMP', 'Early Warning & Impact'],
];

/** Help-panel function directory, in its own display order. */
const HELP_ITEMS = [
  ['TOP', 'Top News'],
  ['NEWS', 'News Search'],
  ['SHIP', 'Vessel Tracking'],
  ['AIR', 'Aircraft Tracking'],
  ['MKT', 'Market Monitor'],
  ['MPL', 'Marketplace'],
  ['CON', 'Conflict Monitor'],
  ['IMP', 'Early Warning & Impact'],
];

// --- News --------------------------------------------------------------------------

/** Keyword regexes powering the topic filter chips. */
const TOPIC_TERMS = {
  business: /business|company|market|econom|finance|trade|bank|oil|stock/i,
  politics: /politic|government|minister|election|parliament|president|war|policy/i,
  technology: /technology|tech|ai |artificial intelligence|chip|software|cyber/i,
};

// --- Markets --------------------------------------------------------------------------

/** Dashboard market group tabs, in display order. */
const MARKET_GROUPS = [
  ['INDICES', 'Indices'],
  ['FX', 'FX'],
  ['RATES', 'Rates'],
  ['COMMODITIES', 'Commodities'],
  ['CRYPTO', 'Crypto'],
  ['ETFS', 'ETFs'],
  ['STOCKS', 'Stocks'],
];

/** Symbols shown in the dashboard ticker strip, in order. */
const TICKER_SYMBOLS = ['^GSPC', '^IXIC', '^FTSE', '^SOFIX', 'EURUSD=X', 'GC=F', 'BZ=F', 'BTC-USD', 'ETH-USD', 'SOL-USD'];

/** Coinbase slug lookup for crypto trade links; everything else → Yahoo. */
const COINBASE_SLUGS = { 'BTC-USD': 'bitcoin', 'ETH-USD': 'ethereum', 'SOL-USD': 'solana' };

/** Cookie name and cap for the pinned dashboard symbols. */
const PINNED_COOKIE = 'rialto_pins_v1';
const MAX_PINNED_SYMBOLS = 24;

/** Market-group id of the user's pinned set (tab appears when pins exist). */
const CUSTOM_GROUP = 'CUSTOM';

// --- Maps -------------------------------------------------------------------------------

/** OSM tile URL for one tile at zoom z / column x / row y. */
const osmTileUrl = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/** OpenStreetMap credit anchor shared by every map shell. */
const OSM_CREDIT = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OPENSTREETMAP</a>';

// --- Vessels ------------------------------------------------------------------------------

/** Vessel lookup page: photos, current voyage and operator details. */
const VESSEL_LOOKUP_URL = 'https://www.vesselfinder.com/vessels?name=';

/** AIS ship-type codes → readable labels (standard ITU-R M.1371 ranges). */
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

/** Decode a numeric AIS ship-type code into a label; capitalize text values. */
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
