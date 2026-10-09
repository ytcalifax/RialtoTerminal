import { req } from '../core/net.js';
import { state } from '../core/state.js';
import { observeDiseaseOutbreaks, observeDerivedSignals } from '../core/notifications.js';

let busy = false;

async function loadDiseaseOutbreaks(force = false) {
  if (busy || (!force && Date.now() - (state.timestamps.diseaseOutbreaks || 0) < 900000)) return;
  busy = true;
  try {
    const data = await req('/api/health/outbreaks');
    state.diseaseOutbreaksStale = data.stale === true || data.partial === true;
    state.diseaseOutbreaksUpdatedAt = Number(data.updated_at) * 1000 || 0;
    state.diseaseOutbreaks = state.diseaseOutbreaksStale ? [] : (data.outbreaks || []);
    observeDerivedSignals('disease', observeDiseaseOutbreaks(state.diseaseOutbreaks));
    state.timestamps.diseaseOutbreaks = Date.now();
  } catch {
    // Keep the last good outbreak list available if a refresh fails.
  } finally {
    busy = false;
  }
}

export { loadDiseaseOutbreaks };
