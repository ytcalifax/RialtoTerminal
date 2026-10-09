/**
 * Cross-feed deduction engine (ALERTS & TRENDS → CAUSE & EFFECT).
 *
 * Correlates every public feed the terminal already carries — conflict
 * reports (GDELT), World Monitor armed events / internet outages / disease
 * outbreaks, news headlines, AIS tanker positions, GPS-jam coverage and
 * live quotes — into named cause→effect deductions, e.g. "Middle East
 * conflict escalating + Strait of Hormuz disruption → crude, gasoline and
 * heating-oil prices under upward pressure".
 *
 * The engine never polls on its own: it is re-evaluated whenever any feed
 * refreshes (via observeDerivedSignals) and whenever its quote watchlist
 * ticks (5 min). Quotes for effect instruments are fetched directly so the
 * engine sees energy/risk instruments even when the user is browsing another
 * market group. Rules are declarative; each rule names the signals it
 * corroborates, and a fired deduction lands in ACTIVITY as a core alert
 * with its cause→effect chain spelled out.
 */

import { req } from './net.js';
import { state } from './state.js';

/** How long a fired deduction stays quiet before it may alert again (6h). */
const DEDUCTION_COOLDOWN_MS = 6 * 3600000;

/** Ring-buffer sizes for stored deductions and notification fingerprints. */
const DEDUCTION_LIMIT = 30;

/** Quotes the engine tracks for effect verification, regardless of view. */
const DEDUCTION_WATCHLIST = [
  'BZ=F', 'CL=F', 'RB=F', 'HO=F', 'NG=F', 'GC=F', 'ZW=F',
  '^VIX', '^GSPC', 'XLE', 'USO', 'UNG', 'XOM', 'SHEL', 'TTE',
  'RTX', 'LMT', 'DAL', 'TSM', 'SMH',
];

/** Short display names for alert copy (Yahoo names truncate at 24 chars). */
const EFFECT_NAMES = {
  'BZ=F': 'Brent', 'CL=F': 'WTI Crude', 'RB=F': 'RBOB Gasoline', 'HO=F': 'Heating Oil',
  'NG=F': 'Natural Gas', 'GC=F': 'Gold', 'SI=F': 'Silver', 'ZW=F': 'Wheat',
  '^VIX': 'VIX', '^GSPC': 'S&P 500', 'XLE': 'Energy ETF', 'USO': 'Oil Fund',
  'UNG': 'NatGas Fund', 'XOM': 'Exxon', 'SHEL': 'Shell', 'TTE': 'TotalEnergies',
  'RTX': 'RTX', 'LMT': 'Lockheed', 'DAL': 'Delta', 'TSM': 'TSMC', 'SMH': 'Semis ETF',
};

/** Session move below this is treated as flat (no effect signal). */
const MOVE_FLOOR_PCT = 1;

/** Maritime chokepoints with coarse bounding boxes for GPS-jam/tanker checks. */
const CHOKEPOINTS = [
  { id: 'hormuz', name: 'Strait of Hormuz', keywords: ['hormuz'], minLat: 25.5, maxLat: 27.5, minLon: 55, maxLon: 58 },
  { id: 'redsea', name: 'Red Sea / Bab el-Mandeb', keywords: ['red sea', 'bab el-mandeb', 'bab al-mandeb', 'mandeb'], minLat: 11, maxLat: 21, minLon: 32, maxLon: 44 },
  { id: 'suez', name: 'Suez Canal', keywords: ['suez'], minLat: 29.5, maxLat: 31.5, minLon: 32, maxLon: 33 },
  { id: 'bosphorus', name: 'Bosphorus / Black Sea', keywords: ['bosphorus', 'bosporus'], minLat: 40.8, maxLat: 41.5, minLon: 28.5, maxLon: 30 },
  { id: 'blacksea', name: 'Black Sea grain corridor', keywords: ['black sea'], minLat: 41, maxLat: 47, minLon: 28, maxLon: 41 },
  { id: 'taiwan', name: 'Taiwan Strait', keywords: ['taiwan strait'], minLat: 22.5, maxLat: 26.5, minLon: 118, maxLon: 122 },
  { id: 'malacca', name: 'Strait of Malacca', keywords: ['malacca'], minLat: 1, maxLat: 7, minLon: 97, maxLon: 105 },
];

/**
 * Conflict theaters. Each ties a keyword lexicon (matched against conflict
 * reports, World Monitor armed events and headlines) to its relevant
 * chokepoint, producer outage countries and the effect rule to fire.
 */
const THEATERS = {
  gulf: {
    label: 'Middle East',
    keywords: /\b(iran|iranian|tehran|israel|hormuz|persian gulf|gulf of oman|gulf states|saudi|iraq|kuwait|qatar|bahrain|uae|emirates)\b/i,
    choke: 'hormuz',
    producers: ['iran', 'iraq', 'saudi', 'kuwait', 'qatar', 'uae', 'united arab emirates', 'bahrain', 'oman'],
    rule: {
      title: 'FUEL PRICE PRESSURE',
      summary: 'Conflict escalation plus supply-route disruption in the Gulf lifts crude and refined-product prices.',
      minScore: 5,
      effects: [
        { symbol: 'BZ=F', dir: 'up' }, { symbol: 'CL=F', dir: 'up' }, { symbol: 'RB=F', dir: 'up' },
        { symbol: 'HO=F', dir: 'up' }, { symbol: 'NG=F', dir: 'up' }, { symbol: 'XLE', dir: 'up' },
        { symbol: 'USO', dir: 'up' }, { symbol: 'GC=F', dir: 'up' }, { symbol: 'DAL', dir: 'down' },
      ],
    },
  },
  redsea: {
    label: 'Red Sea / Yemen',
    keywords: /\b(yemen|houthi|houthis|red sea|bab el-mandeb|bab al-mandeb|aden|sanaa)\b/i,
    choke: 'redsea',
    producers: ['yemen', 'saudi', 'egypt', 'sudan', 'eritrea', 'djibouti'],
    rule: {
      title: 'SHIPPING & FUEL PRESSURE',
      summary: 'Attacks or closures on the Red Sea corridor reroute tankers and lift voyage costs and fuel prices.',
      minScore: 4,
      effects: [
        { symbol: 'BZ=F', dir: 'up' }, { symbol: 'CL=F', dir: 'up' }, { symbol: 'RB=F', dir: 'up' },
        { symbol: 'HO=F', dir: 'up' }, { symbol: 'XLE', dir: 'up' }, { symbol: 'USO', dir: 'up' },
        { symbol: 'GC=F', dir: 'up' },
      ],
    },
  },
  ukraine: {
    label: 'Russia / Ukraine',
    keywords: /\b(ukraine|ukrainian|russia|russian|kyiv|kiev|moscow|crimea|donetsk|luhansk|zaporizhzhia|kharkiv)\b/i,
    choke: 'blacksea',
    producers: ['russia', 'ukraine', 'kazakhstan'],
    rule: {
      title: 'EUROPEAN GAS & GRAIN PRESSURE',
      summary: 'Escalation around Europe’s largest gas and grain exporters lifts gas, wheat and safe-haven demand.',
      minScore: 4,
      effects: [
        { symbol: 'NG=F', dir: 'up' }, { symbol: 'ZW=F', dir: 'up' }, { symbol: 'BZ=F', dir: 'up' },
        { symbol: 'GC=F', dir: 'up' }, { symbol: 'UNG', dir: 'up' },
      ],
    },
  },
  taiwan: {
    label: 'Taiwan / China',
    keywords: /\b(taiwan|taiwanese|beijing|pla |people.s liberation|south china sea|strait of taiwan)\b/i,
    choke: 'taiwan',
    producers: ['taiwan', 'china'],
    rule: {
      title: 'TECH SUPPLY-CHAIN RISK',
      summary: 'Escalation near the Taiwan Strait pressures semiconductor supply and lifts risk-off demand.',
      minScore: 4,
      effects: [
        { symbol: 'TSM', dir: 'down' }, { symbol: 'SMH', dir: 'down' }, { symbol: '^GSPC', dir: 'down' },
        { symbol: '^VIX', dir: 'up' }, { symbol: 'GC=F', dir: 'up' },
      ],
    },
  },
};

/** Disease terms for the travel-risk theater (matched in outbreak + news text). */
const DISEASE_TERMS = /\b(outbreak|epidemic|pandemic|virus|influenza|cholera|ebola|marburg|mpox|monkeypox|dengue|plague)\b/i;

/** Producer-country keywords for outage corroboration. */
const OUTAGE_COUNTRY_TERMS = /\b(iran|iraq|saudi|russia|ukraine|venezuela|libya|nigeria|kuwait|qatar|uae|yemen|egypt|taiwan|china|kazakhstan)\b/i;

let quoteTimer = null;

// --- small helpers -----------------------------------------------------------

function ageMs(item) {
  const properties = item?.properties || {};
  const raw = item?.published || item?.occurredAt || item?.dateStart || item?.detectedAt
    || item?.publishedAt || item?.date || properties.event_date || '';
  const timestamp = Date.parse(String(raw));
  return Number.isNaN(timestamp) ? Infinity : Date.now() - timestamp;
}

/** Text of a feed row: every string value, lower-cased once. */
function rowText(item) {
  const values = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    else if (typeof value === 'string') values.push(value);
  };
  walk(item);
  return values.join(' ').toLowerCase();
}

function pointIn(box, lat, lon) {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

function fmtPct(value) {
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

function quoteRow(symbol) {
  return state.deductionQuotes.find((x) => x.symbol === symbol) || null;
}

/** Absolute move for a symbol: day change or session move since first tick. */
function moveOf(symbol) {
  const row = quoteRow(symbol);
  if (!row) return null;
  const dayPct = Number(row.pct);
  const baseline = state.deductionBaseline.quotes[symbol];
  let sessionPct = null;
  if (baseline?.last && Number.isFinite(Number(row.last)) && Number(row.last) > 0) {
    sessionPct = (Number(row.last) - baseline.last) / baseline.last * 100;
  }
  const candidates = [dayPct, sessionPct].filter((x) => Number.isFinite(x));
  if (!candidates.length) return null;
  return Math.max(...candidates.map(Math.abs)) * Math.sign(candidates.find((x) => Math.abs(x) >= MOVE_FLOOR_PCT) ?? 0);
}

/** Short label for an effect instrument ('Brent', 'S&P 500', …). */
function effectName(symbol) {
  return EFFECT_NAMES[symbol] || quoteRow(symbol)?.name || symbol;
}

/** 'Brent +2.4%' style label for an effect instrument, when it is moving. */
function moveLabel(symbol) {
  const row = quoteRow(symbol);
  const move = moveOf(symbol);
  if (!row || move == null || Math.abs(move) < MOVE_FLOOR_PCT) return null;
  return `${effectName(symbol)} ${fmtPct(move)}`;
}

// --- signal collectors ---------------------------------------------------------

function conflictSignals(texts, theater) {
  const count = texts.filter((text) => theater.keywords.test(text)).length;
  const previous = state.deductionBaseline.conflict[theater.label] ?? count;
  state.deductionBaseline.conflict[theater.label] = count;
  return {
    count,
    rising: count > previous && previous >= 0,
    detail: count ? `${count} reported ${theater.label} events in the recent window${count > previous ? ' · activity rising' : ''}` : '',
  };
}

function newsSignals(rows, theater) {
  const hits = rows.filter((x) => theater.keywords.test(x.title || '')).length;
  const previous = state.deductionBaseline.news[theater.label] ?? hits;
  state.deductionBaseline.news[theater.label] = hits;
  return {
    hits,
    rising: hits - previous >= 3,
    detail: hits ? `${hits} headlines reference ${theater.label}${hits > previous ? ' · coverage accelerating' : ''}` : '',
  };
}

/** Chokepoint stress: keyword hits + GPS-jam coverage + tankers holding station. */
function chokepointSignals(rows) {
  const newsTexts = rows.map((x) => rowText(x));
  const reportTexts = [...state.warReports, ...(state.warWorldMonitor?.armed || [])].map(rowText);
  const threatVerbs = /closed|closure|blocked|attack|attacked|struck|mined|seized|disrupt|halted|suspended|tanker/i;
  return CHOKEPOINTS.map((choke) => {
    const signals = [];
    const keyword = new RegExp(choke.keywords.join('|'), 'i');
    [...newsTexts, ...reportTexts].forEach((text) => {
      if (keyword.test(text) && threatVerbs.test(text)) signals.push('threatening coverage');
    });
    (state.warGpsJam?.features || []).some((feature) => {
      const ring = feature.geometry?.coordinates?.[0] || [];
      const lat = ring.reduce((sum, [, la]) => sum + la, 0) / (ring.length || 1);
      const lon = ring.reduce((sum, [lo]) => sum + lo, 0) / (ring.length || 1);
      const percent = Number(feature.properties?.percent) || 0;
      if (percent >= 25 && pointIn(choke, lat, lon)) {
        signals.push(`GPS interference ${percent.toFixed(0)}% of traffic`);
        return true;
      }
      return false;
    });
    const tankers = state.ships.filter((x) => x.type === 'Tanker'
      && Number(x.speed ?? 99) < 3
      && pointIn(choke, Number(x.lat), Number(x.lon)));
    if (tankers.length >= 3) signals.push(`${tankers.length} tankers holding station`);
    return { ...choke, signals: [...new Set(signals)].slice(0, 3) };
  });
}

function outageSignals() {
  return (state.warWorldMonitor?.outages || []).filter((x) => OUTAGE_COUNTRY_TERMS.test(rowText(x)))
    .slice(0, 3)
    .map((x) => `Internet disruption in ${x.country || x.region || x.title || 'producer region'}`);
}

// --- rules ----------------------------------------------------------------------

function theaterRequires(theater, choke) {
  const energy = ['BZ=F', 'CL=F', 'RB=F', 'HO=F', 'NG=F'];
  return [
    { label: 'Conflict reports', weight: 2, test: (c) => c.conflict.count >= 2 && c.conflict.detail },
    { label: 'Headline acceleration', weight: 1, test: (c) => (c.news.hits >= 4 && c.news.rising) && c.news.detail },
    { label: 'Chokepoint disruption', weight: 2, test: (c) => choke.signals.length >= 2 && choke.signals.join(' · ') },
    { label: 'Producer-region outage', weight: 1, test: (c) => c.outages[0] },
    { label: 'Energy & fuel quotes moving', weight: 2, test: (c) => (theater.rule.effects.some((e) => energy.includes(e.symbol)) && c.moves.filter((x) => /Brent|WTI|Gasoline|Heating|Nat/.test(x)).length) || null },
    { label: 'Hedge demand moving', weight: 1, test: (c) => c.moves.find((x) => /^(Gold|VIX) /) || null },
  ];
}

const RULES = [
  {
    id: 'risk-off',
    title: 'RISK-OFF ROTATION',
    summary: 'Conflict activity rising while volatility and gold lift and equities shed value — broad defensive rotation.',
    minScore: 3,
    effects: [
      { symbol: '^VIX', dir: 'up' }, { symbol: 'GC=F', dir: 'up' }, { symbol: 'SI=F', dir: 'up' },
      { symbol: '^GSPC', dir: 'down' },
    ],
    requires: [
      { label: 'Conflict activity rising', weight: 2, test: (c) => Object.values(c.conflicts).some((x) => x.rising && x.count) && 'Multiple theaters show rising reported activity' },
      { label: 'Volatility up', weight: 1, test: (c) => moveLabel('^VIX') },
      { label: 'Gold up · equities down', weight: 2, test: (c) => (moveLabel('GC=F')?.includes('+') && moveLabel('^GSPC')?.includes('-') && `Gold ${moveLabel('GC=F')} · S&P ${moveLabel('^GSPC')}`) || null },
    ],
  },
  {
    id: 'outbreak-travel',
    title: 'TRAVEL & TRADE RISK',
    summary: 'Severe outbreak alerts with travel demand and mobility weakening.',
    minScore: 3,
    effects: [
      { symbol: 'DAL', dir: 'down' }, { symbol: '^GSPC', dir: 'down' }, { symbol: 'GC=F', dir: 'up' },
    ],
    requires: [
      { label: 'Outbreak alerts', weight: 2, test: (c) => c.outbreaks[0] },
      { label: 'Disease headlines rising', weight: 1, test: (c) => (c.diseaseNews >= 3 && `${c.diseaseNews} outbreak-related headlines`) || null },
      { label: 'Travel names selling off', weight: 2, test: (c) => moveLabel('DAL') },
    ],
  },
];

// --- evaluation -------------------------------------------------------------------

/**
 * Build the cross-feed context snapshot and run every rule. Records new
 * deductions in state and raises an ACTIVITY alert through `notify` whenever
 * a deduction fires fresh or re-fires after its cooldown.
 */
function evaluateDeductions(notify = null) {
  const headlineRows = state.news.slice(0, 120);
  const reportRows = [...state.warReports, ...(state.warWorldMonitor?.armed || [])]
    .filter((x) => ageMs(x) <= 7 * 86400000);
  const reportTexts = reportRows.map(rowText);
  const chokepoints = chokepointSignals(headlineRows);
  const outages = outageSignals();

  const ctx = {
    conflicts: {},
    outages,
    chokepoints,
    moves: DEDUCTION_WATCHLIST.map(moveLabel).filter(Boolean),
    outbreaks: (state.diseaseOutbreaks || [])
      .filter((x) => /high|severe|grade 3|grade 4|emergency/i.test(`${x.alertLevel || ''} ${x.disease || ''}`))
      .slice(0, 2)
      .map((x) => `${x.disease || 'Outbreak'} alert · ${x.location || x.countryCode || ''}`.trim()),
    diseaseNews: headlineRows.filter((x) => DISEASE_TERMS.test(x.title || '')).length,
  };

  const fired = [];
  for (const theater of Object.values(THEATERS)) {
    ctx.conflicts[theater.label] = conflictSignals(reportTexts, theater);
    ctx.news = newsSignals(headlineRows, theater);
    const choke = chokepoints.find((x) => x.id === theater.choke);
    const context = { ...ctx, conflict: ctx.conflicts[theater.label], choke };
    fired.push(...runRule({
      id: `theater-${theater.choke}`,
      title: theater.rule.title,
      summary: theater.rule.summary,
      effects: theater.rule.effects,
      minScore: theater.rule.minScore,
      requires: theaterRequires(theater, choke),
    }, context));
  }
  fired.push(...runRule(RULES.find((r) => r.id === 'risk-off'), ctx));
  fired.push(...runRule(RULES.find((r) => r.id === 'outbreak-travel'), ctx));
  commitDeductions(fired, notify);
}

/** Score one rule against the context; returns [deduction] when it fires. */
function runRule(rule, ctx) {
  if (!rule) return [];
  const causes = [];
  let score = 0;
  let maxScore = 0;
  for (const requirement of rule.requires) {
    maxScore += requirement.weight;
    let detail = null;
    try {
      detail = requirement.test(ctx);
    } catch { /* a broken signal collector must not kill the pass */ }
    if (detail) {
      score += requirement.weight;
      causes.push({ source: requirement.label, detail });
    }
  }
  if (score < rule.minScore) return [];
  const effects = rule.effects
    .map((effect) => {
      const label = moveLabel(effect.symbol);
      return {
        symbol: effect.symbol,
        name: effectName(effect.symbol),
        dir: effect.dir,
        observed: label || '',
      };
    });
  return [{
    fingerprint: rule.id,
    rule: rule.id,
    title: rule.title,
    summary: rule.summary,
    causes,
    effects,
    confidence: Math.round(100 * score / Math.max(1, maxScore)),
    at: Date.now(),
  }];
}

/** Merge candidates into state.deductions with cooldown-based de-duplication. */
function commitDeductions(candidates, notify) {
  candidates.forEach((candidate) => {
    const existing = state.deductions.find((x) => x.fingerprint === candidate.fingerprint);
    if (existing) {
      existing.causes = candidate.causes;
      existing.effects = candidate.effects;
      existing.confidence = candidate.confidence;
      existing.lastAt = Date.now();
      if (Date.now() - existing.lastNotified > DEDUCTION_COOLDOWN_MS) {
        existing.hits += 1;
        existing.lastNotified = Date.now();
        emitNotification(existing, notify);
      }
    } else {
      state.deductions.unshift({
        ...candidate,
        firstAt: Date.now(),
        lastAt: Date.now(),
        lastNotified: Date.now(),
        hits: 1,
      });
      state.deductions = state.deductions.slice(0, DEDUCTION_LIMIT);
      emitNotification(candidate, notify);
    }
  });
}

function emitNotification(deduction, notify) {
  if (!notify) return;
  const causes = deduction.causes.map((x) => x.detail || x.source).slice(0, 3).join(' · ');
  const effects = deduction.effects
    .filter((x) => x.observed || x.dir)
    .slice(0, 4)
    .map((x) => `${x.name} ${x.dir === 'up' ? '↑' : '↓'}`)
    .join(' · ');
  notify(`DEDUCTION · ${deduction.title}`, `${causes} → ${effects}`, '');
}

// --- quotes -----------------------------------------------------------------------

async function refreshQuotes() {
  try {
    const r = await req(`/api/quotes?symbols=${encodeURIComponent(DEDUCTION_WATCHLIST.join(','))}`);
    const fresh = r.items || [];
    if (!fresh.length) return;
    fresh.forEach((row) => {
      const baseline = state.deductionBaseline.quotes[row.symbol];
      if (!baseline && Number.isFinite(Number(row.last))) {
        state.deductionBaseline.quotes[row.symbol] = { last: Number(row.last), at: Date.now() };
      }
    });
    state.deductionQuotes = fresh;
  } catch { /* deduction quotes are corroboration, not a primary feed */ }
}

/** Boot the quote watchlist and its 5-minute refresh + re-evaluation tick. */
function initDeductions() {
  if (quoteTimer) return;
  refreshQuotes();
  quoteTimer = setInterval(() => {
    refreshQuotes().then(() => evaluateDeductions());
  }, 300000);
}

export {
  initDeductions,
  evaluateDeductions,
};
