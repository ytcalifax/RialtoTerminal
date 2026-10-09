/**
 * Markets feature: quote loading, dashboard table, full monitor rendering,
 * instrument selection, and the market group tabs.
 *
 * Stale-quote policy: rows missing from a fresh snapshot are carried
 * forward (flagged `stale`) instead of vanishing, so a flaky upstream never
 * blanks the monitor.
 */
import { $, $$, esc } from '../core/dom.js';
import { fmtTime } from '../core/format.js';
import { req } from '../core/net.js';
import { setHealth, setStatus } from '../core/status.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { MARKET_GROUPS, TICKER_SYMBOLS, COINBASE_SLUGS, CUSTOM_GROUP } from '../core/constants.js';
import { savePins, withPin, withoutPin } from '../core/pins.js';
import { observeMarkets, observeDerivedSignals } from '../core/notifications.js';

// --- Pinned symbols (cookie-backed dashboard favourites) --------------------

/** Mini-tabs markup: universe groups + the ★ CUSTOM tab when pins exist. */
function marketGroupTabsHTML() {
  const tabs = MARKET_GROUPS
    .map(([id, label]) => `<button data-market-group="${id}" class="${state.marketGroup === id ? 'active' : ''}">${label} <small data-market-delay="${id}">AVG —</small></button>`)
    .join('');
  const custom = state.pins.length
    ? `<button data-market-group="${CUSTOM_GROUP}" class="${state.marketGroup === CUSTOM_GROUP ? 'active' : ''}">★ CUSTOM <small data-market-delay="${CUSTOM_GROUP}">AVG —</small></button>`
    : '';
  return tabs + custom;
}

/** Show the average age of each group's latest quote beside its tab. */
function updateMarketTabDelays() {
  $$('[data-market-group]').forEach((button) => {
    const group = button.dataset.marketGroup;
    const ages = state.market
      .filter((row) => row.group === group && Number.isFinite(Number(row.asof)) && Number(row.asof) > 0)
      .map((row) => Math.max(0, Date.now() / 1000 - Number(row.asof)));
    const average = ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null;
    let label = 'AVG —';
    if (average != null) {
      const seconds = Math.round(average);
      label = seconds < 60 ? `AVG ${seconds}s`
        : seconds < 3600 ? `AVG ${Math.round(seconds / 60)}m`
          : `AVG ${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    }
    const delay = button.querySelector('[data-market-delay]');
    if (delay) delay.textContent = label;
    else {
      const node = document.createElement('small');
      node.dataset.marketDelay = group;
      node.textContent = label;
      button.append(' ', node);
    }
    button.title = average == null ? 'Average quote delay unavailable' : `Average quote delay: ${label.slice(4)}`;
  });
}

setInterval(updateMarketTabDelays, 30000);

let lastSearchResults = null;
let lastSearchQuotes = {};
let lastSearchQuery = '';
let searchTimer = null;

/** Persist pins; keep tabs, ticker and the custom group in step. */
function setPins(next) {
  state.pins = next;
  savePins(next);
  // Re-render the module group tabs (the ★ CUSTOM tab appears with pins).
  const tabsEl = $('#marketGroupTabs');
  if (tabsEl) {
    tabsEl.innerHTML = marketGroupTabsHTML();
    bindMarketGroups();
  }
  syncDashboardCustomTab();
  if (!next.length && state.marketGroup === CUSTOM_GROUP) {
    state.marketGroup = 'INDICES';
    loadMarket('INDICES');
  } else if (state.marketGroup === CUSTOM_GROUP) {
    loadMarket(CUSTOM_GROUP);
  } else if (next.length) {
    loadMarket(CUSTOM_GROUP); // fetch pin quotes so the ticker updates now
  }
  renderMarkets(); // ticker strip picks up the new pins
  rerenderSymbolResults();
}

/** Show/hide the dashboard ★ CUSTOM tab as pins come and go. */
function syncDashboardCustomTab() {
  const tabs = document.querySelector('#marketPanel .mini-tabs');
  if (!tabs) return;
  let btn = tabs.querySelector('[data-market-group="CUSTOM"]');
  if (state.pins.length && !btn) {
    btn = document.createElement('button');
    btn.dataset.marketGroup = CUSTOM_GROUP;
    btn.textContent = '★ CUSTOM';
    tabs.insertBefore(btn, tabs.querySelector('.right'));
    bindMarketGroups();
  } else if (!state.pins.length && btn) {
    btn.remove();
  }
  if (btn) btn.classList.toggle('active', state.marketGroup === CUSTOM_GROUP);
}

/** Debounced symbol lookup; prices are fetched for the matches as decoration. */
function queueSymbolSearch(query) {
  clearTimeout(searchTimer);
  lastSearchQuery = query.trim();
  if (!lastSearchQuery) {
    renderSymbolResults(null);
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const r = await req(`/api/symbol-search?q=${encodeURIComponent(lastSearchQuery)}`);
      if (lastSearchQuery !== query.trim()) return;
      const results = r.results || [];
      const quotes = {};
      if (results.length) {
        try {
          const q = await req(`/api/quotes?symbols=${encodeURIComponent(results.map((x) => x.symbol).join(','))}`);
          for (const row of q.items || []) quotes[row.symbol] = row;
        } catch { /* live prices in the results are decoration */ }
      }
      lastSearchResults = results;
      lastSearchQuotes = quotes;
      renderSymbolResults(results, quotes);
    } catch (e) {
      lastSearchResults = [];
      renderSymbolResults([], {}, e.message);
    }
  }, 400);
}

/** Repaint the search results from the last lookup (kept for pin toggles). */
function rerenderSymbolResults() {
  if (lastSearchResults) renderSymbolResults(lastSearchResults, lastSearchQuotes);
}

function renderSymbolResults(results, quotes = {}, error = '') {
  const box = $('#symbolResults');
  if (!box) return;
  if (error) {
    box.innerHTML = `<div class="result-row">SEARCH FAILED · ${esc(error)}</div>`;
    box.classList.remove('hidden');
    return;
  }
  if (!results) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  if (!results.length) {
    box.innerHTML = '<div class="result-row">NO SYMBOLS MATCH THAT SEARCH</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = results.map((r) => {
    const pinned = state.pins.some((p) => p.symbol === r.symbol);
    const q = quotes[r.symbol];
    const price = q ? Number(q.last).toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—';
    const action = pinned
      ? `<button class="pinned" data-unpin="${esc(r.symbol)}" title="Remove from dashboard">✓ PINNED</button>`
      : `<button data-pin-symbol="${esc(r.symbol)}" data-pin-name="${esc(r.name)}" title="Pin to dashboard">+ ADD</button>`;
    return `<div class="result-row"><span class="sym">${esc(r.symbol)}</span><span class="name">${esc(r.name)}</span><span class="meta">${esc(r.type || '')}${r.exchange ? ' · ' + esc(r.exchange) : ''}</span><span class="price">${price}</span>${action}</div>`;
  }).join('');
  box.classList.remove('hidden');
}

/** Label for the outbound quote-page link column. */
const tradeLabel = () => 'OPEN QUOTE ↗';

/** Public quote page for an instrument (Coinbase for crypto, else Yahoo). */
const tradeUrl = (symbol) => COINBASE_SLUGS[symbol]
  ? `https://www.coinbase.com/price/${COINBASE_SLUGS[symbol]}`
  : `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`;

/** Inline SVG sparkline of intraday closes; '' when no series. */
function sparkline(series) {
  const valid = (series || []).filter((v) => Number.isFinite(v));
  if (valid.length < 2) return '';
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const span = hi - lo || 1;
  const p = valid.map((v, i) => `${i ? 'L' : 'M'} ${(i / (valid.length - 1 || 1)) * 54} ${13 - (v - lo) / span * 11}`).join(' ');
  return `<svg class="spark" viewBox="0 0 54 14"><path d="${p}"/></svg>`;
}

/** Bind the market-group tab row (dashboard mini-tabs and module tabs). */
function bindMarketGroups() {
  $$('[data-market-group]').forEach((button) => {
    button.onclick = () => {
      state.marketGroup = button.dataset.marketGroup;
      state.marketQuery = '';
      const filter = $('#marketSearchInput');
      const refresh = $('#marketRefresh');
      if (filter) filter.value = '';
      if (refresh) refresh.textContent = `REFRESH ${state.marketGroup}`;
      $$('[data-market-group]').forEach((tab) => tab.classList.toggle('active', tab.dataset.marketGroup === state.marketGroup));
      loadMarket(state.marketGroup);
      renderMarkets();
    };
  });
}

/**
 * Load quotes for a market group and merge with the previous snapshot.
 * @param {string} [group] - market group key, 'CORE', or the pinned CUSTOM set.
 */
async function loadMarket(group = 'CORE') {
  state.request.market[group] = (state.request.market[group] || 0) + 1;
  const requestId = state.request.market[group];
  setHealth('market', 'loading');
  try {
    const url = group === CUSTOM_GROUP
      ? `/api/quotes?symbols=${encodeURIComponent(state.pins.map((p) => p.symbol).join(','))}`
      : `/api/market?group=${encodeURIComponent(group)}`;
    const r = await req(url);
    if (requestId !== state.request.market[group]) return;
    const fresh = r.items || [];
    const previous = state.market;
    const bySymbol = new Map(fresh.map((x) => [x.symbol, { ...x, stale: false }]));
    state.marketGroupExpected[group] = group === CUSTOM_GROUP
      ? state.pins.length
      : (r.expected || fresh.length);
    const affectsGroup = (x) => (group === 'CORE' ? x.group !== CUSTOM_GROUP : x.group === group);
    state.market = [
      ...previous.filter((x) => !bySymbol.has(x.symbol)).map((x) => (affectsGroup(x) ? { ...x, stale: true } : x)),
      ...bySymbol.values(),
    ];
    const snapshotAt = Date.now();
    fresh.forEach((row) => {
      const history = state.marketHistory[row.symbol] || [];
      history.push({ at: snapshotAt, last: row.last, pct: row.pct });
      state.marketHistory[row.symbol] = history.slice(-96);
      row.series = state.marketHistory[row.symbol].map((point) => point.last);
    });
    observeDerivedSignals('market', observeMarkets(state.market));
    const sourceTimes = fresh.map((x) => Number(x.asof || 0)).filter(Boolean);
    state.timestamps.market = sourceTimes.length
      ? Math.max(...sourceTimes) * 1000
      : (r.fetched ? Number(r.fetched) * 1000 : Date.now());
    const partial = fresh.length < (r.expected || fresh.length);
    if (partial) {
      const missing = (r.expected || fresh.length) - fresh.length;
      const carried = previous.filter((x) => !bySymbol.has(x.symbol) && affectsGroup(x)).length;
      state.errors.market = `${missing} SYMBOL${missing === 1 ? '' : 'S'} UNAVAILABLE${carried ? ` · ${carried} CARRIED FORWARD` : ''}`;
    } else {
      state.errors.market = '';
    }
    // Only flag DELAYED when symbols are actually missing; a clean snapshot
    // is 'ok' (the source itself may still be exchange-delayed, which the
    // per-instrument "as of" timestamps show honestly).
    setHealth('market', state.errors.market ? 'delayed' : 'ok', state.errors.market);
    renderMarkets();
  } catch (e) {
    if (requestId !== state.request.market[group]) return;
    state.errors.market = e.message;
    state.market = state.market.map((x) => x.group === group ? { ...x, stale: true } : x);
    setHealth('market', 'error', e.message);
    renderMarkets();
    if (state.page === 'markets') renderFullMarketRows();
  }
}

/** Repaint the dashboard market table, ticker strip and spot chart. */
function renderMarkets() {
  updateMarketTabDelays();
  const scroller = $('.market-table-wrap');
  const scrollTop = scroller?.scrollTop || 0;
  const active = document.activeElement?.closest('#tickerQuotes [data-market-symbol],#marketTable [data-market-symbol]');
  const focusSymbol = active?.dataset.marketSymbol;
  const focusRoot = active?.closest('#tickerQuotes') ? '#tickerQuotes' : '#marketTable';
  const marketRows = state.market.filter((x) => x.group === state.marketGroup);

  const body = marketRows.map((x) => `<tr tabindex="0" data-market-symbol="${esc(x.symbol)}" class="${state.selectedInstrument === x.symbol ? 'chosen' : ''}"><td>${esc(x.name)} <span class="source-badge">${esc(x.symbol)}${x.source ? ' · BSE' : ''}${x.stale ? ' · RETAINED' : ''}</span></td><td>${Number(x.last).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td class="${x.change >= 0 ? 'positive' : 'negative'}">${x.change >= 0 ? '+' : ''}${Number(x.change).toFixed(2)}</td><td class="${x.pct >= 0 ? 'positive' : 'negative'}">${x.pct >= 0 ? '+' : ''}${Number(x.pct).toFixed(2)}%</td><td>${x.low != null ? Number(x.low).toFixed(2) + '–' + Number(x.high).toFixed(2) : '—'}</td><td>${sparkline(x.series)}</td></tr>`).join('');

  if ($('#marketTable tbody')) {
    $('#marketTable tbody').innerHTML = body
      || `<tr><td colspan="6" class="empty-state">${state.market.length ? 'NO PUBLIC SERIES IN ' + state.marketGroup : 'NO QUOTES RETURNED · RETRY OR CHECK SOURCE STATUS'}</td></tr>`;
  }
  const mt = $('#marketTime');
  if (mt) mt.textContent = fmtTime(state.timestamps.market || Date.now());

  const tq = $('#tickerQuotes');
  if (tq) {
    tq.innerHTML = [...new Set([...state.pins.map((p) => p.symbol), ...TICKER_SYMBOLS])]
      .map((s) => state.market.find((x) => x.symbol === s)).filter(Boolean)
      .map((x) => `<button class="quote" data-market-symbol="${esc(x.symbol)}"><b>${esc(x.name)}</b> ${Number(x.last || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} <em class="${(x.change || 0) < 0 ? 'down' : ''}">${x.pct == null ? '—' : `${x.pct >= 0 ? '+' : ''}${Number(x.pct).toFixed(2)}%`}</em></button>`).join('')
      || 'QUOTE FEED UNAVAILABLE';
  }

  const sp = state.market.find((x) => x.symbol === '^GSPC');
  const line = $('#spotLine');
  if (line && sp?.series?.length) {
    const valid = sp.series.filter(Number.isFinite);
    if (valid.length >= 2) {
      const lo = Math.min(...valid);
      const hi = Math.max(...valid);
      const span = hi - lo || 1;
      line.setAttribute('d', valid.map((v, i) => `${i ? 'L' : 'M'} ${(i / (valid.length - 1 || 1)) * 280} ${72 - ((v - lo) / span) * 58}`).join(' '));
    }
  }

  if (state.page === 'markets') renderFullMarketRows();
  bindMarketRows();
  if (scroller) scroller.scrollTop = scrollTop;
  if (focusSymbol) {
    const target = $$('[data-market-symbol]', $(focusRoot)).find((el) => el.dataset.marketSymbol === focusSymbol);
    target?.focus({ preventScroll: true });
  }
}

/** Repaint the full market monitor table (module page). */
function renderFullMarketRows() {
  const body = $('#fullMarketRows');
  if (!body) return;
  const scroller = body.closest('.marketplace-grid');
  const scrollTop = scroller?.scrollTop || 0;
  const focusSymbol = document.activeElement?.closest('#fullMarketRows [data-market-symbol]')?.dataset.marketSymbol;

  const groupRows = state.market.filter((x) => x.group === state.marketGroup);
  const q = state.marketQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rows = groupRows.filter((x) => !q || `${x.name} ${x.symbol}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q));

  body.innerHTML = rows.map((x) => `<tr tabindex="0" data-market-symbol="${esc(x.symbol)}" class="${state.selectedInstrument === x.symbol ? 'chosen' : ''}"><td>${esc(x.name)}${state.marketGroup === CUSTOM_GROUP ? ` <a class="pin-x" data-unpin="${esc(x.symbol)}" title="Remove from dashboard">✕</a>` : ''}</td><td>${esc(x.symbol)}${x.source ? ' · BSE SOFIA' : ''}${x.stale ? ' · STALE' : ''}</td><td>${Number(x.last).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td class="${x.change == null ? '' : x.change >= 0 ? 'positive' : 'negative'}">${x.change == null ? '—' : `${x.change >= 0 ? '+' : ''}${Number(x.change).toFixed(2)}`}</td><td>${x.pct == null ? '—' : `${x.pct >= 0 ? '+' : ''}${Number(x.pct).toFixed(2)}%`}</td><td>${x.low == null ? '—' : Number(x.low).toFixed(2)}</td><td>${x.high == null ? '—' : Number(x.high).toFixed(2)}</td><td>${sparkline(x.series)}</td><td><a class="trade-link" onclick="event.stopPropagation()" href="${tradeUrl(x.symbol)}" target="_blank" rel="noopener">${tradeLabel(x.symbol)}</a></td></tr>`).join('')
    || `<tr><td colspan="9" class="empty-state">${state.marketGroup === CUSTOM_GROUP && !state.pins.length ? 'NO PINNED INSTRUMENTS YET · SEARCH ABOVE AND PRESS + ADD' : q ? 'NO ' + state.marketGroup + ' INSTRUMENT MATCHES “' + esc(q.toUpperCase()) + '”' : 'NO QUOTES RETURNED · PUBLIC SOURCE UNAVAILABLE'}</td></tr>`;

  const status = $('#marketRowsMeta');
  const expected = state.marketGroupExpected?.[state.marketGroup] || groupRows.length;
  if (status) status.textContent = `${rows.length}${q ? ' MATCHES' : ' QUOTES'} · ${groupRows.length}/${expected} ${state.marketGroup} · AS OF ${fmtTime(state.timestamps.market)} · AUTO 5M${state.errors.market ? ' · ' + state.errors.market : ''}`;

  const detail = $('#instrumentDetail');
  const selected = state.market.find((x) => x.symbol === state.selectedInstrument);
  if (detail) {
    detail.textContent = selected
      ? `${selected.name} · ${selected.symbol} · LAST ${Number(selected.last).toLocaleString('en-US')}${selected.pct == null ? '' : ` · ${selected.pct >= 0 ? '+' : ''}${Number(selected.pct).toFixed(2)}%`} · ${selected.source || 'YAHOO FINANCE'}${selected.stale ? ' · CARRIED FORWARD' : ''}`
      : 'Select instrument row for quote detail. External links open quote pages; no order routing.';
  }

  bindMarketRows();
  if (scroller) scroller.scrollTop = scrollTop;
  if (focusSymbol) {
    const row = $$('[data-market-symbol]', body).find((el) => el.dataset.marketSymbol === focusSymbol);
    row?.focus({ preventScroll: true });
  }
}

/** Bind activation (click + Enter/Space) on market rows in both tables. */
function bindMarketRows() {
  $$('#marketTable [data-market-symbol],#fullMarketRows [data-market-symbol]').forEach((el) => {
    el.onclick = () => selectInstrument(el.dataset.marketSymbol);
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectInstrument(el.dataset.marketSymbol);
      }
    };
  });
}

/**
 * Select an instrument, switching to the markets page / group when needed.
 * @param {string} symbol
 */
function selectInstrument(symbol) {
  const x = state.market.find((q) => q.symbol === symbol);
  if (!x) return;
  const pageBeforeSelection = state.page;
  const groupChanged = Boolean(x.group && x.group !== state.marketGroup);
  state.selectedInstrument = symbol;
  if (groupChanged) {
    state.marketGroup = x.group;
    state.marketQuery = '';
    $$('[data-market-group]').forEach((tab) => tab.classList.toggle('active', tab.dataset.marketGroup === state.marketGroup));
    const filter = $('#marketSearchInput');
    const refresh = $('#marketRefresh');
    if (filter) filter.value = '';
    if (refresh) refresh.textContent = `REFRESH ${state.marketGroup}`;
  }
  if (pageBeforeSelection !== 'markets') emit('navigate', 'markets');
  else {
    renderFullMarketRows();
    if (groupChanged) loadMarket(state.marketGroup);
  }
  const row = $$('#fullMarketRows [data-market-symbol]').find((el) => el.dataset.marketSymbol === symbol);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    row.focus({ preventScroll: true });
  }
  setStatus(`${x.name.toUpperCase()} · ${x.symbol} · ${Number(x.last).toLocaleString('en-US')} · ${x.pct >= 0 ? '+' : ''}${Number(x.pct).toFixed(2)}%`);
}

/** Bind static market chrome: the dashboard ticker strip + pin actions. */
function initMarketsChrome() {
  bindMarketGroups();
  syncDashboardCustomTab();
  $('#tickerQuotes').addEventListener('click', (e) => {
    const q = e.target.closest('[data-market-symbol]');
    if (q) selectInstrument(q.dataset.marketSymbol);
  });
  // Pin/unpin buttons live in search results and custom rows; capture-phase
  // delegation stops the row-selection handler underneath from also firing.
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-pin-symbol]');
    const remove = e.target.closest('[data-unpin]');
    if (!add && !remove) return;
    e.stopPropagation();
    e.preventDefault();
    if (add) setPins(withPin(state.pins, add.dataset.pinSymbol, add.dataset.pinName));
    else setPins(withoutPin(state.pins, remove.dataset.unpin));
  }, true);
}

export {
  loadMarket, renderMarkets, renderFullMarketRows, bindMarketRows, bindMarketGroups,
  initMarketsChrome, marketGroupTabsHTML, queueSymbolSearch,
};
