import { $ } from './core/dom.js';
import { on } from './core/hooks.js';
import { state } from './core/state.js';
import { initNotifications } from './core/notifications.js';
import { initDeductions } from './core/deduction.js';
import { initDebugPanel } from './core/debugPanel.js';

import { openPage } from './ui/navigation.js';
import { initChrome } from './ui/chrome.js';
import { initCommandLine } from './ui/commandLine.js';

import { renderModule } from './pages/index.js';

import { loadNews, initNewsChrome } from './features/news.js';
import { loadMarket, initMarketsChrome } from './features/markets.js';
import { CUSTOM_GROUP } from './core/constants.js';
import { loadShips, loadAir, renderDashboardShips, selectTrack, trackingViewChanged } from './features/tracking.js';
import { loadMarketplace } from './features/marketplace.js';
import { loadWar } from './features/conflict.js';
import { loadDiseaseOutbreaks } from './features/health.js';

on('navigate', (page) => openPage(page));

on('track:selected', (x, air) => selectTrack(x, air));

// Panning/zooming a tracking map retargets that feed's region: the map is
// the driver, so traffic is fetched wherever in the world the user looks.
on('map:view-changed', (kind) => trackingViewChanged(kind));

on('page:changed', (page) => {
  const home = page === 'top';
  if (!home) renderModule();
  else renderDashboardShips();
  if (page === 'markets') loadMarket(state.marketGroup);
  if (page === 'ships' && ['idle', 'error'].includes(state.health.vessels)) loadShips();
  if (page === 'air' && (['idle', 'error'].includes(state.health.air) || Date.now() - (state.timestamps.air || 0) > 900000)) loadAir();
  if (page === 'war') loadWar();
});

on('module:rerender', () => renderModule());
on('geospatial:updated', () => renderModule());

initChrome();
initNotifications();
initDeductions();
initDebugPanel();
initCommandLine();
initNewsChrome();
initMarketsChrome();

loadNews();
loadMarket();
if (state.pins.length) loadMarket(CUSTOM_GROUP);
loadShips();
loadAir();
loadWar();
loadDiseaseOutbreaks();
loadMarketplace();

setInterval(() => loadNews(state.feed, state.newsQuery), 300000);
setInterval(loadShips, 60000);
setInterval(loadAir, 900000);
setInterval(loadWar, 900000);
setInterval(loadDiseaseOutbreaks, 900000);
setInterval(() => loadMarketplace(state.marketplaceQuery), 900000);
// Yahoo's chart URL accepts one symbol per request. Keep the useful intraday
// snapshot while limiting each symbol to one upstream refresh per 5 min;
// the much larger STOCKS tab refreshes every 10 min.
const marketPollDelayMs = () =>
  state.page === 'markets' && state.marketGroup === 'STOCKS' ? 600000 : 300000;
(function pollMarkets() {
  setTimeout(() => {
    const group = state.page === 'markets'
      ? state.marketGroup
      : state.page === 'top' && state.marketGroup !== 'INDICES' ? state.marketGroup : 'CORE';
    loadMarket(group);
    // Pinned symbols get their own refresh so the ticker stays current even
    // while another group is on screen.
    if (state.pins.length && group !== CUSTOM_GROUP) loadMarket(CUSTOM_GROUP);
    pollMarkets();
  }, marketPollDelayMs());
})();
setInterval(() => {
  if (state.page === 'marketplace') loadMarketplace($('#marketQuery')?.value || '');
}, 900000);
