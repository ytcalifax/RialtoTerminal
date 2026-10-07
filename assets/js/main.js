/**
 * Composition root and boot sequence.
 *
 * This is the only module allowed to know every layer. It registers the
 * hooks that keep the rest of the graph acyclic, binds the chrome, performs
 * the initial loads and arms the polling intervals.
 *
 * Poll schedule (matches the source data rhythms):
 *   news 3 min · vessels 60 s · aircraft 15 min while visible ·
 *   markets 60 s (STOCKS group 4 min: 150-symbol Yahoo bursts) ·
 *   marketplace 15 min while visible · conflict 10 min
 */
import { $ } from './core/dom.js';
import { on } from './core/hooks.js';
import { state } from './core/state.js';

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
import { loadImpact } from './features/impact.js';

// --- Hook wiring (the seams described in core/hooks.js) ---------------------

// Features ask for navigation; the UI layer owns how navigation happens.
on('navigate', (page) => openPage(page));

// Map marker clicks select a track; the tracking feature owns that flow.
on('track:selected', (x, air) => selectTrack(x, air));

// Panning/zooming a tracking map retargets that feed's region: the map is
// the driver, so traffic is fetched wherever in the world the user looks.
on('map:view-changed', (kind) => trackingViewChanged(kind));

// After openPage flips the chrome, render the module shell and load any
// data the page needs (mirrors the original inline sequencing exactly).
on('page:changed', (page) => {
  const home = page === 'top';
  if (!home) renderModule();
  else renderDashboardShips();
  if (page === 'markets') loadMarket(state.marketGroup);
  if (page === 'ships' && ['idle', 'error'].includes(state.health.vessels)) loadShips();
  if (page === 'air' && (['idle', 'error'].includes(state.health.air) || Date.now() - (state.timestamps.air || 0) > 900000)) loadAir();
  if (page === 'war') loadWar();
  if (page === 'impact') loadImpact();
});

// Feature flows that rebuild the module shell after changing selection state.
on('module:rerender', () => renderModule());
on('geospatial:updated', () => renderModule());

// --- Boot -------------------------------------------------------------------

initChrome();
initCommandLine();
initNewsChrome();
initMarketsChrome();

loadNews();
loadMarket();
if (state.pins.length) loadMarket(CUSTOM_GROUP); // pin quotes feed the ticker
loadShips();

setInterval(() => loadNews(state.feed, state.newsQuery), 180000);
setInterval(loadShips, 60000);
setInterval(() => {
  if (state.page === 'air') loadAir();
}, 900000);
setInterval(() => {
  if (state.page === 'war') loadWar();
}, 600000);
setInterval(() => {
  if (state.page === 'impact') loadImpact(true);
}, 300000);
// Markets poll: fresh quotes every minute. The 150-symbol STOCKS group is
// throttled to every 4 min — Yahoo rate-limits per-request bursts, and one
// snapshot of that group is 150 requests.
const marketPollDelayMs = () =>
  state.page === 'markets' && state.marketGroup === 'STOCKS' ? 240000 : 60000;
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
