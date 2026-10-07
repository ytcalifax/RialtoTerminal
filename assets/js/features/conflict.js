/** Public conflict data loading. */
import { req } from '../core/net.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';

let warBusy = false;
async function loadWar(force = false) {
  if (warBusy || (!force && state.warReports.length && Date.now() - (state.timestamps.war || 0) < 600000)) return;
  warBusy = true;
  try {
    const data = await req('/api/war');
    state.warReports = data.reports || [];
    state.warFrontline = data.frontline || [];
    state.warGpsJam = data.gpsjam || { date: '', features: [] };
    state.timestamps.war = Date.now();
    state.errors.war = data.stale ? 'SHOWING CACHED PUBLIC DATA' : data.partial ? 'PARTIAL SOURCE COVERAGE' : '';
  } catch (error) {
    state.errors.war = error.message;
  } finally {
    warBusy = false;
    if (state.page === 'war') emit('geospatial:updated');
  }
}

export { loadWar };
