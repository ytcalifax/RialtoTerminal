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
  const war = type === 'war';
  const title = war ? 'CONFLICT REPORTS' : air ? 'ADS-B STATE VECTORS' : 'AIS POSITION REPORTS';
  return `<div class="module-map ${war ? 'war-map' : ''}" data-map-kind="${war ? 'war' : air ? 'air' : 'ship'}"><div class="map-stage"><div class="map-tiles"></div><svg class="route-layer" viewBox="0 0 900 600" preserveAspectRatio="none"><g class="coverage-layer"></g><path></path></svg><div class="map-point-layer"></div></div><div class="map-overlay">${title}</div><div class="map-controls"><button data-action="in" title="Zoom in">+</button><button data-action="out" title="Zoom out">−</button><button data-action="reset" title="Reset map">HOME</button></div><div class="map-grid-label">${war ? 'PUBLIC OPEN DATA' : air ? 'PUBLIC ADS-B POSITIONS' : 'PUBLIC AIS POSITIONS · CHOKEPOINT REFERENCES'} · © ${OSM_CREDIT}</div></div>`;
}

export { homeMapShell, mapShell };
