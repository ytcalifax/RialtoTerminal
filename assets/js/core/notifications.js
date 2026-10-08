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
  const box = $('#notificationBox');
  const list = $('#notificationList');
  if (!box || !list) return;
  list.innerHTML = state.notifications.length
    ? state.notifications.slice(0, 12).map((x) => `<div class="notification-item"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">OPEN ↗</a>` : ''}</div>`).join('')
    : '<div class="notification-empty">NO ALERTS YET</div>';
  $('#notificationCount').textContent = String(state.notifications.length);
}

function renderSettings() {
  $('#alertNews').checked = state.alertSettings.news;
  $('#alertConflict').checked = state.alertSettings.conflict;
  $('#alertMarkets').checked = state.alertSettings.markets;
  $('#alertKeywords').value = state.alertSettings.keywords;
  $('#alertMove').value = state.alertSettings.marketMovePct;
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
  $('#notificationToggle').onclick = () => $('#notificationBox').classList.toggle('open');
  ['alertNews', 'alertConflict', 'alertMarkets'].forEach((id) => {
    $(`#${id}`).onchange = (e) => {
      state.alertSettings[{ alertNews: 'news', alertConflict: 'conflict', alertMarkets: 'markets' }[id]] = e.target.checked;
      saveSettings();
    };
  });
  $('#alertKeywords').onchange = (e) => { state.alertSettings.keywords = e.target.value; saveSettings(); };
  $('#alertMove').onchange = (e) => { state.alertSettings.marketMovePct = Number(e.target.value); saveSettings(); };
  $('#clearNotifications').onclick = () => { state.notifications = []; renderNotifications(); };
  renderSettings();
  renderNotifications();
}

export { initNotifications, observeNews, observeConflict, observeMarkets };
