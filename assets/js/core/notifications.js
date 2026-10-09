import { $, esc, safeExternalUrl } from './dom.js';
import { state } from './state.js';
import { evaluateDeductions } from './deduction.js';

const STORAGE_KEY = 'rialto_alert_settings_v1';
let initialized = false;
let alertSound;
const HEADLINE_STOP_WORDS = new Set('a an and are as at be by for from has have in into is it its of on or our over says said the their this to up was were will with after amid new first more near'.split(' '));
const DEDUCTION_STOP_WORDS = new Set([...HEADLINE_STOP_WORDS, 'event', 'report', 'reports', 'news', 'latest', 'update', 'updates', 'world', 'global', 'breaking', 'source', 'public', 'official', 'according', 'people', 'country', 'government', 'officials', 'should', 'would', 'could', 'your', 'you', 'how', 'soon']);
const fingerprintOf = (title, detail) => `${title}|${detail}`
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.alertSettings));
}

function addNotification(title, detail, link = '') {
  // Same title+detail arriving through several feed pipelines is one alert.
  const fingerprint = fingerprintOf(title, detail);
  if (state.alertBaselines.seenAlerts.includes(fingerprint)) return;
  state.alertBaselines.seenAlerts.push(fingerprint);
  state.alertBaselines.seenAlerts = state.alertBaselines.seenAlerts.slice(-300);
  const safeLink = safeExternalUrl(link);
  const item = { id: `${Date.now()}-${Math.random()}`, title, detail, link: safeLink, at: Date.now() };
  // Drop an identical copy already sitting in the activity list (e.g. cleared
  // baselines re-observing the same event within one refresh cycle).
  state.notifications = state.notifications.filter((x) => fingerprintOf(x.title, x.detail) !== fingerprint);
  state.notifications.unshift(item);
  state.notifications = state.notifications.slice(0, 100);
  renderNotifications();
  playAlertSound();
  if (state.alertSettings.browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body: detail,
      icon: '/assets/favicon.svg',
    });
    notification.onclick = () => {
      window.focus();
      if (safeLink) window.open(safeLink, '_blank', 'noopener');
      notification.close();
    };
  }
}

function playAlertSound() {
  if (state.alertSettings.soundMuted) return;
  alertSound ||= new Audio('/assets/audio/alert-chime.ogg');
  alertSound.currentTime = 0;
  alertSound.play().catch(() => {});
}

function renderDeliveryControls() {
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#alertBrowserNotifications').checked = state.alertSettings.browserNotifications && permission === 'granted';
  $('#alertSoundMute').textContent = state.alertSettings.soundMuted ? 'SOUND MUTED' : 'SOUND ON';
  $('#alertSoundMute').setAttribute('aria-pressed', String(state.alertSettings.soundMuted));
  const status = permission === 'unsupported'
    ? 'Browser notifications are not supported here'
    : permission === 'denied'
      ? 'Browser permission is blocked · allow it in site settings'
      : permission === 'granted' && state.alertSettings.browserNotifications
        ? 'Browser notifications enabled'
        : 'Browser notifications off · sound starts muted';
  $('#alertDeliveryStatus').textContent = `${status} · ${state.alertSettings.soundMuted ? 'MUTED' : 'SOUND ON'}`;
}

function contentText(item, fields = ['title', 'headline', 'description', 'summary', 'text', 'content', 'properties', 'name', 'location', 'locationName', 'admin1', 'country', 'sideA', 'sideB', 'actors', 'themes', 'mentionedthemes', 'mentionednames', 'disease', 'severity', 'cause', 'outageType', 'dest', 'destination', 'callsign']) {
  const allowed = new Set(fields.map((field) => field.toLocaleLowerCase()));
  const values = [];
  const walk = (value, key = '') => {
    if (Array.isArray(value)) value.forEach((entry) => walk(entry, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
    else if (typeof value === 'string' && allowed.has(key.toLocaleLowerCase())) values.push(value);
  };
  walk(item);
  return values.join(' ').toLocaleLowerCase();
}

function matchesTopics(item) {
  const topics = state.alertSettings.keywords
    .split(',')
    .map((term) => term.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (!topics.length) return true;
  const text = contentText(item);
  return topics.some((topic) => text.includes(topic));
}

function observeNews(items) {
  const current = new Set(items.map((x) => x.url));
  if (!state.alertBaselines.news) {
    state.alertBaselines.news = [...current];
    return [];
  }
  const previous = state.alertBaselines.news;
  const newItems = items.filter((x) => !previous.includes(x.url));
  state.alertBaselines.news = [...current];
  if (!state.alertSettings.news) return newItems;
  newItems.filter(matchesTopics).slice(0, 5).forEach((x) => addNotification('NEW HEADLINE', x.title, x.url));
  return newItems;
}

function splitFilterTerms(terms) {
  const parsed = String(terms || '').split(',').map((value) => value.trim().toLocaleLowerCase()).filter(Boolean)
    .map((value) => ({ exclude: value.startsWith('!'), term: value.replace(/^!\s*/, '') }))
    .filter((item) => item.term);
  return { include: parsed.filter((item) => !item.exclude).map((item) => item.term), exclude: parsed.filter((item) => item.exclude).map((item) => item.term) };
}

function matchesTermList(text, terms) {
  const { include, exclude } = splitFilterTerms(terms);
  const normalized = String(text || '').toLocaleLowerCase();
  if (exclude.some((term) => normalized.includes(term))) return false;
  return !include.length || include.some((term) => normalized.includes(term));
}

function matchesTerms(item, terms, fields) {
  if (!String(terms || '').trim()) return true;
  return matchesTermList(contentText(item, fields), terms);
}

function matchesSquawk(squawk, terms) {
  if (!String(terms || '').trim()) return true;
  const { include, exclude } = splitFilterTerms(terms);
  const code = String(squawk || '').trim().toLocaleLowerCase();
  if (exclude.includes(code)) return false;
  return !include.length || include.includes(code);
}

function itemId(item, fallback) {
  const properties = item.properties || {};
  return String(item.id || properties.event_id || item.url || properties.url || item.sourceUrl || `${item.date || properties.event_date || item.published || item.occurredAt || ''}-${item.name || properties.name || item.title || item.location || item.country || fallback}`);
}

function termsFor(item) {
  const values = [];
  const metadata = new Set(['category', 'source', 'domain', 'region', 'language', 'countrycode', 'timetype', 'url', 'sourceurl', 'published', 'date', 'id']);
  const walk = (value, key = '') => {
    if (metadata.has(key.toLocaleLowerCase())) return;
    if (Array.isArray(value)) value.forEach((entry) => walk(entry));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
    else if (typeof value === 'string') values.push(value);
  };
  walk(item);
  const text = values.join(' ').toLocaleLowerCase();
  return new Set((text.match(/[\p{L}\p{N}]{4,}/gu) || []).filter((term) => !DEDUCTION_STOP_WORDS.has(term)));
}

function recent(item) {
  const properties = item.properties || {};
  const raw = item.published || item.occurredAt || item.dateStart || item.detectedAt || item.publishedAt || item.date || properties.event_date || '';
  const timestamp = Date.parse(String(raw));
  return Number.isNaN(timestamp) ? true : Date.now() - timestamp <= 86400000;
}

function correlate(sourceName, item, targetName, targetItems, title) {
  if (!item || !recent(item) || !matchesTopics(item)) return;
  const sourceTerms = termsFor(item);
  if (sourceTerms.size === 0) return;
  const match = targetItems.find((target) => {
    if (!recent(target) || !matchesTopics(target)) return false;
    if ([sourceName, targetName].includes('conflict') && [sourceName, targetName].includes('news')) {
      const headline = sourceName === 'news' ? item : target;
      const subject = `${headline.category || ''} ${headline.title || ''} ${headline.description || ''}`;
      if (!/\b(conflict|war|armed|troops|military|airstrike|missile|invasion|ceasefire|shelling|battle|attack|strike|bombing|drone strike)\b/i.test(subject)) return false;
    }
    const overlap = [...sourceTerms].filter((term) => termsFor(target).has(term));
    // Two shared terms distinguish a real link from a stop-word-shaped one.
    return overlap.length >= 2;
  });
  if (!match) return;
  // The pair is stored unordered: the same event seen news→market and
  // market→news must produce one signal, not two.
  const key = [[`${sourceName}:${itemId(item, sourceName)}`, `${targetName}:${itemId(match, targetName)}`]
    .sort().join('|')].join('');
  if (state.alertBaselines.deductions.includes(key)) return;
  state.alertBaselines.deductions.push(key);
  state.alertBaselines.deductions = state.alertBaselines.deductions.slice(-200);
  const headline = sourceName === 'news' ? item.title : targetName === 'news' ? match.title : '';
  const detail = [...new Set([headline, item.name, item.title, item.location, item.country, match.title, match.name].filter(Boolean))].slice(0, 3).join(' · ');
  if (headline) {
    const signalKey = `news-signal:${fingerprintOf(headline, '')}`;
    const matchingSignals = state.notifications.filter((notification) =>
      notification.title.includes('NEWS SIGNAL')
      && fingerprintOf(notification.detail, '').includes(fingerprintOf(headline, '')));
    if (state.alertBaselines.seenAlerts.includes(signalKey) || matchingSignals.length) {
      state.alertBaselines.seenAlerts.push(signalKey);
      state.alertBaselines.seenAlerts = state.alertBaselines.seenAlerts.slice(-300);
      // Clean up duplicates created by earlier feed refreshes while retaining
      // the first signal and its source label.
      state.notifications = state.notifications.filter((notification) =>
        !matchingSignals.includes(notification) || notification === matchingSignals[0]);
      renderNotifications();
      return;
    }
    state.alertBaselines.seenAlerts.push(signalKey);
    state.alertBaselines.seenAlerts = state.alertBaselines.seenAlerts.slice(-300);
  }
  addNotification(title, detail || 'Related signals detected');
}

function observeDerivedSignals(source, items) {
  if (!items?.length) return;
  const settings = state.alertSettings;
  items.slice(0, 5).forEach((item) => {
    if (source === 'news') {
      if (settings.news && settings.conflict) correlate('news', item, 'conflict', state.warReports, 'CONFLICT + NEWS SIGNAL');
      if (settings.news && settings.conflict) correlate('news', item, 'outage', state.warWorldMonitor?.outages || [], 'OUTAGE + NEWS SIGNAL');
      if (settings.news && settings.diseaseOutbreaks) correlate('news', item, 'disease', state.diseaseOutbreaks, 'OUTBREAK + NEWS SIGNAL');
      if (settings.news && settings.markets) correlate('news', item, 'market', state.market, 'MARKET + NEWS SIGNAL');
    } else if (source === 'conflict' && settings.news && settings.conflict) {
      correlate('conflict', item, 'news', state.news, 'CONFLICT + NEWS SIGNAL');
    } else if (source === 'outage' && settings.news && settings.conflict) {
      correlate('outage', item, 'news', state.news, 'OUTAGE + NEWS SIGNAL');
    } else if (source === 'disease' && settings.news && settings.diseaseOutbreaks) {
      correlate('disease', item, 'news', state.news, 'OUTBREAK + NEWS SIGNAL');
    } else if (source === 'market' && settings.news && settings.markets) {
      correlate('market', item, 'news', state.news, 'MARKET + NEWS SIGNAL');
    } else if (source === 'vessels' && settings.news && settings.vessels) {
      correlate('vessel', item, 'news', state.news, 'VESSEL + NEWS SIGNAL');
    } else if (source === 'aircraft' && settings.news && settings.aircraft) {
      correlate('aircraft', item, 'news', state.news, 'AIRCRAFT + NEWS SIGNAL');
    }
  });
  // Every feed refresh is a fresh chance to corroborate cause→effect rules.
  evaluateDeductions(addNotification);
}

function observeConflict(reports) {
  const ids = reports.map((x) => x.id || x.url || `${x.date}-${x.name}`);
  if (!state.alertBaselines.conflict) {
    state.alertBaselines.conflict = ids;
    return [];
  }
  const newReports = reports.filter((x) => !state.alertBaselines.conflict.includes(x.id || x.url || `${x.date}-${x.name}`));
  if (state.alertSettings.conflict) {
    newReports
      .filter((x) => matchesTerms(x, state.alertSettings.conflictTerms, ['properties', 'title', 'headline', 'description', 'summary', 'name', 'location', 'names', 'themes', 'mentionednames', 'mentionedthemes', 'actors', 'country', 'admin1', 'sideA', 'sideB']))
      .filter(matchesTopics)
      .slice(0, 5).forEach((x) => addNotification('NEW CONFLICT REPORT', `${x.name || x.location || 'Reported event'} · ${x.date || ''}`, x.url || ''));
  }
  state.alertBaselines.conflict = ids;
  return newReports;
}

function observeWorldMonitor(layers) {
  const events = [
    ...(layers.armed || []).map((item) => ({ ...item, alertKind: 'ARMED CONFLICT EVENT' })),
    ...(layers.outages || []).map((item) => ({ ...item, alertKind: 'INTERNET DISRUPTION' })),
  ];
  const idFor = (item) => `${item.alertKind}:${item.id || item.url || item.sourceUrl || `${item.dateStart || item.occurredAt}-${item.locationName || item.title || item.country}`}`;
  const previous = state.alertBaselines.worldMonitor;
  const current = events.map(idFor);
  if (!previous) {
    state.alertBaselines.worldMonitor = current;
    return [];
  }
  const newEvents = events.filter((item) => !previous.includes(idFor(item)));
  if (state.alertSettings.conflict) {
    newEvents
      .filter((item) => matchesTerms(item, state.alertSettings.conflictTerms, ['properties', 'title', 'headline', 'description', 'summary', 'name', 'locationName', 'location', 'names', 'themes', 'actors', 'country', 'admin1', 'sideA', 'sideB', 'severity']))
      .filter(matchesTopics)
      .slice(0, 5)
      .forEach((item) => {
        const title = item.alertKind;
        const detail = [item.locationName, item.admin1, item.country, item.title, item.provider, item.severity, item.sideA, item.sideB]
          .filter(Boolean).join(' · ') || 'New World Monitor report';
        const link = [item.url, item.sourceUrl].find((value) => typeof value === 'string' && value.startsWith('https://')) || '';
        addNotification(title, detail, link);
      });
  }
  state.alertBaselines.worldMonitor = current;
  return newEvents;
}

function observeDiseaseOutbreaks(outbreaks) {
  const idFor = (item) => String(item.id || item.sourceUrl || `${item.disease}-${item.countryCode}-${item.publishedAt}`);
  const previous = state.alertBaselines.diseaseOutbreaks;
  const current = outbreaks.map(idFor);
  if (!previous) {
    state.alertBaselines.diseaseOutbreaks = current;
    return [];
  }
  const newOutbreaks = outbreaks.filter((item) => !previous.includes(idFor(item)));
  if (state.alertSettings.diseaseOutbreaks) {
    newOutbreaks.filter(matchesTopics).slice(0, 5).forEach((item) => {
      const title = [item.disease, item.location].filter(Boolean).join(' · ') || 'Disease outbreak';
      const detail = [item.alertLevel, item.sourceName, item.countryCode].filter(Boolean).join(' · ');
      const link = typeof item.sourceUrl === 'string' && item.sourceUrl.startsWith('https://') ? item.sourceUrl : '';
      addNotification('NEW DISEASE OUTBREAK', detail ? `${title} · ${detail}` : title, link);
    });
  }
  state.alertBaselines.diseaseOutbreaks = current;
  return newOutbreaks;
}

function observeMarkets(items) {
  const available = items.filter((x) => !x.stale && x.pct != null && x.pct !== '' && Number.isFinite(Number(x.pct)));
  const snapshot = Object.fromEntries(available.map((x) => [x.symbol, Number(x.pct)]));
  if (!state.alertBaselines.markets) {
    state.alertBaselines.markets = Object.keys(snapshot).length ? snapshot : null;
    return [];
  }
  const threshold = Number(state.alertSettings.marketMovePct) || 2;
  const changed = available.filter((x) => Object.hasOwn(state.alertBaselines.markets, x.symbol)
    && Math.abs(Number(x.pct)) >= threshold
    && Math.abs(Number(x.pct) - Number(state.alertBaselines.markets[x.symbol] || 0)) >= 0.25);
  if (state.alertSettings.markets) {
    changed
      .filter(matchesTopics)
      .slice(0, 5).forEach((x) => addNotification('MARKET MOVE', `${x.name} ${Number(x.pct) >= 0 ? '+' : ''}${Number(x.pct).toFixed(2)}%`));
  }
  state.alertBaselines.markets = { ...state.alertBaselines.markets, ...snapshot };
  return changed;
}

function observeTracks(kind, items) {
  const key = kind === 'vessels' ? 'vessels' : 'aircraft';
  const previous = state.alertBaselines[key];
  const current = items.map((x) => String(x.id));
  if (!previous) { state.alertBaselines[key] = current; return []; }
  const newItems = items.filter((x) => !previous.includes(String(x.id)));
  state.alertBaselines[key] = current;
  if (!state.alertSettings[key]) return;
  const terms = state.alertSettings[kind === 'vessels' ? 'vesselTerms' : 'aircraftTerms'];
  const minimum = Number(state.alertSettings[kind === 'vessels' ? 'vesselMinSpeed' : 'aircraftMinAltitude']) || 0;
  newItems
    .filter((x) => matchesTerms(x, terms, kind === 'vessels' ? ['name', 'dest', 'destination'] : ['callsign', 'id']))
    .filter(matchesTopics)
    .filter((x) => kind !== 'aircraft' || matchesSquawk(x.squawk, state.alertSettings.aircraftExcludedSquawks))
    .filter((x) => (kind === 'vessels' ? Number(x.speed) : Number(x.alt)) >= minimum)
    .slice(0, 5).forEach((x) => addNotification(kind === 'vessels' ? 'VESSEL DETECTED' : 'AIRCRAFT DETECTED', `${x.name || x.id}${kind === 'vessels' && x.dest ? ` · ${x.dest}` : kind === 'aircraft' && x.squawk ? ` · SQUAWK ${x.squawk}` : ''}`));
  return newItems;
}

function observeVessels(items) { return observeTracks('vessels', items); }
function observeAircraft(items) { return observeTracks('aircraft', items); }

function renderNotifications() {
  const list = $('#notificationList');
  if (list) list.innerHTML = state.notifications.length
    ? state.notifications.map((x) => `<div class="notification-item"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">OPEN ↗</a>` : ''}<button type="button" data-remove-notification="${esc(x.id)}" aria-label="Remove alert">×</button></div>`).join('')
    : '<div class="notification-empty">NO ALERTS YET</div>';
  const count = $('#notificationCount');
  if (count) count.textContent = String(state.notifications.length);
  const recent = $('#alertRecentCount');
  if (recent) recent.textContent = `${state.notifications.length} RECENT`;
}

function renderAlertSettings() {
  $('#alertNews').checked = state.alertSettings.news;
  $('#alertConflict').checked = state.alertSettings.conflict;
  $('#alertDiseaseOutbreaks').checked = state.alertSettings.diseaseOutbreaks;
  $('#alertMarkets').checked = state.alertSettings.markets;
  $('#alertVessels').checked = state.alertSettings.vessels;
  $('#alertAircraft').checked = state.alertSettings.aircraft;
  $('#alertMove').value = state.alertSettings.marketMovePct;
  $('#alertConflictTerms').value = state.alertSettings.conflictTerms;
  $('#alertVesselTerms').value = state.alertSettings.vesselTerms;
  $('#alertVesselSpeed').value = state.alertSettings.vesselMinSpeed;
  $('#alertAircraftTerms').value = state.alertSettings.aircraftTerms;
  $('#alertAircraftSquawks').value = state.alertSettings.aircraftExcludedSquawks || '';
  $('#alertAircraftAltitude').value = state.alertSettings.aircraftMinAltitude;
  renderDeliveryControls();
  const chips = $('#alertKeywordChips');
  const terms = state.alertSettings.keywords.split(',').map((term) => term.trim()).filter(Boolean);
  chips.innerHTML = terms.length
    ? terms.map((term, index) => `<span class="alert-keyword-chip">${esc(term)}<button type="button" data-remove-keyword="${index}" aria-label="Remove ${esc(term)}">×</button></span>`).join('')
    : '<span class="alert-terms-empty">No headline terms selected. All new headlines will match.</span>';
}

function headlineTermSuggestions(query) {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const counts = new Map();
  const isTerm = (value) => {
    const enumValue = value.includes('_') && value === value.toUpperCase();
    const normalized = value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const term = enumValue
      ? normalized.toLocaleLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
      : normalized;
    const words = term.split(' ');
    if (term.length < 3 || words[0].length < 2 || HEADLINE_STOP_WORDS.has(words[0].toLowerCase()) || HEADLINE_STOP_WORDS.has(words.at(-1).toLowerCase())) return null;
    return { key: term.toLocaleLowerCase(), term };
  };
  const addContext = (values) => {
    const recordTerms = new Map();
    const add = (value) => {
      const candidate = isTerm(value);
      if (candidate) recordTerms.set(candidate.key, candidate.term);
    };
    values.filter((value) => typeof value === 'string').forEach((value) => {
      add(value);
      const words = value.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
      for (let start = 0; start < words.length; start += 1) {
        for (let length = 1; length <= 3 && start + length <= words.length; length += 1) {
          add(words.slice(start, start + length).join(' '));
        }
      }
    });
    recordTerms.forEach((term, key) => {
      const prior = counts.get(key);
      counts.set(key, { term, count: (prior?.count || 0) + 1 });
    });
  };
  state.news.slice(0, 100).forEach((item) => {
    addContext([item.title, item.region, item.category]);
  });
  const worldMonitor = state.warWorldMonitor || {};
  (worldMonitor.armed || []).forEach((item) => {
    addContext([item.locationName, item.admin1, item.country, item.sideA, item.sideB, item.eventType, item.violenceType, ...(Array.isArray(item.actors) ? item.actors : [])]);
  });
  (worldMonitor.outages || []).forEach((item) => {
    addContext([item.title, item.country, item.region, item.provider, item.cause, item.outageType, item.severity]);
  });
  (state.diseaseOutbreaks || []).forEach((item) => {
    addContext([item.disease, item.location, item.countryCode, item.alertLevel]);
  });
  const selected = new Set(state.alertSettings.keywords.split(',').map((term) => term.trim().toLocaleLowerCase()).filter(Boolean));
  return [...counts.entries()]
    .filter(([key]) => !selected.has(key) && key.includes(needle))
    .sort((a, b) => Number(b[0].startsWith(needle)) - Number(a[0].startsWith(needle)) || b[1].count - a[1].count || a[1].term.length - b[1].term.length)
    .slice(0, 6)
    .map(([key, value]) => ({ key, ...value }));
}

function renderHeadlineTermSuggestions(query, activeIndex = -1) {
  const input = $('#alertKeywordAdd');
  const list = $('#alertKeywordSuggestions');
  const suggestions = headlineTermSuggestions(query);
  list.innerHTML = suggestions.map((suggestion, index) => `<button type="button" role="option" aria-selected="${index === activeIndex}" id="headline-term-option-${index}" data-headline-term="${esc(suggestion.term)}"><span class="suggestion-term">${esc(suggestion.term)}</span><span class="suggestion-meta"><small>${suggestion.count} ${suggestion.count === 1 ? 'match' : 'matches'}</small><b>ADD ↵</b></span></button>`).join('');
  list.hidden = !suggestions.length;
  input.setAttribute('aria-expanded', String(suggestions.length > 0));
  if (activeIndex >= 0 && suggestions[activeIndex]) input.setAttribute('aria-activedescendant', `headline-term-option-${activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
  return suggestions;
}

function initNotifications() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const hadFuelSettings = Object.prototype.hasOwnProperty.call(saved, 'fuelWatches') || Object.prototype.hasOwnProperty.call(saved, 'fuelMovePct');
    delete saved.fuelWatches;
    delete saved.fuelMovePct;
    state.alertSettings = { ...state.alertSettings, ...saved };
    if (hadFuelSettings) saveSettings();
  } catch { /* use defaults when storage is unavailable */ }
  renderNotifications();
}

function initAlertsPage() {
  renderAlertSettings();
  renderNotifications();
  ['alertNews', 'alertConflict', 'alertDiseaseOutbreaks', 'alertMarkets', 'alertVessels', 'alertAircraft'].forEach((id) => {
    $(`#${id}`).onchange = (e) => {
      state.alertSettings[{ alertNews: 'news', alertConflict: 'conflict', alertDiseaseOutbreaks: 'diseaseOutbreaks', alertMarkets: 'markets', alertVessels: 'vessels', alertAircraft: 'aircraft' }[id]] = e.target.checked;
      saveSettings();
    };
  });
  $('#alertBrowserNotifications').onchange = async (event) => {
    if (!event.target.checked) {
      state.alertSettings.browserNotifications = false;
      saveSettings();
      renderDeliveryControls();
      return;
    }
    try {
      if (!('Notification' in window)) {
        state.alertSettings.browserNotifications = false;
      } else {
        const permission = Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
        state.alertSettings.browserNotifications = permission === 'granted';
      }
    } catch {
      state.alertSettings.browserNotifications = false;
    }
    saveSettings();
    renderDeliveryControls();
  };
  $('#alertSoundMute').onclick = () => {
    state.alertSettings.soundMuted = !state.alertSettings.soundMuted;
    saveSettings();
    renderDeliveryControls();
  };
  $('#alertSoundTest').onclick = () => {
    if (state.alertSettings.soundMuted) {
      $('#alertDeliveryStatus').textContent = 'Unmute sound before testing';
      return;
    }
    playAlertSound();
  };
  $('#alertKeywordChips').onclick = (event) => {
    const button = event.target.closest('[data-remove-keyword]');
    if (!button) return;
    const terms = state.alertSettings.keywords.split(',').map((term) => term.trim()).filter(Boolean);
    terms.splice(Number(button.dataset.removeKeyword), 1);
    state.alertSettings.keywords = terms.join(', ');
    saveSettings();
    renderAlertSettings();
  };
  const input = $('#alertKeywordAdd');
  let activeSuggestion = -1;
  const hideSuggestions = () => {
    $('#alertKeywordSuggestions').hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
  };
  const addKeyword = (selectedTerm = '') => {
    const term = (selectedTerm || input.value).trim();
    if (!term) return;
    const terms = state.alertSettings.keywords.split(',').map((value) => value.trim()).filter(Boolean);
    if (!terms.some((value) => value.toLowerCase() === term.toLowerCase())) terms.push(term);
    state.alertSettings.keywords = terms.join(', ');
    saveSettings();
    input.value = '';
    hideSuggestions();
    renderAlertSettings();
    input.focus();
  };
  $('#addAlertKeyword').onclick = () => addKeyword();
  input.oninput = () => {
    activeSuggestion = -1;
    renderHeadlineTermSuggestions(input.value);
  };
  input.onblur = hideSuggestions;
  input.onkeydown = (event) => {
    const suggestions = headlineTermSuggestions(input.value);
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      activeSuggestion = (activeSuggestion + 1) % suggestions.length;
      renderHeadlineTermSuggestions(input.value, activeSuggestion);
      return;
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      activeSuggestion = activeSuggestion <= 0 ? suggestions.length - 1 : activeSuggestion - 1;
      renderHeadlineTermSuggestions(input.value, activeSuggestion);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      addKeyword(activeSuggestion >= 0 ? suggestions[activeSuggestion]?.term : '');
    } else if (event.key === 'Escape') {
      hideSuggestions();
    }
  };
  $('#alertKeywordSuggestions').onmousedown = (event) => event.preventDefault();
  $('#alertKeywordSuggestions').onclick = (event) => {
    const option = event.target.closest('[data-headline-term]');
    if (option) addKeyword(option.dataset.headlineTerm);
  };
  $('#alertMove').onchange = (e) => {
    state.alertSettings.marketMovePct = Math.max(0.1, Number(e.target.value) || 2);
    e.target.value = state.alertSettings.marketMovePct;
    saveSettings();
  };
  const fields = {
    alertConflictTerms: ['conflictTerms', null], alertVesselTerms: ['vesselTerms', null],
    alertVesselSpeed: ['vesselMinSpeed', 0], alertAircraftTerms: ['aircraftTerms', null],
    alertAircraftSquawks: ['aircraftExcludedSquawks', null],
    alertAircraftAltitude: ['aircraftMinAltitude', 0],
  };
  Object.entries(fields).forEach(([id, [key, minimum]]) => {
    $(`#${id}`).onchange = (event) => {
      state.alertSettings[key] = minimum === null ? event.target.value.trim() : Math.max(minimum, Number(event.target.value) || 0);
      event.target.value = state.alertSettings[key];
      saveSettings();
    };
  });
  $('#clearNotifications').onclick = () => {
    state.notifications = [];
    renderNotifications();
  };
  $('#notificationList').onclick = (event) => {
    const button = event.target.closest('[data-remove-notification]');
    if (!button) return;
    state.notifications = state.notifications.filter((item) => item.id !== button.dataset.removeNotification);
    renderNotifications();
  };
}

export {
  initNotifications,
  initAlertsPage,
  observeNews,
  observeConflict,
  observeWorldMonitor,
  observeDiseaseOutbreaks,
  observeMarkets,
  observeVessels,
  observeAircraft,
  observeDerivedSignals,
};
