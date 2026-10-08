/**
 * Market Monitor module page: group tabs, filter box and the full quote
 * table shell.
 */
import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';
import { loadMarket, bindMarketGroups, renderFullMarketRows, bindMarketRows, marketGroupTabsHTML, queueSymbolSearch } from '../features/markets.js';

/**
 * Render the market monitor module into `root` and bind its controls.
 * @param {HTMLElement} root - the `#module` container.
 */
export function renderMarketsPage(root) {
  root.innerHTML = `<div class="module-title"><span>MARKET MONITOR <small>MON &lt;GO&gt; · ANY SYMBOL · PUBLIC QUOTES</small></span><span class="module-title-actions"><span class="source-badge">INDICATIVE · NOT FOR EXECUTION</span><button data-copy-data>COPY DATA</button></span></div><div class="module-controls"><input id="symbolSearch" placeholder="Search & pin any symbol (apple, btc, gold, asml.de)…"><input id="marketSearchInput" value="${esc(state.marketQuery)}" placeholder="Filter table…"><button class="primary" id="marketRefresh">REFRESH ${state.marketGroup}</button><span class="source-badge" id="marketRowsMeta">LOADING ${state.marketGroup} · YAHOO FINANCE / BSE SOFIX</span></div><div id="symbolResults" class="symbol-results hidden"></div><div class="mini-tabs market-groups" id="marketGroupTabs">${marketGroupTabsHTML()}<span class="right">1 MIN BARS · LIVE LAST</span></div><div class="marketplace-grid"><table class="market-instruments"><thead><tr><th>INSTRUMENT</th><th>SYMBOL</th><th>LAST</th><th>NET CHANGE</th><th>% CHANGE</th><th>DAY LOW</th><th>DAY HIGH</th><th>INTRADAY</th><th>EXTERNAL QUOTE</th></tr></thead><tbody id="fullMarketRows"></tbody></table></div><div class="detail-row" id="instrumentDetail">Select an instrument for details. External links open quote pages; no order routing.</div><div class="panel-foot">Yahoo Finance public chart endpoint · 1-minute bars with live last price; BSE Sofia SOFIX datafeed is 3-minute delayed. Some exchanges report with a delay of up to 15 minutes.</div>`;

  $('#marketRefresh').onclick = () => loadMarket(state.marketGroup);
  $('#marketSearchInput').oninput = (e) => {
    state.marketQuery = e.target.value;
    renderFullMarketRows();
  };
  $('#symbolSearch').oninput = (e) => queueSymbolSearch(e.target.value);
  bindMarketGroups();
  renderFullMarketRows();
  bindMarketRows();
}
