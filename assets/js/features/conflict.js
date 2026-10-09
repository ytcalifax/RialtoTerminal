/** Public conflict data loading. */
import { req } from '../core/net.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { observeConflict, observeWorldMonitor, observeDerivedSignals } from '../core/notifications.js';

let warBusy = false;
async function loadWar(force = false) {
  if (warBusy || (!force && state.warReports.length && Date.now() - (state.timestamps.war || 0) < 900000)) return;
  warBusy = true;
  try {
    const data = await req('/api/conficts');
    state.warReports = data.reports || [];
    observeDerivedSignals('conflict', observeConflict(state.warReports));
    state.warFrontline = data.frontline || [];
    state.warGpsJam = data.gpsjam || { date: '', features: [] };
    state.warWorldMonitor = data.worldmonitor || state.warWorldMonitor;
    const newWorldMonitorItems = observeWorldMonitor(state.warWorldMonitor);
    observeDerivedSignals('outage', newWorldMonitorItems.filter((item) => item.alertKind === 'INTERNET DISRUPTION'));
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
