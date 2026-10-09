import { $ } from './dom.js';
import { state } from './state.js';
import { MIN_UPDATE_PULSE_MS } from './constants.js';
const setStatus = (message) => {
  const el = $('#statusText');
  if (el) el.textContent = message;
};
function renderConnection() {
  const reported = Object.values(state.health).filter((v) => v !== 'idle');
  const pending = reported.some((v) => v === 'loading');
  const good = reported.filter((v) => ['ok', 'delayed'].includes(v)).length;
  const indicator = $('#dataConnection');
  if (!indicator) return;
  indicator.dataset.state = pending
    ? 'loading'
    : reported.length && !good
      ? 'error'
      : reported.length < 4 ? 'partial'
      : reported.every((v) => v === 'ok') ? 'ok' : 'partial';
  const ds = $('#dataStatus');
  if (ds) {
    ds.textContent = pending
      ? `FEEDS ${good}/${reported.length} · UPDATING`
      : reported.length
        ? `FEEDS ${good}/${reported.length} · ${reported.some((v) => v === 'delayed') ? 'DELAYED' : 'PUBLIC'}`
        : 'DATA FEEDS · CONNECTING';
  }
}

let loadingSince = 0;
let pulseHoldTimer = null;

/**
 * Record a feed's health and refresh the header indicator.
 * @param {string} name - feed key: news|market|vessels|air
 * @param {string} status - idle|loading|ok|delayed|error
 * @param {string} [error] - error detail to retain for display
 */
function setHealth(name, status, error = '') {
  state.health[name] = status;
  if (error) state.errors[name] = error;
  else delete state.errors[name];

  const pending = Object.values(state.health).some((v) => v === 'loading');
  if (pending) {
    // A poll is running: pulse now (cancelling any held "done" state).
    if (!loadingSince) loadingSince = Date.now();
    if (pulseHoldTimer) {
      clearTimeout(pulseHoldTimer);
      pulseHoldTimer = null;
    }
    renderConnection();
    return;
  }
  if (!loadingSince) {
    renderConnection();
    return;
  }
  // All polls answered — but if they answered faster than the pulse cycle,
  // hold the updating state for the rest of the minimum dwell.
  const hold = Math.max(0, MIN_UPDATE_PULSE_MS - (Date.now() - loadingSince));
  loadingSince = 0;
  clearTimeout(pulseHoldTimer);
  pulseHoldTimer = setTimeout(() => {
    pulseHoldTimer = null;
    renderConnection();
  }, hold);
}

export { setStatus, setHealth };
