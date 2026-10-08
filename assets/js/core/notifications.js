import { $, esc } from './dom.js';
import { state } from './state.js';

const STORAGE_KEY = 'rialto_alert_settings_v1';
let initialized = false;
const HEADLINE_STOP_WORDS = new Set('a an and are as at be by for from has have in into is it its of on or our over says said the their this to up was were will with after amid new first more near'.split(' '));

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.alertSettings));
}

function addNotification(title, detail, link = '') {
  state.notifications.unshift({ id: `${Date.now()}-${Math.random()}`, title, detail, link, at: Date.now() });
  state.notifications = state.notifications.slice(0, 100);
  renderNotifications();
}

function observeNews(items) {
  const current = new Set(items.map((x) => x.url));
  if (!state.alertBaselines.news) {
    state.alertBaselines.news = [...current];
    return;
  }
  const previous = state.alertBaselines.news;
  state.alertBaselines.news = [...current];
  if (!state.alertSettings.news) return;
  const keywords = state.alertSettings.keywords.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  items.filter((x) => !previous.includes(x.url)).filter((x) => {
    const text = `${x.title} ${x.region || ''} ${x.category || ''}`.toLowerCase();
    return !keywords.length || keywords.some((keyword) => text.includes(keyword));
  }).slice(0, 5).forEach((x) => addNotification('NEW HEADLINE', x.title, x.url));
}

function matchesTerms(item, terms) {
  const needles = String(terms || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return true;
  const text = Object.values(item).filter((x) => typeof x === 'string' || typeof x === 'number').join(' ').toLowerCase();
  return needles.some((term) => text.includes(term));
}

function observeConflict(reports) {
  const ids = reports.map((x) => x.id || x.url || `${x.date}-${x.name}`);
  if (!state.alertBaselines.conflict) {
    state.alertBaselines.conflict = ids;
    return;
  }
  if (state.alertSettings.conflict) {
    reports.filter((x) => !state.alertBaselines.conflict.includes(x.id || x.url || `${x.date}-${x.name}`))
      .filter((x) => matchesTerms(x, state.alertSettings.conflictTerms))
      .slice(0, 5).forEach((x) => addNotification('NEW CONFLICT REPORT', `${x.name || x.location || 'Reported event'} · ${x.date || ''}`, x.url || ''));
  }
  state.alertBaselines.conflict = ids;
}

function observeDiseaseOutbreaks(outbreaks) {
  const idFor = (item) => String(item.id || item.sourceUrl || `${item.disease}-${item.countryCode}-${item.publishedAt}`);
  const previous = state.alertBaselines.diseaseOutbreaks;
  const current = outbreaks.map(idFor);
  if (!previous) {
    state.alertBaselines.diseaseOutbreaks = current;
    return;
  }
  if (state.alertSettings.diseaseOutbreaks) {
    outbreaks.filter((item) => !previous.includes(idFor(item))).slice(0, 5).forEach((item) => {
      const title = [item.disease, item.location].filter(Boolean).join(' · ') || 'Disease outbreak';
      const detail = [item.alertLevel, item.sourceName, item.countryCode].filter(Boolean).join(' · ');
      const link = typeof item.sourceUrl === 'string' && item.sourceUrl.startsWith('https://') ? item.sourceUrl : '';
      addNotification('NEW DISEASE OUTBREAK', detail ? `${title} · ${detail}` : title, link);
    });
  }
  state.alertBaselines.diseaseOutbreaks = current;
}

function observeMarkets(items) {
  const snapshot = Object.fromEntries(items.map((x) => [x.symbol, Number(x.pct)]));
  if (!state.alertBaselines.markets) {
    state.alertBaselines.markets = snapshot;
    return;
  }
  if (state.alertSettings.markets) {
    const threshold = Number(state.alertSettings.marketMovePct) || 2;
    items.filter((x) => Math.abs(Number(x.pct)) >= threshold && Math.abs(Number(x.pct) - Number(state.alertBaselines.markets[x.symbol] || 0)) >= 0.25)
      .slice(0, 5).forEach((x) => addNotification('MARKET MOVE', `${x.name} ${Number(x.pct) >= 0 ? '+' : ''}${Number(x.pct).toFixed(2)}%`));
  }
  state.alertBaselines.markets = snapshot;
}

function observeTracks(kind, items) {
  const key = kind === 'vessels' ? 'vessels' : 'aircraft';
  const previous = state.alertBaselines[key];
  const current = items.map((x) => String(x.id));
  if (!previous) { state.alertBaselines[key] = current; return; }
  state.alertBaselines[key] = current;
  if (!state.alertSettings[key]) return;
  const terms = state.alertSettings[kind === 'vessels' ? 'vesselTerms' : 'aircraftTerms'];
  const minimum = Number(state.alertSettings[kind === 'vessels' ? 'vesselMinSpeed' : 'aircraftMinAltitude']) || 0;
  items.filter((x) => !previous.includes(String(x.id)))
    .filter((x) => matchesTerms(x, terms))
    .filter((x) => (kind === 'vessels' ? Number(x.speed) : Number(x.alt)) >= minimum)
    .slice(0, 5).forEach((x) => addNotification(kind === 'vessels' ? 'VESSEL DETECTED' : 'AIRCRAFT DETECTED', `${x.name || x.id}${kind === 'vessels' && x.dest ? ` · ${x.dest}` : ''}`));
}

function observeVessels(items) { observeTracks('vessels', items); }
function observeAircraft(items) { observeTracks('aircraft', items); }

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
  $('#alertAircraftAltitude').value = state.alertSettings.aircraftMinAltitude;
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

export { initNotifications, initAlertsPage, observeNews, observeConflict, observeDiseaseOutbreaks, observeMarkets, observeVessels, observeAircraft };
