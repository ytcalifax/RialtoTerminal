/**
 * Page navigation.
 *
 * `openPage` is the single entry point for switching workspaces. It handles
 * the chrome updates (nav highlighting, session label, visibility) and then
 * emits 'page:changed' so the composition root can render the module shell
 * and trigger page-specific data loads — navigation itself knows nothing
 * about individual features.
 */
import { $, $$ } from '../core/dom.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { setStatus } from '../core/status.js';
import { SCREEN_BY_PAGE, SESSION_LABELS } from '../core/constants.js';
import { focusPositionView } from '../maps/view.js';

/**
 * Switch the terminal to `page` (top|news|markets|ships|air|marketplace).
 * @param {string} page
 */
function openPage(page) {
  $('#suggestions').classList.remove('open');

  // A track selected on one surface is meaningless on the other.
  if (page === 'air' && state.selectedTrack?.source !== 'OPENSKY') state.selectedTrack = null;
  if (page === 'ships' && state.selectedTrack?.source === 'OPENSKY') state.selectedTrack = null;
  if (page === 'ships' || page === 'air') state.trackQuery = state.trackQueries[page] || '';

  // First visit to a tracking page: frame the freshest positions.
  if (page === 'ships' && !state.mapViews.ship.hasPositions) focusPositionView('ship', state.ships);
  if (page === 'air' && !state.mapViews.air.hasPositions) focusPositionView('air', state.aircraft);

  state.page = page;
  $$('.function-nav button[data-page]').forEach((b) => {
    const current = b.dataset.page === page;
    b.classList.toggle('selected', current);
    if (current) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const screen = Object.entries(SCREEN_BY_PAGE).find(([, p]) => p === page)?.[0];
  if (screen) state.screen = screen;
  $$('.tab-small').forEach((b) => b.classList.toggle('selected', b.dataset.screen === state.screen));
  const sessionEl = $('.session b');
  if (sessionEl) sessionEl.textContent = SESSION_LABELS[page] || page.toUpperCase();

  const home = page === 'top';
  const workspace = $('#workspace');
  if (workspace) workspace.classList.toggle('hidden', !home);
  const moduleEl = $('#module');
  if (moduleEl) moduleEl.classList.toggle('hidden', home);

  // Module rendering + page-specific (re)loads are wired in main.js.
  emit('page:changed', page);

  const command = page === 'war' ? 'CON' : page.toUpperCase();
  setStatus(`${command} · ${state.errors[page === 'ships' ? 'vessels' : page === 'air' ? 'air' : page] || 'public data'}`);
}

export { openPage };
