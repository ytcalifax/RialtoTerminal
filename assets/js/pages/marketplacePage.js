/**
 * Marketplace module page: filter box and listing table shell.
 */
import { $ } from '../core/dom.js';
import { loadMarketplace } from '../features/marketplace.js';

/**
 * Render the marketplace module into `root`, bind its controls and trigger
 * the first load.
 * @param {HTMLElement} root - the `#module` container.
 */
export function renderMarketplacePage(root) {
  root.innerHTML = `<div class="module-title"><span>MARKETPLACE <small>BAZAR.BG · LIVE SEARCH / ALL CATEGORIES</small></span><a class="source-badge" href="https://bazar.bg/obiavi" target="_blank" rel="noopener">SOURCE: BAZAR.BG ↗</a></div><div class="module-controls"><input id="marketQuery" placeholder="Search Bazar.bg listings…"><button class="primary" id="marketSearch">SEARCH BAZAR</button><span class="source-badge" id="marketplaceStatus">FETCHING PUBLIC LISTINGS…</span></div><div class="marketplace-grid" id="listingRows"></div><div class="panel-foot">Results are fetched from Bazar.bg search and link to original listings; terms, availability and pricing remain with the publisher.</div>`;

  loadMarketplace();
  $('#marketSearch').onclick = () => loadMarketplace($('#marketQuery').value);
  $('#marketQuery').onkeydown = (e) => {
    if (e.key === 'Enter') loadMarketplace(e.target.value);
  };
}
