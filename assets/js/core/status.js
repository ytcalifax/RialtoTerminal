/**
 * Status-bar and feed-health indicators.
 *
 * `setHealth` is the single writer of the header connection state: it folds
 * the four feed statuses into one indicator (`loading` / `partial` / `ok` /
 * `error`) and derives the caption text. A poll that finishes faster than
 * the pulse animation holds the "UPDATING" state for a minimum dwell so the
 * updating signal stays visible.
 */
import { $ } from './dom.js';
import { state } from './state.js';
import { MIN_UPDATE_PULSE_MS } from './constants.js';

/** Write a message to the bottom status bar (plain text, not HTML). */
const setStatus = (message) => {
  $('#statusText').textContent = message;
};

/** Fold the current feed states into the header indicator + caption. */
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
  $('#dataStatus').textContent = pending
    ? `FEEDS ${good}/${reported.length} · UPDATING`
    : reported.length
      ? `FEEDS ${good}/${reported.length} · ${reported.some((v) => v === 'delayed') ? 'DELAYED' : 'PUBLIC'}`
      : 'DATA FEEDS · CONNECTING';
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
