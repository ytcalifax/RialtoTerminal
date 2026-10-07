/**
 * Marketplace module page: filter box and listing table shell.
 */
import { $, esc } from '../core/dom.js';
import { loadMarketplace } from '../features/marketplace.js';

/**
 * Render the marketplace module into `root`, bind its controls and trigger
 * the first load.
 * @param {HTMLElement} root - the `#module` container.
 */
export function renderMarketplacePage(root) {
  root.innerHTML = `<div class="module-title"><span>MARKETPLACE <small>ALL CATEGORIES · PUBLIC LISTINGS</small></span><a class="source-badge" href="https://bazar.bg/obiavi" target="_blank" rel="noopener">SOURCE: BAZAR.BG ↗</a></div><div class="module-controls"><input id="marketQuery" placeholder="Filter live listings by keyword…"><button class="primary" id="marketSearch">FILTER / REFRESH</button><span class="source-badge" id="marketplaceStatus">FETCHING PUBLIC LISTINGS…</span></div><div class="marketplace-grid" id="listingRows"></div><div class="panel-foot">Listings are metadata and outbound links from Bazar.bg; listing terms, availability and pricing remain with the publisher.</div>`;

  loadMarketplace();
  $('#marketSearch').onclick = () => loadMarketplace($('#marketQuery').value);
  $('#marketQuery').onkeydown = (e) => {
    if (e.key === 'Enter') loadMarketplace(e.target.value);
  };
}
