/**
 * Static HTML shells for the two map surfaces. Templates only — behaviour
 * lives in view.js / interaction.js.
 */
import { state } from '../core/state.js';
import { OSM_CREDIT } from '../core/constants.js';

/**
 * Shell for the dashboard mini-map (AIS preview).
 * @returns {string} HTML — `.map-stage` + overlay + zoom controls.
 */
function homeMapShell() {
  return `<div class="map-stage"><div class="map-tiles"></div><div class="map-point-layer"></div></div><div class="map-overlay">LATEST AIS REPORTS · ${state.ships.length}</div><div class="map-controls"><button data-action="in" title="Zoom in">+</button><button data-action="out" title="Zoom out">−</button><button data-action="reset" title="Reset map">HOME</button></div><div class="map-grid-label">AIS POSITIONS · PUBLIC RECEIVER COVERAGE · © ${OSM_CREDIT}</div>`;
}

/**
 * Shell for a full tracking-module map.
 * @param {'ship'|'air'} type - which tracking surface the map serves.
 * @returns {string} HTML — includes the SVG route layer for track history.
 */
function mapShell(type = 'ship') {
  const air = type === 'air';
  return `<div class="module-map" data-map-kind="${air ? 'air' : 'ship'}"><div class="map-stage"><div class="map-tiles"></div><svg class="route-layer" viewBox="0 0 900 600" preserveAspectRatio="none"><path></path></svg><div class="map-point-layer"></div></div><div class="map-overlay">${air ? 'ADS-B STATE VECTORS' : 'AIS POSITION REPORTS'} · ${air ? 'OPEN SKY' : 'OPEN WATERS'}</div><div class="map-controls"><button data-action="in" title="Zoom in">+</button><button data-action="out" title="Zoom out">−</button><button data-action="reset" title="Reset map">HOME</button></div><div class="map-grid-label">PUBLIC POSITION DATA · BLACK SEA COVERAGE · © ${OSM_CREDIT}</div></div>`;
}

export { homeMapShell, mapShell };
