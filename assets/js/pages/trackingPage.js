/**
 * Vessel/Aircraft tracking module page: search + refresh controls, the
 * positions table, the map shell, and the detail / trajectory strips.
 */
import { $, esc } from '../core/dom.js';
import { fmtTime } from '../core/format.js';
import { state } from '../core/state.js';
import { emit } from '../core/hooks.js';
import { mapShell } from '../maps/shells.js';
import { setupMapInteraction } from '../maps/interaction.js';
import { renderMapView } from '../maps/view.js';
import { loadShips, loadAir, updateTrackingView, detailHTML } from '../features/tracking.js';

const CHOKEPOINTS = [
  { id: 'suez', name: 'SUEZ CANAL', lat: 30.46, lon: 32.34, detail: 'Links the Mediterranean Sea and Red Sea; a key Europe–Asia route.' },
  { id: 'hormuz', name: 'STRAIT OF HORMUZ', lat: 26.56, lon: 56.25, detail: 'Narrow outlet from the Persian Gulf to the Gulf of Oman.' },
  { id: 'bab-el-mandeb', name: 'BAB EL-MANDEB', lat: 12.58, lon: 43.33, detail: 'Connects the Red Sea with the Gulf of Aden and Indian Ocean.' },
  { id: 'malacca', name: 'STRAIT OF MALACCA', lat: 2.5, lon: 101.5, detail: 'Major passage between the Indian Ocean and South China Sea.' },
  { id: 'panama', name: 'PANAMA CANAL', lat: 9.08, lon: -79.68, detail: 'Connects the Atlantic and Pacific Oceans across Central America.' },
  { id: 'bosporus', name: 'BOSPORUS', lat: 41.12, lon: 29.07, detail: 'Connects the Black Sea with the Sea of Marmara.' },
  { id: 'dardanelles', name: 'DARDANELLES', lat: 40.2, lon: 26.4, detail: 'Links the Sea of Marmara with the Aegean Sea.' },
  { id: 'gibraltar', name: 'STRAIT OF GIBRALTAR', lat: 36, lon: -5.6, detail: 'Connects the Mediterranean Sea and Atlantic Ocean.' },
  { id: 'english-channel', name: 'ENGLISH CHANNEL', lat: 50.3, lon: -1.8, detail: 'Busy passage between the North Sea and Atlantic approaches.' },
  { id: 'danish-straits', name: 'DANISH STRAITS', lat: 55.3, lon: 12.6, detail: 'Passage between the Baltic Sea and North Sea.' },
  { id: 'cape-good-hope', name: 'CAPE OF GOOD HOPE', lat: -34.35, lon: 18.5, detail: 'Southern route around Africa between the Atlantic and Indian Oceans.' },
  { id: 'taiwan-strait', name: 'TAIWAN STRAIT', lat: 24.5, lon: 119.5, detail: 'Important shipping lane between the East and South China Seas.' },
];

/**
 * Render the tracking module for ships or aircraft.
 * @param {HTMLElement} root - the `#module` container.
 * @param {boolean} air - true renders the aircraft page, false the vessel page.
 */
export function renderTrackingPage(root, air) {
  const all = air ? state.aircraft : state.ships;
  const noun = air ? 'AIRCRAFT' : 'VESSEL';
  const stamp = state.timestamps[air ? 'air' : 'vessels'];
  root.innerHTML = `<div class="module-title"><span>${air ? 'AIR TRAFFIC' : 'VESSEL TRACKING'} <small>${air ? 'OPEN SKY ADS-B · PUBLIC STATE VECTORS' : 'AIS · GLOBAL MARITIME CHOKEPOINTS'}</small></span><span class="source-badge">${air ? 'OPENSKY · LIVE STATE VECTORS · FETCHES THE CURRENT VIEW' : 'OPEN WATERS AIS · WORLDWIDE RECEIVER COVERAGE · FETCHES THE CURRENT VIEW'}</span></div><div class="module-controls"><input id="trackQuery" value="${esc(state.trackQuery)}" placeholder="Search all ${air ? 'aircraft' : 'vessel'} fields…"><button class="primary" id="trackRefresh">REFRESH POSITIONS</button><select id="trackType"><option value="all">ALL ${air ? 'AIRCRAFT' : 'VESSELS'}</option><option value="moving">MOVING</option></select>${air ? '' : `<select id="chokepointSelect" aria-label="Go to a maritime chokepoint"><option value="">GO TO CHOKEPOINT…</option>${CHOKEPOINTS.map((x) => `<option value="${x.id}">${x.name}</option>`).join('')}</select>`}<span class="source-badge" id="trackStatus">${all.length} POSITIONS · ${air ? 'SOURCE AS OF' : 'CHECKED'} ${fmtTime(stamp)} · AUTO 60S${state.errors[air ? 'air' : 'vessels'] ? ' · FEED ERROR' : ''}</span></div><div class="module-body"><div class="module-list"><table><thead><tr><th>${noun}</th><th>LAT</th><th>LON</th><th>${air ? 'ALT M' : 'SOG KN'}</th><th>AGE</th></tr></thead><tbody id="trackRows"></tbody></table></div>${mapShell(air ? 'air' : 'ship')}</div><div class="detail-row">${state.selectedTrack ? detailHTML(state.selectedTrack, air) : 'Select a ' + noun.toLowerCase() + ' marker or row. Snapshot data is receiver dependent.'}</div><div class="track-status" id="trackTrajectoryStatus">SELECT A ${noun} FOR PUBLIC TRACK HISTORY</div>`;

  const map = $('.module-map');
  map._chokepoints = air ? [] : CHOKEPOINTS;
  map._onChokepointClick = (point) => {
    const popup = $('.map-point-popup', map);
    if (!popup) return;
    popup.innerHTML = `<button class="map-point-popup-close" type="button" aria-label="Close chokepoint details">×</button><b>${esc(point.name)}</b><span>MARITIME CHOKEPOINT · REFERENCE LOCATION</span><p>${esc(point.detail)}</p>`;
    popup.hidden = false;
    $('.map-point-popup-close', popup).onclick = () => { popup.hidden = true; };
  };
  const popup = document.createElement('aside');
  popup.className = 'map-point-popup';
  popup.hidden = true;
  map.append(popup);
  const locator = $('#chokepointSelect');
  if (locator) locator.onchange = () => {
    const point = CHOKEPOINTS.find((x) => x.id === locator.value);
    if (!point) return;
    Object.assign(state.mapViews.ship, { lat: point.lat, lon: point.lon, zoom: 6, userMoved: true });
    renderMapView(map);
    emit('map:view-changed', 'ship');
  };

  const applyTrackFilters = () => updateTrackingView();
  $('#trackType').value = state.trackMoving ? 'moving' : 'all';
  $('#trackRefresh').onclick = () => air ? loadAir() : loadShips();
  $('#trackQuery').oninput = applyTrackFilters;
  $('#trackType').onchange = applyTrackFilters;
  applyTrackFilters();
  setupMapInteraction();
}
