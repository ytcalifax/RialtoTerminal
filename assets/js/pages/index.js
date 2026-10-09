import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { renderNewsPage } from './newsPage.js';
import { renderMarketsPage } from './marketsPage.js';
import { renderTrackingPage } from './trackingPage.js';
import { renderMarketplacePage } from './marketplacePage.js';
import { renderWarPage } from './warPage.js';
import { renderAlertsPage } from './alertsPage.js';
export function renderModule() {
  const root = $('#module');
  if (state.page === 'top') return;
  switch (state.page) {
    case 'news':
      renderNewsPage(root);
      break;
    case 'marketplace':
      renderMarketplacePage(root);
      break;
    case 'ships':
    case 'air':
      renderTrackingPage(root, state.page === 'air');
      break;
    case 'markets':
      renderMarketsPage(root);
      break;
    case 'war':
      renderWarPage(root);
      break;
    case 'alerts':
      renderAlertsPage(root);
      break;
  }
}
