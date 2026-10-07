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
  { name: 'SUEZ CANAL', lat: 30.46, lon: 32.34, detail: 'Located in northeastern Egypt, this man-made canal connects the Mediterranean Sea to the Red Sea.' },
  { name: 'STRAIT OF HORMUZ', lat: 26.56, lon: 56.25, detail: 'Between Iran and the Musandam Peninsula of Oman, this narrow strait connects the Persian Gulf to the Gulf of Oman.' },
  { name: 'BAB EL-MANDEB', lat: 12.58, lon: 43.33, detail: 'Between Yemen and Djibouti/Eritrea, this strait connects the Red Sea to the Gulf of Aden.' },
  { name: 'STRAIT OF MALACCA', lat: 2.5, lon: 101.5, detail: 'Between the Malay Peninsula and the Indonesian island of Sumatra, this strait links the Andaman Sea to the Strait of Singapore and South China Sea.' },
  { name: 'PANAMA CANAL', lat: 9.08, lon: -79.68, detail: 'Across the Isthmus of Panama in Central America, this man-made canal connects the Atlantic and Pacific Oceans.' },
  { name: 'BOSPORUS', lat: 41.12, lon: 29.07, detail: 'Within Istanbul, Turkey, this strait connects the Black Sea to the Sea of Marmara.' },
  { name: 'DARDANELLES', lat: 40.2, lon: 26.4, detail: 'In northwestern Turkey, this strait connects the Aegean Sea to the Sea of Marmara.' },
  { name: 'STRAIT OF GIBRALTAR', lat: 36, lon: -5.6, detail: 'Between southern Spain and northern Morocco, this strait connects the Atlantic Ocean to the Mediterranean Sea.' },
  { name: 'ENGLISH CHANNEL', lat: 50.3, lon: -1.8, detail: 'Between southern England and northern France, this arm of the Atlantic connects the Atlantic approaches to the North Sea.' },
  { name: 'DANISH STRAITS', lat: 55.3, lon: 12.6, detail: 'Between Denmark and Sweden, these straits connect the Baltic Sea to the North Sea.' },
  { name: 'CAPE OF GOOD HOPE', lat: -34.35, lon: 18.5, detail: 'At the southwestern tip of South Africa, this cape marks a major sea route between the Atlantic and Indian Ocean regions.' },
  { name: 'TAIWAN STRAIT', lat: 24.5, lon: 119.5, detail: 'Between Taiwan and mainland China, this strait connects the East China Sea to the South China Sea.' },
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
  root.innerHTML = `<div class="module-title"><span>${air ? 'AIR TRAFFIC' : 'VESSEL TRACKING'} <small>${air ? 'OPEN SKY ADS-B · PUBLIC STATE VECTORS' : 'AIS · CHOKEPOINT TRAFFIC COUNTS'}</small></span><span class="source-badge">${air ? 'OPENSKY · LIVE STATE VECTORS · FETCHES THE CURRENT VIEW' : 'OPEN WATERS AIS · WORLDWIDE RECEIVER COVERAGE · FETCHES THE CURRENT VIEW'}</span></div><div class="module-controls"><input id="trackQuery" value="${esc(state.trackQuery)}" placeholder="Search all ${air ? 'aircraft' : 'vessel'} fields…"><button class="primary" id="trackRefresh">REFRESH POSITIONS</button><select id="trackType"><option value="all">ALL ${air ? 'AIRCRAFT' : 'VESSELS'}</option><option value="moving">MOVING</option></select>${air ? '' : `<select id="chokepointSelect" aria-label="Go to a maritime chokepoint"><option value="">GO TO CHOKEPOINT…</option>${CHOKEPOINTS.map((point) => `<option value="${esc(point.name)}">${esc(point.name)}</option>`).join('')}</select>`}<span class="source-badge" id="trackStatus">${all.length} POSITIONS · ${air ? 'SOURCE AS OF' : 'CHECKED'} ${fmtTime(stamp)} · AUTO 60S${state.errors[air ? 'air' : 'vessels'] ? ' · FEED ERROR' : ''}</span></div><div class="module-body"><div class="module-list"><table><thead><tr><th>${noun}</th><th>LAT</th><th>LON</th><th>${air ? 'ALT M' : 'SOG KN'}</th><th>AGE</th></tr></thead><tbody id="trackRows"></tbody></table></div>${mapShell(air ? 'air' : 'ship')}</div><div class="detail-row">${state.selectedTrack ? detailHTML(state.selectedTrack, air) : 'Select a ' + noun.toLowerCase() + ' marker or row. Snapshot data is receiver dependent.'}</div><div class="track-status" id="trackTrajectoryStatus">SELECT A ${noun} FOR PUBLIC TRACK HISTORY</div>`;

  const map = $('.module-map');
  const popup = document.createElement('aside');
  popup.className = 'map-point-popup';
  popup.hidden = true;
  map.append(popup);
  map._onChokepointClick = (point) => {
    popup.innerHTML = `<button class="map-point-popup-close" type="button" aria-label="Close chokepoint details">×</button><b>${esc(point.name)}</b><span>${point.count} AIS VESSELS WITHIN 25 NM</span><p>${esc(point.detail)}</p><p>Count is based on currently loaded AIS positions. Receiver coverage and data age vary.</p>`;
    popup.hidden = false;
    $('.map-point-popup-close', popup).onclick = () => { popup.hidden = true; };
  };
  map._chokepoints = air ? [] : CHOKEPOINTS;
  const locator = $('#chokepointSelect');
  if (locator) locator.onchange = () => {
    const point = CHOKEPOINTS.find((item) => item.name === locator.value);
    if (!point) return;
    Object.assign(state.mapViews.ship, { lat: point.lat, lon: point.lon, zoom: 7, userMoved: true });
    renderMapView(map);
    emit('map:view-changed', 'ship');
  };

  const applyTrackFilters = () => updateTrackingView();
  const typeSelect = $('#trackType');
  typeSelect.value = state.trackMoving ? 'moving' : 'all';
  $('#trackRefresh').onclick = () => air ? loadAir() : loadShips();
  $('#trackQuery').oninput = applyTrackFilters;
  typeSelect.onchange = applyTrackFilters;
  applyTrackFilters();
  setupMapInteraction();
}
