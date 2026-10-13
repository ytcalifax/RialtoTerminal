import { req } from './net.js';
import { state } from './state.js';
import { emit } from './hooks.js';
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
const NEWS_WINDOW_MS = 15 * 60 * 1000;
const CHOKEPOINTS = [
  { id: 'hormuz', name: 'Strait of Hormuz', keywords: ['hormuz'], minLat: 25.5, maxLat: 27.5, minLon: 55, maxLon: 58 },
  { id: 'redsea', name: 'Red Sea / Bab el-Mandeb', keywords: ['red sea', 'bab el-mandeb', 'bab al-mandeb', 'mandeb'], minLat: 11, maxLat: 21, minLon: 32, maxLon: 44 },
  { id: 'suez', name: 'Suez Canal', keywords: ['suez'], minLat: 29.5, maxLat: 31.5, minLon: 32, maxLon: 33 },
  { id: 'bosphorus', name: 'Bosphorus / Black Sea', keywords: ['bosphorus', 'bosporus'], minLat: 40.8, maxLat: 41.5, minLon: 28.5, maxLon: 30 },
  { id: 'blacksea', name: 'Black Sea grain corridor', keywords: ['black sea', 'bosphorus', 'bosporus'], minLat: 41, maxLat: 47, minLon: 28, maxLon: 41 },
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
  const contentKeys = new Set(['properties', 'title', 'headline', 'description', 'summary', 'text', 'content', 'name', 'location', 'locationname', 'admin1', 'country', 'sidea', 'sideb', 'actors', 'themes', 'mentionedthemes', 'mentionednames', 'disease', 'severity', 'cause', 'outagetype']);
  const metadataKeys = new Set(['url', 'sourceurl', 'id', 'source', 'provider', 'category', 'domain', 'region', 'language', 'date', 'published', 'publishedat', 'occurredat', 'detectedat']);
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach((entry) => walk(entry));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => {
      const normalized = key.toLocaleLowerCase();
      if (metadataKeys.has(normalized)) return;
      if (contentKeys.has(normalized)) walk(child);
    });
    else if (typeof value === 'string') values.push(value);
  };
  walk(item);
  return values.join(' ').toLowerCase();
}
function matchesSelectedTopics(item) {
  return matchesTopicText(rowText(item));
}
function matchesTopicText(text) {
  const terms = String(state.alertSettings.keywords || '').split(',').map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
  return !terms.length || terms.some((term) => String(text).toLocaleLowerCase().includes(term));
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

function moveWeight(symbol, direction) {
  const move = moveOf(symbol);
  if (move == null || Math.abs(move) < MOVE_FLOOR_PCT) return 0;
  if ((direction === 'up' && move <= 0) || (direction === 'down' && move >= 0)) return 0;
  const magnitude = Math.abs(move);
  if (magnitude >= 5) return 3;
  if (magnitude >= 2) return 2;
  return 1;
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

function conflictEventWeight(report) {
  const properties = report?.properties || report || {};
  const text = rowText(report);
  const goldstein = Number(properties.goldstein);
  const mentions = Number(properties.mentions || properties.articles || 1);
  // Research-backed weighting: UCDP/CAMEO severity is commonly proxied by
  // the event's Goldstein conflict intensity; prominence is approximated by
  // logarithmic article/mention counts, which grow sublinearly so one
  // heavily-covered event cannot dwarf several moderate events.
  let severity = 1;
  if (Number.isFinite(goldstein) && goldstein < 0) {
    // Goldstein scale runs roughly -10..+10; conflict intensity increases
    // as values become more negative. Scale to a 1..4 severity bucket.
    severity = Math.max(1, Math.min(4, Math.ceil(Math.abs(goldstein) / 2.5)));
  } else if (/\bMASS VIOLENCE\b/i.test(text)) {
    severity = 3;
  } else if (/\bFIGHT\b/i.test(text)) {
    severity = 2;
  } else if (/\bASSAULT\b/i.test(text)) {
    severity = 1;
  }
  const prominence = Number.isFinite(mentions) && mentions > 10
    ? Math.min(2, Math.floor(Math.log10(Math.max(1, mentions))))
    : 0;
  return Math.max(1, Math.min(6, severity + prominence));
}

function conflictSignals(reports, theater) {
  const relevant = (Array.isArray(reports) ? reports : []).filter((report) => theater.keywords.test(rowText(report)));
  const count = relevant.length;
  const weight = relevant.reduce((sum, report) => sum + conflictEventWeight(report), 0);
  const previous = state.deductionBaseline.conflict[theater.label] ?? weight;
  state.deductionBaseline.conflict[theater.label] = weight;
  return {
    count,
    weight,
    rising: weight > previous && previous >= 0,
    detail: count ? `${count} ${theater.label} ${count === 1 ? 'event' : 'events'} reported (severity weight ${weight})${weight > previous ? ' · activity rising' : ''}` : '',
  };
}

function newsSignals(rows, theater) {
  const relevant = rows.filter((x) => theater.keywords.test(x.title || ''));
  const hits = relevant.filter((x) => ageMs(x) <= NEWS_WINDOW_MS).length;
  const previous = relevant.filter((x) => ageMs(x) > NEWS_WINDOW_MS && ageMs(x) <= NEWS_WINDOW_MS * 2).length;
  const rising = hits >= 4 && hits - previous >= 2;
  return {
    hits,
    previousHits: previous,
    rising,
    detail: hits ? `${hits} headlines in the last 15m vs ${previous} in the prior 15m${rising ? ' · coverage accelerating' : ''}` : '',
  };
}
function chokepointSignals(rows) {
  const newsTexts = rows.filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS).map(rowText);
  const reportTexts = [...state.warReports, ...(state.warWorldMonitor?.armed || [])]
    .filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS && matchesSelectedTopics(x)).map(rowText);
  const threatVerbs = /\b(closed|closure|blocked|attack(?:s|ed)?|struck|mined|seized|disrupt(?:ed|ion)?|halted|suspended)\b/i;
  return CHOKEPOINTS.map((choke) => {
    const signals = [];
    const observations = [];
    const flowSignals = [];
    const evidenceFamilies = new Set();
    const context = [];
    const keyword = new RegExp(choke.keywords.join('|'), 'i');
    [...newsTexts, ...reportTexts].forEach((text) => {
      if (keyword.test(text) && threatVerbs.test(text)) {
        signals.push('reported route disruption');
        evidenceFamilies.add('reporting');
      }
    });
    const wm = state.warWorldMonitor || {};
    const sourceAt = Date.parse(String(wm.chokepoints_fetched_at || ''));
    const sourceFresh = Number.isFinite(sourceAt) && sourceAt <= Date.now() + 5 * 60 * 1000
      && Date.now() - sourceAt <= 30 * 60 * 1000
      && wm.source_status?.chokepoints === 'OK';
    const wmPoint = sourceFresh ? (wm.chokepoints || []).find((point) => {
      const text = `${point.id || ''} ${point.name || ''}`.toLocaleLowerCase();
      return choke.keywords.some((term) => text.includes(term));
    }) : null;
    const topicMatchedWmPoint = wmPoint && matchesTopicText(`${wmPoint.name || ''} ${(wmPoint.affectedRoutes || []).join(' ')} ${wmPoint.description || ''}`);
    if (topicMatchedWmPoint) {
      const ais = Number(wmPoint.aisDisruptions) || 0;
      const warnings = Number(wmPoint.activeWarnings) || 0;
      const congestion = String(wmPoint.congestionLevel || '').toLocaleLowerCase();
      const elevatedCongestion = ['high', 'severe', 'critical'].includes(congestion);
      const direct = [];
      if (ais > 0) direct.push(`${ais} AIS disruption${ais === 1 ? '' : 's'}`);
      if (warnings > 0) direct.push(`${warnings} active navigation warning${warnings === 1 ? '' : 's'}`);
      if (elevatedCongestion) direct.push(`${congestion} congestion`);
      const transit = wmPoint.transitSummary || {};
      const transitIncidents = Number(transit.incidentCount7d);
      const transitDisruption = Number(transit.disruptionPct);
      const transitAnomaly = transit.dataAvailable === true && transitIncidents >= 2 && transitDisruption >= 20;
      const flow = wmPoint.flowEstimate || {};
      const flowAnomaly = flow.disrupted === true || /^(red|orange|critical|severe)$/i.test(String(flow.hazardAlertLevel || ''));
      if (flowAnomaly) {
        const ratio = Number(flow.flowRatio);
        const detail = [flow.disrupted === true ? 'flow estimate marked disrupted' : '', Number.isFinite(ratio) ? `flow at ${Math.round(ratio * 100)}% of baseline` : '', flow.hazardAlertLevel ? `${flow.hazardAlertLevel} hazard alert${flow.hazardAlertName ? ` ${flow.hazardAlertName}` : ''}` : ''].filter(Boolean).join(' · ');
        flowSignals.push(detail);
        signals.push(`World Monitor supply-flow estimate: ${detail}`);
      }
      if (transit.dataAvailable === true) {
        context.push(`World Monitor 7-day transit context: ${transit.incidentCount7d ?? 'incident count unavailable'} incidents · ${transit.disruptionPct ?? 'disruption unavailable'}% disruption · ${transit.riskLevel || 'risk level unavailable'}`);
      }
      const repeatedDirectSignals = ais >= 3 || (ais > 0 && warnings >= 3);
      const corroboratedDirectSignal = transitAnomaly && (ais > 0 || warnings > 0 || elevatedCongestion);
      const observedDisruption = flowAnomaly || repeatedDirectSignals || corroboratedDirectSignal;
      if (observedDisruption) {
        const corroboration = transitAnomaly ? `7-day transit reports ${transitIncidents} incidents and ${transitDisruption}% disruption` : '';
        const evidence = [...direct, corroboration].filter(Boolean);
        const detail = evidence.join(' · ') || 'supply-flow disruption estimate';
        signals.push(`World Monitor corroborated route disruption: ${detail}`);
        observations.push(...evidence);
        if (direct.length) evidenceFamilies.add('maritime observations');
      } else if (direct.length) {
        context.push(`World Monitor route readings not scored without corroboration: ${direct.join(' · ')}`);
      }
      // This score includes a static geopolitical threat baseline. Keep it
      // visible for context, but never count it as an observed disruption.
      if (Number.isFinite(Number(wmPoint.disruptionScore))) {
        context.push(`World Monitor baseline-influenced status ${wmPoint.status || 'unknown'} · score ${Number(wmPoint.disruptionScore)}`);
      }
    }
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
      if (percent > 10 && pointIn(choke, lat, lon)) {
        context.push(`Navigation interference affecting ${percent.toFixed(0)}% of aircraft reports nearby`);
        return true;
      }
      return false;
    });
    const evidenceWeight = (observations.length ? 3 : 0)
      + (flowSignals.length ? 2 : 0)
      + (evidenceFamilies.has('reporting') ? 1 : 0)
      + (evidenceFamilies.has('maritime observations') ? 1 : 0);
    return {
      ...choke,
      weight: evidenceWeight,
      signals: [...new Set(signals)].slice(0, 4),
      observations: [...new Set(observations)],
      flowSignals: [...new Set(flowSignals)],
      evidenceFamilies: [...evidenceFamilies],
      context: [...new Set(context)].slice(0, 3),
    };
  });
}

function outageSeverityWeight(outage) {
  const text = rowText(outage).toLowerCase();
  let weight = 1;
  if (/\b(critical|severe|major|total|nationwide|countrywide|blackout)\b/.test(text)) weight = 3;
  else if (/\b(moderate|medium|partial)\b/.test(text)) weight = 2;
  const percentage = Number(
    outage?.percentage ?? outage?.disruptionPct ?? outage?.percent ?? outage?.impactPct ?? NaN
  );
  if (Number.isFinite(percentage)) {
    if (percentage >= 75) weight = Math.max(weight, 3);
    else if (percentage >= 35) weight = Math.max(weight, 2);
  }
  return weight;
}

function outageSignals(producers = null) {
  const outages = (state.warWorldMonitor?.outages || [])
    .filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS && matchesSelectedTopics(x) && OUTAGE_COUNTRY_TERMS.test(rowText(x)));
  const filtered = producers ? outages.filter((x) => {
    const text = rowText(x);
    return producers.some((country) => text.includes(country.toLowerCase()));
  }) : outages;
  return filtered.slice(0, 3).map((x) => ({
    text: `Internet disruption in ${x.country || x.region || x.title || 'producer region'}`,
    weight: outageSeverityWeight(x),
  }));
}

function inputVisibility() {
  const topics = String(state.alertSettings.keywords || '').split(',').map((term) => term.trim()).filter(Boolean);
  const rawHeadlines = state.news.slice(0, 120).filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS);
  const rawReports = [...state.warReports, ...(state.warWorldMonitor?.armed || [])]
    .filter((x) => ageMs(x) <= 7 * 86400000);
  const topicReports = topics.length ? rawReports.filter(matchesSelectedTopics) : rawReports;
  const rawOutages = (state.warWorldMonitor?.outages || []).filter((x) => ageMs(x) <= SIGNAL_MAX_AGE_MS);
  const chokepoints = state.warWorldMonitor?.chokepoints || [];
  const chokepointAt = Date.parse(String(state.warWorldMonitor?.chokepoints_fetched_at || ''));
  const chokepointFresh = state.warWorldMonitor?.source_status?.chokepoints === 'OK'
    && Number.isFinite(chokepointAt) && chokepointAt <= Date.now() + 5 * 60 * 1000
    && Date.now() - chokepointAt <= 30 * 60 * 1000;
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
    chokepointStatus: {
      status: chokepointFresh ? 'CURRENT' : 'STALE / UNAVAILABLE',
      observedRoutes: chokepointFresh ? chokepoints.filter((point) => matchesTopicText(`${point.name || ''} ${(point.affectedRoutes || []).join(' ')} ${point.description || ''}`)
        && (Number(point.aisDisruptions) > 0
        || Number(point.activeWarnings) > 0
        || ['high', 'severe', 'critical'].includes(String(point.congestionLevel || '').toLocaleLowerCase())
        || point.flowEstimate?.disrupted === true)).length : 0,
    },
    outbreaks: {
      fresh: rawOutbreaks.length,
      topicMatched: topicMatched(rawOutbreaks),
      severe: rawOutbreaks.filter(severeOutbreak).length,
      topicMatchedSevere: topicOutbreaks.filter(severeOutbreak).length,
      feedStatus: outbreakFeedFresh ? 'CURRENT' : 'STALE / NO FRESH UPDATE',
    },
    outbreakNewsSignal: {
      enabled: Boolean(state.alertSettings.news && state.alertSettings.diseaseOutbreaks),
      diseaseHeadlines: rawHeadlines.filter((item) => DISEASE_TERMS.test(item.title || '')).length,
      outbreaks: rawOutbreaks.length,
    },
    topicFilter: topics.length ? 'ACTIVE (OR MATCH)' : 'OFF · ALL TOPICS',
  };
}

function theaterGateChecks(context) {
  const conflictPass = context.conflict.weight >= 3;
  const headlinesPass = context.news.hits >= 4 && context.news.rising;
  const chokepointPass = (context.choke.weight || 0) >= 2;
  const outagePass = context.outages.reduce((sum, item) => sum + (item.weight || 1), 0) >= 2;
  const routeContext = context.choke.context.length
    ? ` · Context only (not scored): ${context.choke.context.join(' · ')}` : '';
  return [
    { passed: conflictPass || headlinesPass, detail: `Conflict ≥2 (${context.conflict.count}) OR headlines ≥4 and +2 vs prior 15m (${context.news.hits} vs ${context.news.previousHits}${context.news.rising ? ', rising' : ', not rising'})` },
    { passed: chokepointPass || outagePass, detail: `Route observations ${context.choke.evidenceFamilies.length} source families (${context.choke.signals.length} records) OR producer outages ≥1 (${context.outages.length})${routeContext}` },
  ];
}

function theaterRequires(theater, choke) {
  const coreEffects = theater.rule.effects.filter((effect) => ['BZ=F', 'CL=F', 'RB=F', 'HO=F', 'NG=F'].includes(effect.symbol));
  if (!coreEffects.length && theater.rule.effects.some((effect) => effect.symbol === 'TSM')) {
    coreEffects.push(...theater.rule.effects.filter((effect) => ['TSM', 'SMH'].includes(effect.symbol)));
  }
  return [
    { label: 'Conflict reports', weight: 2, test: (c) => c.conflict.weight >= 3 && c.conflict.detail },
    { label: 'Headline acceleration', weight: 1, test: (c) => (c.news.hits >= 4 && c.news.rising) && c.news.detail },
    { label: 'Corroborated maritime disruption', weight: 2, test: () => choke.observations.length ? choke.observations.join(' · ') : null },
    { label: 'World Monitor supply-flow disruption', weight: 1, test: () => choke.flowSignals[0] || null },
    { label: 'Independent reporting corroborates maritime observations', weight: 2, test: () => choke.evidenceFamilies.includes('reporting') && choke.evidenceFamilies.includes('maritime observations') ? choke.signals.join(' · ') : null },
    { label: 'Producer-region outage', weight: 1, test: (c) => c.outages.length ? (c.outages.map((o) => `${o.text} (weight ${o.weight})`).join(' · ')) : null },
    { label: 'Core market quotes moving in the expected direction', weight: 3, test: () => {
      const weightedMoves = coreEffects
        .map((effect) => ({ effect, weight: moveWeight(effect.symbol, effect.dir), label: moveInDirection(effect.symbol, effect.dir) }))
        .filter((item) => item.weight > 0);
      const totalWeight = weightedMoves.reduce((sum, item) => sum + item.weight, 0);
      return totalWeight >= 3 ? weightedMoves.slice(0, 3).map((item) => item.label).join(' · ') : null;
    } },
    { label: 'Hedge demand moving in the expected direction', weight: 1, test: () => theater.rule.effects
      .filter((effect) => ['GC=F', '^VIX'].includes(effect.symbol))
      .map((effect) => moveInDirection(effect.symbol, effect.dir)).find(Boolean) || null },
  ];
}

function theaterWatchReason(context) {
  const details = [];
  if (context.conflict.count) details.push(`${context.conflict.count} conflict report${context.conflict.count === 1 ? '' : 's'}`);
  if (context.news.hits) details.push(`${context.news.hits} headlines in 15m`);
  if (context.choke.signals.length) details.push(`${context.choke.signals.length} route signal${context.choke.signals.length === 1 ? '' : 's'}`);
  if (context.choke.observations.length) details.push('corroborated maritime observation');
  if (context.outages.length) details.push(`${context.outages.length} producer outage${context.outages.length === 1 ? '' : 's'}`);
  return details.join(' · ');
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
      { label: 'Conflict activity rising in at least two theaters', weight: 2, test: (c) => Object.values(c.conflicts).filter((x) => x.rising && (x.weight || 0) >= 3).length >= 2 && 'Reported activity increased in at least two theaters' },
      { label: 'Volatility up', weight: 1, test: () => moveInDirection('^VIX', 'up') },
      { label: 'Gold up · equities down', weight: 2, test: () => {
        const gold = moveInDirection('GC=F', 'up');
        const equities = moveInDirection('^GSPC', 'down');
        return gold && equities ? `${gold} · ${equities}` : null;
      } },
    ],
    watch: (c) => Object.values(c.conflicts).some((x) => x.count > 0)
      || [moveInDirection('^VIX', 'up'), moveInDirection('GC=F', 'up'), moveInDirection('^GSPC', 'down')].filter(Boolean).length >= 2,
    watchReason: (c) => [
      ...Object.entries(c.conflicts).filter(([, x]) => x.count > 0).map(([name, x]) => `${name}: ${x.count} report${x.count === 1 ? '' : 's'}`),
      moveInDirection('^VIX', 'up'), moveInDirection('GC=F', 'up'), moveInDirection('^GSPC', 'down'),
    ].filter(Boolean).join(' · '),
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
    watch: (c) => c.outbreakCandidates.length > 0 || c.diseaseNews >= 2 || Boolean(moveInDirection('DAL', 'down')),
    watchReason: (c) => [
      c.outbreakCandidates.length ? `${c.outbreakCandidates.length} topic-matched outbreak reports · ${c.outbreaks.length} severe` : '',
      c.diseaseNews ? `${c.diseaseNews} disease headlines` : '',
      moveInDirection('DAL', 'down'),
    ].filter(Boolean).join(' · '),
  },
  {
    id: 'defense-escalation',
    title: 'DEFENSE & SECURITY BID',
    summary: 'Conflict signals in multiple theaters coincide with rising defense names; this is a risk signal, not proof of causation.',
    minScore: 5,
    effects: [
      { symbol: 'RTX', dir: 'up' }, { symbol: 'LMT', dir: 'up' }, { symbol: '^VIX', dir: 'up' },
      { symbol: 'GC=F', dir: 'up' },
    ],
    requires: [
      { label: 'Conflict activity rising in at least two theaters', weight: 2, test: (c) => Object.values(c.conflicts).filter((x) => x.rising && (x.weight || 0) >= 3).length >= 2 && 'Reported activity increased in at least two theaters' },
      { label: 'High-severity conflict reports in at least two theaters', weight: 1, test: (c) => Object.values(c.conflicts).filter((x) => (x.weight || 0) >= 3).length >= 2 && 'Severity-weighted conflict reports in at least two theaters' },
      { label: 'Defense names bid', weight: 2, test: () => {
        const rtx = moveInDirection('RTX', 'up');
        const lmt = moveInDirection('LMT', 'up');
        return rtx || lmt ? [rtx, lmt].filter(Boolean).join(' · ') : null;
      } },
      { label: 'Volatility or gold up', weight: 1, test: () => moveInDirection('^VIX', 'up') || moveInDirection('GC=F', 'up') },
    ],
    watch: (c) => Object.values(c.conflicts).some((x) => x.count > 0)
      || Boolean(moveInDirection('RTX', 'up')) || Boolean(moveInDirection('LMT', 'up')),
    watchReason: (c) => [
      ...Object.entries(c.conflicts).filter(([, x]) => x.count > 0).map(([name, x]) => `${name}: ${x.count} report${x.count === 1 ? '' : 's'}`),
      moveInDirection('RTX', 'up'), moveInDirection('LMT', 'up'), moveInDirection('^VIX', 'up'),
    ].filter(Boolean).join(' · '),
    gate: (c) => Object.values(c.conflicts).some((x) => x.rising && x.count)
      && (Boolean(moveInDirection('RTX', 'up')) || Boolean(moveInDirection('LMT', 'up')) || Boolean(moveInDirection('^VIX', 'up'))),
  },
  {
    id: 'food-security-risk',
    title: 'FOOD & GRAIN SECURITY',
    summary: 'Grain-corridor disruption or Russia/Ukraine conflict signals coincide with rising wheat; this is a risk signal, not proof of causation.',
    minScore: 5,
    effects: [
      { symbol: 'ZW=F', dir: 'up' }, { symbol: 'BZ=F', dir: 'up' }, { symbol: 'GC=F', dir: 'up' },
      { symbol: '^GSPC', dir: 'down' },
    ],
    requires: [
      { label: 'Russia / Ukraine conflict reports', weight: 2, test: (c) => ((c.conflicts['Russia / Ukraine']?.weight || 0) >= 3 && c.conflicts['Russia / Ukraine'].detail) || null },
      { label: 'Black Sea grain corridor disruption', weight: 2, test: (c) => {
        const choke = (c.chokepoints || []).find((x) => x.id === 'blacksea');
        return choke && (choke.weight || 0) >= 2 ? choke.signals.join(' · ') : null;
      } },
      { label: 'Wheat up', weight: 2, test: () => moveInDirection('ZW=F', 'up') },
      { label: 'Hedge demand up', weight: 1, test: () => moveInDirection('GC=F', 'up') },
    ],
    watch: (c) => Boolean(c.conflicts['Russia / Ukraine']?.count)
      || Boolean((c.chokepoints || []).find((x) => x.id === 'blacksea' && x.signals.length))
      || Boolean(moveInDirection('ZW=F', 'up')),
    watchReason: (c) => [
      c.conflicts['Russia / Ukraine'] ? `Ukraine/Russia: ${c.conflicts['Russia / Ukraine'].count} report${c.conflicts['Russia / Ukraine'].count === 1 ? '' : 's'}` : '',
      (c.chokepoints || []).find((x) => x.id === 'blacksea')?.signals?.length ? 'Black Sea route signal' : '',
      moveInDirection('ZW=F', 'up'),
    ].filter(Boolean).join(' · '),
    gate: (c) => Boolean(c.conflicts['Russia / Ukraine']?.count || c.conflicts['Russia / Ukraine']?.rising)
      && (Boolean((c.chokepoints || []).find((x) => x.id === 'blacksea' && x.signals.length)) || Boolean(moveInDirection('ZW=F', 'up'))),
  },
  {
    id: 'critical-infrastructure',
    title: 'CRITICAL INFRASTRUCTURE DISRUPTION',
    summary: 'Internet outages in producer or chokepoint regions coincide with route signals or energy moves; this is a risk signal, not proof of causation.',
    minScore: 6,
    effects: [
      { symbol: 'BZ=F', dir: 'up' }, { symbol: 'CL=F', dir: 'up' }, { symbol: 'GC=F', dir: 'up' },
    ],
    requires: [
      { label: 'Producer or regional internet outage', weight: 2, test: (c) => c.outages.length ? c.outages.map((o) => o.text).join(' · ') : null },
      { label: 'Corroborated route disruption', weight: 2, test: (c) => {
        const signals = (c.chokepoints || []).filter((x) => (x.weight || 0) >= 2).flatMap((x) => x.signals || []);
        return signals.length ? signals.slice(0, 3).join(' · ') : null;
      } },
      { label: 'Energy market moving up', weight: 3, test: () => {
        const moves = ['BZ=F', 'CL=F', 'HO=F'].map((symbol) => moveInDirection(symbol, 'up')).filter(Boolean);
        return moves.length >= 1 ? moves.slice(0, 3).join(' · ') : null;
      } },
      { label: 'Hedge demand up', weight: 1, test: () => moveInDirection('GC=F', 'up') },
    ],
    watch: (c) => c.outages.length > 0 || (c.chokepoints || []).some((x) => x.signals.length),
    watchReason: (c) => [
      c.outages.length ? `${c.outages.length} outage${c.outages.length === 1 ? '' : 's'}` : '',
      (c.chokepoints || []).some((x) => x.signals.length) ? 'Route signal' : '',
      moveInDirection('BZ=F', 'up'), moveInDirection('CL=F', 'up'),
    ].filter(Boolean).join(' · '),
    gate: (c) => c.outages.length > 0
      && (Boolean((c.chokepoints || []).some((x) => x.signals.length)) || ['BZ=F', 'CL=F'].some((symbol) => moveInDirection(symbol, 'up'))),
  },
  {
    id: 'airspace-navigation-risk',
    title: 'AIRSPACE & NAVIGATION RISK',
    summary: 'Navigation interference in contested airspace coincides with conflict and defense or travel market moves; this is a risk signal, not proof of causation.',
    minScore: 5,
    effects: [
      { symbol: 'RTX', dir: 'up' }, { symbol: 'LMT', dir: 'up' }, { symbol: 'DAL', dir: 'down' },
      { symbol: '^VIX', dir: 'up' },
    ],
    requires: [
      { label: 'Navigation interference nearby', weight: 2, test: (c) => (c.chokepoints || []).some((choke) => (choke.context || []).some((note) => /GPSJam/i.test(note)))
        ? 'Navigation interference reported in a monitored area' : null },
      { label: 'Conflict reports present', weight: 2, test: (c) => Object.values(c.conflicts).some((x) => (x.weight || 0) >= 2) && 'Reported conflict activity present' },
      { label: 'Defense bid or airline selling off', weight: 2, test: () => {
        const rtx = moveInDirection('RTX', 'up');
        const lmt = moveInDirection('LMT', 'up');
        const dal = moveInDirection('DAL', 'down');
        return rtx || lmt || dal ? [rtx, lmt, dal].filter(Boolean).join(' · ') : null;
      } },
      { label: 'Volatility up', weight: 1, test: () => moveInDirection('^VIX', 'up') },
    ],
    watch: (c) => (c.chokepoints || []).some((choke) => (choke.context || []).some((note) => /GPSJam/i.test(note)))
      || Object.values(c.conflicts).some((x) => x.count > 0),
    watchReason: (c) => [
      (c.chokepoints || []).some((choke) => (choke.context || []).some((note) => /GPSJam/i.test(note))) ? 'Navigation interference' : '',
      ...Object.entries(c.conflicts).filter(([, x]) => x.count > 0).slice(0, 1).map(([name, x]) => `${name}: ${x.count}`),
      moveInDirection('RTX', 'up'), moveInDirection('DAL', 'down'),
    ].filter(Boolean).join(' · '),
    gate: (c) => (c.chokepoints || []).some((choke) => (choke.context || []).some((note) => /GPSJam/i.test(note)))
      && Object.values(c.conflicts).some((x) => x.count > 0),
  },
  {
    id: 'volatility-panic',
    title: 'VOLATILITY PANIC',
    summary: 'Extreme volatility with safe-haven demand and falling equities; this is a risk signal, not proof of causation.',
    minScore: 5,
    effects: [
      { symbol: '^VIX', dir: 'up' }, { symbol: 'GC=F', dir: 'up' }, { symbol: 'SI=F', dir: 'up' },
      { symbol: '^GSPC', dir: 'down' },
    ],
    requires: [
      { label: 'Volatility spiking', weight: 2, test: () => moveWeight('^VIX', 'up') >= 2 ? moveInDirection('^VIX', 'up') : null },
      { label: 'Gold and silver up', weight: 2, test: () => (moveInDirection('GC=F', 'up') && moveInDirection('SI=F', 'up')) ? `${moveInDirection('GC=F', 'up')} · ${moveInDirection('SI=F', 'up')}` : null },
      { label: 'Equities down', weight: 2, test: () => moveWeight('^GSPC', 'down') >= 2 ? moveInDirection('^GSPC', 'down') : null },
      { label: 'Conflict activity present', weight: 1, test: (c) => Object.values(c.conflicts).some((x) => (x.weight || 0) >= 2) && 'Reported conflict activity present' },
    ],
    watch: () => Boolean(moveInDirection('^VIX', 'up')) || Boolean(moveInDirection('GC=F', 'up')),
    watchReason: () => [
      moveInDirection('^VIX', 'up'), moveInDirection('GC=F', 'up'), moveInDirection('^GSPC', 'down'),
    ].filter(Boolean).join(' · '),
    gate: () => Boolean(moveInDirection('^VIX', 'up')) && Boolean(moveInDirection('^GSPC', 'down')),
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
  const chokepoints = chokepointSignals(headlineRows);

  const ctx = {
    conflicts: {},
    chokepoints,
    outbreakCandidates: (!state.diseaseOutbreaksStale
      && Number.isFinite(state.diseaseOutbreaksUpdatedAt)
      && Date.now() - state.diseaseOutbreaksUpdatedAt <= SIGNAL_MAX_AGE_MS
      ? state.diseaseOutbreaks || [] : [])
      .filter(matchesSelectedTopics),
    outbreaks: [],
    diseaseNews: new Set(headlineRows.filter((x) => DISEASE_TERMS.test(x.title || '')).map((x) => x.url || x.title)).size,
  };
  ctx.outbreaks = ctx.outbreakCandidates
      .filter((x) => /^(high|severe|emergency|(?:who\s+)?grade\s*[34])\b/i.test(String(x.alertLevel || '').trim()))
      .slice(0, 2)
      .map((x) => `${x.disease || 'Outbreak'} alert · ${x.location || x.countryCode || ''}`.trim());

  const fired = [];
  const diagnostics = [];
  for (const theater of Object.values(THEATERS)) {
    ctx.conflicts[theater.label] = conflictSignals(reportRows, theater);
    ctx.news = newsSignals(headlineRows, theater);
    ctx.outages = outageSignals(theater.producers);
    const choke = chokepoints.find((x) => x.id === theater.choke);
    const context = { ...ctx, conflict: ctx.conflicts[theater.label], choke };
    fired.push(...runRule({
      id: `theater-${theater.choke}`,
      title: theater.rule.title,
      summary: theater.rule.summary,
      gateDescription: 'At least 2 conflict reports or 4+ theater headlines, at least 2 above the prior 15m; and route evidence or a producer-region outage.',
      gateChecks: theaterGateChecks,
      effects: theater.rule.effects,
      minScore: theater.rule.minScore,
      gate: (c) => (c.conflict.weight >= 3 || (c.news.hits >= 4 && c.news.rising))
        && (c.choke.signals.length > 0 || c.outages.length > 0),
      requires: theaterRequires(theater, choke),
      watch: (c) => c.conflict.count > 0 || c.news.hits >= 2 || c.choke.signals.length > 0 || c.choke.observations.length > 0 || c.outages.length > 0,
      watchReason: theaterWatchReason,
    }, context, diagnostics));
  }
  ctx.outages = outageSignals();
  fired.push(...runRule(RULES.find((r) => r.id === 'risk-off'), ctx, diagnostics));
  fired.push(...runRule(RULES.find((r) => r.id === 'outbreak-travel'), ctx, diagnostics));
  for (const id of ['defense-escalation', 'food-security-risk', 'critical-infrastructure', 'airspace-navigation-risk', 'volatility-panic']) {
    fired.push(...runRule(RULES.find((r) => r.id === id), ctx, diagnostics));
  }
  state.deductionDiagnostics = {
    evaluatedAt: Date.now(),
    selectedTopics: String(state.alertSettings.keywords || '').split(',').map((term) => term.trim()).filter(Boolean),
    inputs: inputVisibility(),
    rules: diagnostics,
  };
  emit('deduction:updated', state.deductionDiagnostics);
  commitDeductions(fired, notify);
}
function runRule(rule, ctx, diagnostics = null) {
  if (!rule) return [];
  let gatePassed;
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
      causes.push({ source: requirement.label, detail, weight: requirement.weight });
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
  const fired = gatePassed && score >= rule.minScore;
  // Evaluate the watch signal even when the rule has already fired. A fired
  // rule is the most interesting thing in the watch list, and the reason text
  // explains which evidence carried it there.
  let watchReason = '';
  if (rule.watch) {
    try { watchReason = rule.watch(ctx) ? String(rule.watchReason?.(ctx) || 'Relevant partial evidence') : ''; } catch { watchReason = ''; }
  }
  const status = fired ? 'FIRED' : watchReason ? 'WATCH' : !gatePassed ? 'GATE CLOSED' : 'BELOW THRESHOLD';
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
    watchReason,
    requirements,
    effects: effects.map((effect, index) => ({ ...effect, dir: rule.effects[index].dir })),
  });
  if (!fired) return [];
  return [{
    fingerprint: rule.id,
    rule: rule.id,
    title: rule.title,
    summary: rule.summary,
    causes,
    effects,
    evidenceCoveragePct: Math.round(100 * score / Math.max(1, maxScore)),
    score,
    maxScore,
    minScore: rule.minScore,
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
      existing.score = candidate.score;
      existing.maxScore = candidate.maxScore;
      existing.minScore = candidate.minScore;
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

/**
 * Collapse a noisy evidence phrase into something a person can scan.
 *
 * Raw detail strings join several independent observations with " · ", so
 * four of them flattened into one alert line produced a single unreadable
 * run-on. Keep the parts that carry a number or a named alert and drop the
 * rest, so the reader sees the evidence that decided the outcome.
 */
function conciseEvidence(text, limit = 96) {
  const parts = String(text || '')
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
  const scored = parts.filter((part) => /\d/.test(part) || /\b(RED|ORANGE|disrupted|congestion)\b/i.test(part));
  const keep = scored.length ? scored : parts;
  const joined = keep.slice(0, 3).join(' · ');
  return joined.length > limit ? `${joined.slice(0, limit - 1)}…` : joined;
}

/**
 * The exact alert text a deduction hands back to the activity list.
 *
 * Split out of emitNotification so an export can quote the alert verbatim
 * rather than re-deriving wording that would quietly drift from what the page
 * shows.
 *
 * @param {object} deduction - entry from state.deductions
 * @returns {{title: string, body: string}} notification title and body
 */
function deductionNotificationText(deduction) {
  const causes = [...new Set(
    (deduction.causes || [])
    .map((x) => conciseEvidence(x.detail || x.source))
    .filter(Boolean),
  )].slice(0, 3);
  const effects = (deduction.effects || [])
    .filter((x) => x.observed)
    .slice(0, 3)
    .map((x) => x.observed);
  // Weighted evidence points against the rule's threshold, not a confidence
  // level: a percentage here implied a certainty the number cannot support,
  // and its floor varies with each rule's checklist size.
  const score = Number.isFinite(deduction.score) ? deduction.score : null;
  const maxScore = Number.isFinite(deduction.maxScore) ? deduction.maxScore : null;
  const minScore = Number.isFinite(deduction.minScore) ? deduction.minScore : null;
  const tally = score !== null && maxScore
    ? `SCORE ${score}/${maxScore}${minScore !== null ? ` · FIRES AT ${minScore}` : ''}`
    : '';
  const head = [deduction.title, tally].filter(Boolean).join(' · ');
  const lines = [
    ...causes.map((cause) => `• ${cause}`),
    ...(effects.length ? [`→ Seen: ${effects.join(' · ')}`] : []),
  ];
  return { title: `DEDUCTION · ${head}`, body: lines.join('\n') };
}

function emitNotification(deduction, notify) {
  if (!notify) return;
  const { title, body } = deductionNotificationText(deduction);
  notify(title, body, '');
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
  deductionNotificationText,
};
