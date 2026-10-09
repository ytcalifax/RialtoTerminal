import { req } from './net.js';
import { state } from './state.js';
const DEDUCTION_COOLDOWN_MS = 6 * 3600000;
const DEDUCTION_LIMIT = 30;
const DEDUCTION_WATCHLIST = [
  'BZ=F', 'CL=F', 'RB=F', 'HO=F', 'NG=F', 'GC=F', 'ZW=F',
  '^VIX', '^GSPC', 'XLE', 'USO', 'UNG', 'XOM', 'SHEL', 'TTE',
  'RTX', 'LMT', 'DAL', 'TSM', 'SMH',
];
const EFFECT_NAMES = {
  'BZ=F': 'Brent', 'CL=F': 'WTI Crude', 'RB=F': 'RBOB Gasoline', 'HO=F': 'Heating Oil',
  'NG=F': 'Natural Gas', 'GC=F': 'Gold', 'SI=F': 'Silver', 'ZW=F': 'Wheat',
  '^VIX': 'VIX', '^GSPC': 'S&P 500', 'XLE': 'Energy ETF', 'USO': 'Oil Fund',
  'UNG': 'NatGas Fund', 'XOM': 'Exxon', 'SHEL': 'Shell', 'TTE': 'TotalEnergies',
  'RTX': 'RTX', 'LMT': 'Lockheed', 'DAL': 'Delta', 'TSM': 'TSMC', 'SMH': 'Semis ETF',
};
const MOVE_FLOOR_PCT = 1;
const QUOTE_MAX_AGE_MS = 30 * 60 * 1000;
const SIGNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
      summary: 'Conflict and supply-route signals coincide with rising fuel prices; this is a risk signal, not proof of causation.',
      minScore: 7,
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
      summary: 'Disruption reporting on the Red Sea corridor coincides with rising fuel prices; this is a risk signal, not proof of causation.',
      minScore: 7,
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
      summary: 'Conflict and Black Sea route signals coincide with rising gas or grain prices; this is a risk signal, not proof of causation.',
      minScore: 7,
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
      summary: 'Taiwan Strait risk signals coincide with falling semiconductor shares; this is a risk signal, not proof of causation.',
      minScore: 7,
      effects: [
        { symbol: 'TSM', dir: 'down' }, { symbol: 'SMH', dir: 'down' }, { symbol: '^GSPC', dir: 'down' },
        { symbol: '^VIX', dir: 'up' }, { symbol: 'GC=F', dir: 'up' },
      ],
    },
  },
};
const DISEASE_TERMS = /\b(outbreak|epidemic|pandemic|virus|influenza|cholera|ebola|marburg|mpox|monkeypox|dengue|plague)\b/i;
const OUTAGE_COUNTRY_TERMS = /\b(iran|iraq|saudi|russia|ukraine|venezuela|libya|nigeria|kuwait|qatar|uae|yemen|egypt|taiwan|china|kazakhstan)\b/i;

let quoteTimer = null;

function ageMs(item) {
  const properties = item?.properties || {};
  const raw = item?.published || item?.occurredAt || item?.dateStart || item?.detectedAt
    || item?.publishedAt || item?.date || properties.event_date || '';
  const numeric = typeof raw === 'number' || /^\d{10,13}$/.test(String(raw));
  const value = numeric ? Number(raw) : Date.parse(String(raw));
  const timestamp = numeric ? (value < 1e12 ? value * 1000 : value) : value;
  if (Number.isNaN(timestamp) || timestamp > Date.now() + 5 * 60 * 1000) return Infinity;
  return Date.now() - timestamp;
}
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
function matchesSelectedTopics(item) {
  const terms = String(state.alertSettings.keywords || '').split(',').map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
  return !terms.length || terms.some((term) => rowText(item).includes(term));
}

function pointIn(box, lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

function fmtPct(value) {
  return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
}

function quoteRow(symbol) {
  return state.deductionQuotes.find((x) => x.symbol === symbol) || null;
}
function moveOf(symbol) {
  const row = quoteRow(symbol);
  if (!row || row.stale === true) return null;
  const asof = Number(row.asof);
  const quoteAt = asof * 1000;
  if (!Number.isFinite(asof) || asof <= 0 || quoteAt > Date.now() + 5 * 60 * 1000
    || Date.now() - quoteAt > QUOTE_MAX_AGE_MS) return null;
  if (row.pct == null || row.pct === '') return null;
  const pct = Number(row.pct);
  return Number.isFinite(pct) ? pct : null;
}
function effectName(symbol) {
  return EFFECT_NAMES[symbol] || quoteRow(symbol)?.name || symbol;
}

function moveInDirection(symbol, direction) {
  const move = moveOf(symbol);
  if (move == null || Math.abs(move) < MOVE_FLOOR_PCT) return null;
  if ((direction === 'up' && move <= 0) || (direction === 'down' && move >= 0)) return null;
  return `${effectName(symbol)} ${fmtPct(move)}`;
}

function quoteDiagnostic(symbol, direction) {
  const row = quoteRow(symbol);
  if (!row) return 'NO QUOTE';
  if (row.stale === true) return 'SOURCE MARKED STALE';
  const asof = Number(row.asof);
  const quoteAt = asof * 1000;
  if (!Number.isFinite(asof) || asof <= 0 || quoteAt > Date.now() + 5 * 60 * 1000) return 'INVALID QUOTE TIMESTAMP';
  const ageMinutes = Math.max(0, Math.round((Date.now() - quoteAt) / 60000));
  if (Date.now() - quoteAt > QUOTE_MAX_AGE_MS) return `STALE QUOTE · ${ageMinutes}M OLD`;
  if (row.pct == null || row.pct === '' || !Number.isFinite(Number(row.pct))) return 'NO VALID CHANGE VALUE';
  const move = Number(row.pct);
  if (move === 0) return `FLAT · ${fmtPct(move)} · BELOW ${MOVE_FLOOR_PCT}% FLOOR`;
  const directionMatches = direction === 'up' ? move > 0 : move < 0;
  if (Math.abs(move) < MOVE_FLOOR_PCT) {
    return `${directionMatches ? 'ALIGNED' : 'OPPOSITE'} · ${fmtPct(move)} · BELOW ${MOVE_FLOOR_PCT}% FLOOR`;
  }
  return `${directionMatches ? 'ALIGNED' : 'OPPOSITE'} · ${fmtPct(move)}`;
}

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
function chokepointSignals(rows) {
  const newsTexts = rows.filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS).map(rowText);
  const reportTexts = [...state.warReports, ...(state.warWorldMonitor?.armed || [])]
    .filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS && matchesSelectedTopics(x)).map(rowText);
  const threatVerbs = /\b(closed|closure|blocked|attack(?:s|ed)?|struck|mined|seized|disrupt(?:ed|ion)?|halted|suspended)\b/i;
  return CHOKEPOINTS.map((choke) => {
    const signals = [];
    const keyword = new RegExp(choke.keywords.join('|'), 'i');
    [...newsTexts, ...reportTexts].forEach((text) => {
      if (keyword.test(text) && threatVerbs.test(text)) signals.push('threatening coverage');
    });
    const jamDate = Date.parse(String(state.warGpsJam?.date || ''));
    const jamIsRecent = Number.isFinite(jamDate) && Date.now() - jamDate <= 2 * SIGNAL_MAX_AGE_MS;
    (jamIsRecent ? state.warGpsJam?.features || [] : []).some((feature) => {
      const geometry = feature.geometry || {};
      const coordinates = geometry.coordinates || [];
      const points = geometry.type === 'MultiPolygon' ? coordinates.flat(2) : (coordinates[0] || []);
      const ring = points.filter((point) => Array.isArray(point)
        && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
      if (!ring.length) return false;
      const lat = ring.reduce((sum, [, la]) => sum + Number(la), 0) / ring.length;
      const lon = ring.reduce((sum, [lo]) => sum + Number(lo), 0) / ring.length;
      const percent = Number(feature.properties?.percent) || 0;
      if (percent >= 25 && pointIn(choke, lat, lon)) {
        signals.push(`GPS interference ${percent.toFixed(0)}% of traffic`);
        return true;
      }
      return false;
    });
    return { ...choke, signals: [...new Set(signals)].slice(0, 3) };
  });
}

function outageSignals(producers = null) {
  const outages = (state.warWorldMonitor?.outages || [])
    .filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS && matchesSelectedTopics(x) && OUTAGE_COUNTRY_TERMS.test(rowText(x)));
  const filtered = producers ? outages.filter((x) => {
    const text = rowText(x);
    return producers.some((country) => text.includes(country.toLowerCase()));
  }) : outages;
  return filtered.slice(0, 3)
    .map((x) => `Internet disruption in ${x.country || x.region || x.title || 'producer region'}`);
}

function inputVisibility() {
  const topics = String(state.alertSettings.keywords || '').split(',').map((term) => term.trim()).filter(Boolean);
  const rawHeadlines = state.news.slice(0, 120).filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS);
  const rawReports = [...state.warReports, ...(state.warWorldMonitor?.armed || [])]
    .filter((x) => ageMs(x) <= 7 * 86400000);
  const topicReports = topics.length ? rawReports.filter(matchesSelectedTopics) : rawReports;
  const rawOutages = (state.warWorldMonitor?.outages || []).filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS);
  const outbreakFeedFresh = !state.diseaseOutbreaksStale
    && Number.isFinite(state.diseaseOutbreaksUpdatedAt)
    && Date.now() - state.diseaseOutbreaksUpdatedAt <= SIGNAL_MAX_AGE_MS;
  const rawOutbreaks = outbreakFeedFresh ? state.diseaseOutbreaks || [] : [];
  const topicMatched = (rows) => topics.length ? rows.filter(matchesSelectedTopics).length : rows.length;
  const severeOutbreak = (x) => /^(high|severe|emergency|(?:who\s+)?grade\s*[34])\b/i.test(String(x.alertLevel || '').trim());
  const topicOutbreaks = topics.length ? rawOutbreaks.filter(matchesSelectedTopics) : rawOutbreaks;
  return {
    headlines: { considered: Math.min(state.news.length, 120), fresh: rawHeadlines.length, topicMatched: topicMatched(rawHeadlines) },
    conflictReports: {
      fresh: rawReports.length,
      topicMatched: topicReports.length,
      uniqueTopicMatched: new Set(topicReports.map((x) => String(x.id || x.url || x.sourceUrl || `${x.date || x.dateStart || x.occurredAt || ''}-${x.name || x.title || x.location || ''}`))).size,
    },
    outages: { fresh: rawOutages.length, topicMatched: topicMatched(rawOutages) },
    outbreaks: {
      fresh: rawOutbreaks.length,
      topicMatched: topicMatched(rawOutbreaks),
      severe: rawOutbreaks.filter(severeOutbreak).length,
      topicMatchedSevere: topicOutbreaks.filter(severeOutbreak).length,
      feedStatus: outbreakFeedFresh ? 'CURRENT' : 'STALE / NO FRESH UPDATE',
    },
    topicFilter: topics.length ? 'ACTIVE (OR MATCH)' : 'OFF · ALL TOPICS',
  };
}

function theaterGateChecks(context) {
  const conflictPass = context.conflict.count >= 2;
  const headlinesPass = context.news.hits >= 4 && context.news.rising;
  const chokepointPass = context.choke.signals.length > 0;
  const outagePass = context.outages.length > 0;
  return [
    { passed: conflictPass || headlinesPass, detail: `Conflict ≥2 (${context.conflict.count}) OR rising headlines ≥4 (${context.news.hits}${context.news.rising ? ', rising' : ', not rising'})` },
    { passed: chokepointPass || outagePass, detail: `Chokepoint signals ≥1 (${context.choke.signals.length}) OR producer outages ≥1 (${context.outages.length})` },
  ];
}

function theaterRequires(theater, choke) {
  const coreEffects = theater.rule.effects.filter((effect) => ['BZ=F', 'CL=F', 'RB=F', 'HO=F', 'NG=F'].includes(effect.symbol));
  if (!coreEffects.length && theater.rule.effects.some((effect) => effect.symbol === 'TSM')) {
    coreEffects.push(...theater.rule.effects.filter((effect) => ['TSM', 'SMH'].includes(effect.symbol)));
  }
  return [
    { label: 'Conflict reports', weight: 2, test: (c) => c.conflict.count >= 2 && c.conflict.detail },
    { label: 'Headline acceleration', weight: 1, test: (c) => (c.news.hits >= 4 && c.news.rising) && c.news.detail },
    { label: 'Chokepoint disruption signals', weight: 2, test: () => choke.signals.length >= 2 ? choke.signals.join(' · ') : null },
    { label: 'Producer-region outage', weight: 1, test: (c) => c.outages[0] },
    { label: 'At least two core market quotes moving in the expected direction', weight: 3, test: () => {
      const matches = coreEffects.map((effect) => moveInDirection(effect.symbol, effect.dir)).filter(Boolean);
      return matches.length >= 2 ? matches.slice(0, 3).join(' · ') : null;
    } },
    { label: 'Hedge demand moving in the expected direction', weight: 1, test: () => theater.rule.effects
      .filter((effect) => ['GC=F', '^VIX'].includes(effect.symbol))
      .map((effect) => moveInDirection(effect.symbol, effect.dir)).find(Boolean) || null },
  ];
}

const RULES = [
  {
    id: 'risk-off',
    title: 'RISK-OFF ROTATION',
    summary: 'Conflict activity rising while volatility and gold lift and equities shed value — broad defensive rotation.',
    minScore: 5,
    effects: [
      { symbol: '^VIX', dir: 'up' }, { symbol: 'GC=F', dir: 'up' }, { symbol: 'SI=F', dir: 'up' },
      { symbol: '^GSPC', dir: 'down' },
    ],
    requires: [
      { label: 'Conflict activity rising in at least two theaters', weight: 2, test: (c) => Object.values(c.conflicts).filter((x) => x.rising && x.count).length >= 2 && 'Reported activity increased in at least two theaters' },
      { label: 'Volatility up', weight: 1, test: () => moveInDirection('^VIX', 'up') },
      { label: 'Gold up · equities down', weight: 2, test: () => {
        const gold = moveInDirection('GC=F', 'up');
        const equities = moveInDirection('^GSPC', 'down');
        return gold && equities ? `${gold} · ${equities}` : null;
      } },
    ],
  },
  {
    id: 'outbreak-travel',
    title: 'TRAVEL & TRADE RISK',
    summary: 'Severe outbreak alerts coincide with a falling airline share price; this is a risk signal, not proof of causation.',
    minScore: 4,
    effects: [
      { symbol: 'DAL', dir: 'down' }, { symbol: '^GSPC', dir: 'down' }, { symbol: 'GC=F', dir: 'up' },
    ],
    requires: [
      { label: 'Outbreak alerts', weight: 2, test: (c) => c.outbreaks[0] },
      { label: 'Disease headlines rising', weight: 1, test: (c) => (c.diseaseNews >= 3 && `${c.diseaseNews} outbreak-related headlines`) || null },
      { label: 'Travel names selling off', weight: 2, test: () => moveInDirection('DAL', 'down') },
    ],
  },
];

/**
 * Build the cross-feed context snapshot and run every rule. Records new
 * deductions in state and raises an ACTIVITY alert through `notify` whenever
 * a deduction fires fresh or re-fires after its cooldown.
 */
function evaluateDeductions(notify = null) {
  const headlineRows = state.news.slice(0, 120).filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS && matchesSelectedTopics(x));
  const reportCandidates = [...state.warReports, ...(state.warWorldMonitor?.armed || [])]
    .filter((x) => ageMs(x) <= 7 * 86400000 && matchesSelectedTopics(x));
  const reportRows = [...new Map(reportCandidates.map((x) => [
    String(x.id || x.url || x.sourceUrl || `${x.date || x.dateStart || x.occurredAt || ''}-${x.name || x.title || x.location || ''}`), x,
  ])).values()];
  const reportTexts = reportRows.map(rowText);
  const chokepoints = chokepointSignals(headlineRows);

  const ctx = {
    conflicts: {},
    chokepoints,
    outbreaks: (!state.diseaseOutbreaksStale
      && Number.isFinite(state.diseaseOutbreaksUpdatedAt)
      && Date.now() - state.diseaseOutbreaksUpdatedAt <= SIGNAL_MAX_AGE_MS
      ? state.diseaseOutbreaks || [] : [])
      .filter(matchesSelectedTopics)
      .filter((x) => /^(high|severe|emergency|(?:who\s+)?grade\s*[34])\b/i.test(String(x.alertLevel || '').trim()))
      .slice(0, 2)
      .map((x) => `${x.disease || 'Outbreak'} alert · ${x.location || x.countryCode || ''}`.trim()),
    diseaseNews: new Set(headlineRows.filter((x) => DISEASE_TERMS.test(x.title || '')).map((x) => x.url || x.title)).size,
  };

  const fired = [];
  const diagnostics = [];
  for (const theater of Object.values(THEATERS)) {
    ctx.conflicts[theater.label] = conflictSignals(reportTexts, theater);
    ctx.news = newsSignals(headlineRows, theater);
    ctx.outages = outageSignals(theater.producers);
    const choke = chokepoints.find((x) => x.id === theater.choke);
    const context = { ...ctx, conflict: ctx.conflicts[theater.label], choke };
    fired.push(...runRule({
      id: `theater-${theater.choke}`,
      title: theater.rule.title,
      summary: theater.rule.summary,
      gateDescription: 'At least 2 conflict reports or 4+ rising theater headlines; and a chokepoint signal or producer-region outage.',
      gateChecks: theaterGateChecks,
      effects: theater.rule.effects,
      minScore: theater.rule.minScore,
      gate: (c) => (c.conflict.count >= 2 || (c.news.hits >= 4 && c.news.rising))
        && (c.choke.signals.length > 0 || c.outages.length > 0),
      requires: theaterRequires(theater, choke),
    }, context, diagnostics));
  }
  ctx.outages = outageSignals();
  fired.push(...runRule(RULES.find((r) => r.id === 'risk-off'), ctx, diagnostics));
  fired.push(...runRule(RULES.find((r) => r.id === 'outbreak-travel'), ctx, diagnostics));
  state.deductionDiagnostics = {
    evaluatedAt: Date.now(),
    selectedTopics: String(state.alertSettings.keywords || '').split(',').map((term) => term.trim()).filter(Boolean),
    inputs: inputVisibility(),
    rules: diagnostics,
  };
  commitDeductions(fired, notify);
}
function runRule(rule, ctx, diagnostics = null) {
  if (!rule) return [];
  let gatePassed = true;
  try { gatePassed = rule.gate ? Boolean(rule.gate(ctx)) : true; } catch { gatePassed = false; }
  const gateChecks = rule.gateChecks ? rule.gateChecks(ctx) : [];
  const causes = [];
  const requirements = [];
  let score = 0;
  let maxScore = 0;
  for (const requirement of rule.requires) {
    maxScore += requirement.weight;
    let detail = null;
    try {
      detail = requirement.test(ctx);
    } catch { /* a broken signal collector must not kill the pass */ }
    const passed = Boolean(detail);
    requirements.push({ label: requirement.label, weight: requirement.weight, passed, detail: detail ? String(detail) : '' });
    if (passed) {
      score += requirement.weight;
      causes.push({ source: requirement.label, detail });
    }
  }
  const effects = rule.effects
    .map((effect) => {
      const label = moveInDirection(effect.symbol, effect.dir);
      return {
        symbol: effect.symbol,
        name: effectName(effect.symbol),
        dir: effect.dir,
        observed: label || '',
        quoteStatus: quoteDiagnostic(effect.symbol, effect.dir),
      };
    });
  const status = !gatePassed ? 'GATE CLOSED' : score < rule.minScore ? 'BELOW THRESHOLD' : 'FIRED';
  diagnostics?.push({
    id: rule.id,
    title: rule.title,
    summary: rule.summary,
    gateDescription: rule.gateDescription || 'No separate gate.',
    gatePassed,
    gateChecks,
    score,
    maxScore,
    minScore: rule.minScore,
    status,
    requirements,
    effects: effects.map((effect, index) => ({ ...effect, dir: rule.effects[index].dir })),
  });
  if (!gatePassed || score < rule.minScore) return [];
  return [{
    fingerprint: rule.id,
    rule: rule.id,
    title: rule.title,
    summary: rule.summary,
    causes,
    effects,
    evidenceCoveragePct: Math.round(100 * score / Math.max(1, maxScore)),
    at: Date.now(),
  }];
}
function commitDeductions(candidates, notify) {
  candidates.forEach((candidate) => {
    const existing = state.deductions.find((x) => x.fingerprint === candidate.fingerprint);
    if (existing) {
      existing.causes = candidate.causes;
      existing.effects = candidate.effects;
      existing.evidenceCoveragePct = candidate.evidenceCoveragePct;
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
    .filter((x) => x.observed)
    .slice(0, 4)
    .map((x) => x.observed)
    .join(' · ');
  notify(`DEDUCTION · ${deduction.title}`, effects ? `${causes} → Observed: ${effects}` : causes, '');
}

async function refreshQuotes() {
  try {
    const r = await req(`/api/quotes?symbols=${encodeURIComponent(DEDUCTION_WATCHLIST.join(','))}`);
    const fresh = r.items || [];
    if (!fresh.length) return;
    state.deductionQuotes = fresh;
  } catch { /* deduction quotes are corroboration, not a primary feed */ }
}
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
