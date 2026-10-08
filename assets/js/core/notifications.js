import { $, esc } from './dom.js';
import { state } from './state.js';

const STORAGE_KEY = 'rialto_alert_settings_v1';
const DEFAULT_KEYWORDS = 'Bulgaria, Balkans, Black Sea, Ukraine, Russia, NATO, EU, energy, gas, oil, Sofia';
let initialized = false;

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.alertSettings));
}

function addNotification(title, detail, link = '') {
  state.notifications.unshift({ id: `${Date.now()}-${Math.random()}`, title, detail, link, at: Date.now() });
  state.notifications = state.notifications.slice(0, 40);
  renderNotifications();
}

function observeNews(items) {
  const current = new Set(items.map((x) => x.url));
  if (!state.alertBaselines.news) {
    state.alertBaselines.news = [...current];
    return;
  }
  if (!state.alertSettings.news) return;
  const keywords = state.alertSettings.keywords.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  items.filter((x) => !state.alertBaselines.news.includes(x.url)).filter((x) => {
    const text = `${x.title} ${x.region || ''} ${x.category || ''}`.toLowerCase();
    return !keywords.length || keywords.some((keyword) => text.includes(keyword));
  }).slice(0, 5).forEach((x) => addNotification('NEW HEADLINE', x.title, x.url));
  state.alertBaselines.news = [...current];
}

function observeConflict(reports) {
  const ids = reports.map((x) => x.id || x.url || `${x.date}-${x.name}`);
  if (!state.alertBaselines.conflict) {
    state.alertBaselines.conflict = ids;
    return;
  }
  if (state.alertSettings.conflict) {
    reports.filter((x) => !state.alertBaselines.conflict.includes(x.id || x.url || `${x.date}-${x.name}`))
      .slice(0, 5).forEach((x) => addNotification('NEW CONFLICT REPORT', `${x.name || x.location || 'Reported event'} · ${x.date || ''}`, x.url || ''));
  }
  state.alertBaselines.conflict = ids;
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

function renderNotifications() {
  const list = $('#notificationList');
  if (list) list.innerHTML = state.notifications.length
    ? state.notifications.slice(0, 12).map((x) => `<div class="notification-item"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">OPEN ↗</a>` : ''}</div>`).join('')
    : '<div class="notification-empty">NO ALERTS YET</div>';
  const count = $('#notificationCount');
  if (count) count.textContent = String(state.notifications.length);
  const recent = $('#alertRecentCount');
  if (recent) recent.textContent = `${state.notifications.length} RECENT`;
}

function renderAlertSettings() {
  $('#alertNews').checked = state.alertSettings.news;
  $('#alertConflict').checked = state.alertSettings.conflict;
  $('#alertMarkets').checked = state.alertSettings.markets;
  $('#alertMove').value = state.alertSettings.marketMovePct;
  const chips = $('#alertKeywordChips');
  const terms = state.alertSettings.keywords.split(',').map((term) => term.trim()).filter(Boolean);
  chips.innerHTML = terms.length
    ? terms.map((term, index) => `<span class="alert-keyword-chip">${esc(term)}<button type="button" data-remove-keyword="${index}" aria-label="Remove ${esc(term)}">×</button></span>`).join('')
    : '<span class="alert-terms-empty">No headline terms selected. All new headlines will match.</span>';
}

function initNotifications() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.alertSettings = { ...state.alertSettings, ...saved };
    if (!Object.prototype.hasOwnProperty.call(saved, 'keywords')) {
      state.alertSettings.keywords = DEFAULT_KEYWORDS;
    }
  } catch { /* use defaults when storage is unavailable */ }
  renderNotifications();
}

function initAlertsPage() {
  renderAlertSettings();
  renderNotifications();
  ['alertNews', 'alertConflict', 'alertMarkets'].forEach((id) => {
    $(`#${id}`).onchange = (e) => {
      state.alertSettings[{ alertNews: 'news', alertConflict: 'conflict', alertMarkets: 'markets' }[id]] = e.target.checked;
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
  const addKeyword = () => {
    const input = $('#alertKeywordAdd');
    const term = input.value.trim();
    if (!term) return;
    const terms = state.alertSettings.keywords.split(',').map((value) => value.trim()).filter(Boolean);
    if (!terms.some((value) => value.toLowerCase() === term.toLowerCase())) terms.push(term);
    state.alertSettings.keywords = terms.join(', ');
    saveSettings();
    input.value = '';
    renderAlertSettings();
    input.focus();
  };
  $('#addAlertKeyword').onclick = addKeyword;
  $('#alertKeywordAdd').onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addKeyword();
    }
  };
  $('#alertMove').onchange = (e) => {
    state.alertSettings.marketMovePct = Math.max(0.1, Number(e.target.value) || 2);
    e.target.value = state.alertSettings.marketMovePct;
    saveSettings();
  };
  $('#clearNotifications').onclick = () => {
    state.notifications = [];
    renderNotifications();
  };
}

export { initNotifications, initAlertsPage, observeNews, observeConflict, observeMarkets };
