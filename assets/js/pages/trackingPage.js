/**
 * Vessel/Aircraft tracking module page: search + refresh controls, the
 * positions table, the map shell, and the detail / trajectory strips.
 */
import { $, esc } from '../core/dom.js';
import { fmtTime } from '../core/format.js';
import { state } from '../core/state.js';
import { mapShell } from '../maps/shells.js';
import { setupMapInteraction } from '../maps/interaction.js';
import { loadShips, loadAir, updateTrackingView, detailHTML } from '../features/tracking.js';

/**
 * Render the tracking module for ships or aircraft.
 * @param {HTMLElement} root - the `#module` container.
 * @param {boolean} air - true renders the aircraft page, false the vessel page.
 */
export function renderTrackingPage(root, air) {
  const all = air ? state.aircraft : state.ships;
  const noun = air ? 'AIRCRAFT' : 'VESSEL';
  const stamp = state.timestamps[air ? 'air' : 'vessels'];
  root.innerHTML = `<div class="module-title"><span>${air ? 'AIR TRAFFIC' : 'VESSEL TRACKING'} <small>${air ? 'OPEN SKY ADS-B · PUBLIC STATE VECTORS' : 'AIS / BLACK SEA · SHIP &lt;GO&gt;'}</small></span><span class="source-badge">${air ? 'OPENSKY · LIVE STATE VECTORS · FETCHES THE CURRENT VIEW' : 'OPEN WATERS AIS · WORLDWIDE RECEIVER COVERAGE · FETCHES THE CURRENT VIEW'}</span></div><div class="module-controls"><input id="trackQuery" value="${esc(state.trackQuery)}" placeholder="Search all ${air ? 'aircraft' : 'vessel'} fields…"><button class="primary" id="trackRefresh">REFRESH POSITIONS</button><select id="trackType"><option value="all">ALL ${air ? 'AIRCRAFT' : 'VESSELS'}</option><option value="moving">MOVING</option></select><span class="source-badge" id="trackStatus">${all.length} POSITIONS · ${air ? 'SOURCE AS OF' : 'CHECKED'} ${fmtTime(stamp)} · AUTO 60S${state.errors[air ? 'air' : 'vessels'] ? ' · FEED ERROR' : ''}</span></div><div class="module-body"><div class="module-list"><table><thead><tr><th>${noun}</th><th>LAT</th><th>LON</th><th>${air ? 'ALT M' : 'SOG KN'}</th><th>AGE</th></tr></thead><tbody id="trackRows"></tbody></table></div>${mapShell(air ? 'air' : 'ship')}</div><div class="detail-row">${state.selectedTrack ? detailHTML(state.selectedTrack, air) : 'Select a ' + noun.toLowerCase() + ' marker or row. Snapshot data is receiver dependent.'}</div><div class="track-status" id="trackTrajectoryStatus">SELECT A ${noun} FOR PUBLIC TRACK HISTORY</div>`;

  const applyTrackFilters = () => updateTrackingView();
  $('#trackType').value = state.trackMoving ? 'moving' : 'all';
  $('#trackRefresh').onclick = () => air ? loadAir() : loadShips();
  $('#trackQuery').oninput = applyTrackFilters;
  $('#trackType').onchange = applyTrackFilters;
  applyTrackFilters();
  setupMapInteraction();
}
