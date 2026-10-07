/**
 * Map view rendering: tiles + plotted positions + track route, driven by the
 * per-surface viewport in `state.mapViews`.
 *
 * Note: the currently visible rows are stashed on the map element itself
 * (`map._tracks`, `map._visibleTracks`, `map._air`, `map._routeCoords`) — the
 * original app's convention, kept so point ↔ table focus restoration keeps
 * working. Only this module reads or writes those fields.
 */
import { $, $$, esc } from '../core/dom.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { osmTileUrl } from '../core/constants.js';
import { clampMapZoom, mapProject } from './projection.js';
import { paintMapTiles } from './tiles.js';

/**
 * Compute a viewport centered on the freshest positions of a tracking set.
 * @param {'ship'|'air'} kind - which state.mapViews entry to update.
 * @param {Array} items - normalised position rows.
 */
function focusPositionView(kind, items) {
  if (!items?.length) return;
  const newest = kind === 'ship'
    ? [...items].sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity)).slice(0, 12)
    : [...items].sort((a, b) => (b.lastContact || 0) - (a.lastContact || 0)).slice(0, 12);
  const view = state.mapViews[kind];
  view.lat = newest.reduce((n, x) => n + x.lat, 0) / newest.length;
  view.lon = newest.reduce((n, x) => n + x.lon, 0) / newest.length;
  view.zoom = 8;
  view.userMoved = false;
  view.hasPositions = true;
}

/**
 * Full repaint of a map element: tiles for the current viewport, position
 * buttons for the rows in view, the route path, and focus restoration.
 * @param {HTMLElement} map - `.mini-map` or `.module-map` element.
 */
function renderMapView(map) {
  if (!map) return;
  const activeMarker = document.activeElement?.closest('.map-point');
  const focusTrackId = activeMarker?.closest('.module-map,.mini-map') === map
    ? map._visibleTracks?.[Number(activeMarker.dataset.index)]?.id : null;
  const stage = $('.map-stage', map);
  const tiles = $('.map-tiles:not(.map-tiles-fallback)', map);
  const layer = $('.map-point-layer', map);
  const kind = map.id === 'miniMap' ? 'home' : map.dataset.mapKind || 'ship';
  const view = state.mapViews[kind];
  const w = map.clientWidth;
  const h = map.clientHeight;
  if (!w || !h) return;
  view.zoom = clampMapZoom(view.zoom);

  const z = view.zoom;
  const n = 2 ** z;
  const center = mapProject(view.lon, view.lat, z);
  const left = center.x - w / 2;
  const right = center.x + w / 2;
  const top = center.y - h / 2;
  const bottom = center.y + h / 2;

  const html = [];
  for (let tx = Math.floor(left / 256); tx <= Math.floor(right / 256); tx++)
    for (let ty = Math.floor(top / 256); ty <= Math.floor(bottom / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wrap = ((tx % n) + n) % n;
      html.push(`<img alt="" draggable="false" src="${osmTileUrl(z, wrap, ty)}" style="left:${tx * 256 - center.x + w / 2}px;top:${ty * 256 - center.y + h / 2}px;width:256px;height:256px">`);
    }
  paintMapTiles(stage, tiles, html);

  const tracks = map._tracks || [];
  const visible = [];
  layer.innerHTML = tracks.map((x) => {
    const p = mapProject(x.lon, x.lat, z);
    const px = p.x - center.x + w / 2;
    const py = p.y - center.y + h / 2;
    if (px < -8 || px > w + 8 || py < -8 || py > h + 8) return '';
    const index = visible.push(x) - 1;
    return `<button class="map-point ${map._air ? 'air' : ''} ${state.selectedTrack?.id === x.id || map._selectedPointId === x.id ? 'selected' : ''}" style="position:absolute;left:${px}px;top:${py}px" title="${esc(x.name)} · ${esc(x.id)}" aria-label="Select ${esc(x.name)}" data-index="${index}"></button>`;
  }).join('');
  map._visibleTracks = visible;
  map.dataset.trackIds = visible.map((x) => x.id).join('|');

  const worldWidth = 256 * n;
  const visibleChokepoints = [];
  const chokepoints = (map._chokepoints || []).map((point) => {
    const p = mapProject(point.lon, point.lat, z);
    let dx = p.x - center.x;
    if (dx > worldWidth / 2) dx -= worldWidth;
    if (dx < -worldWidth / 2) dx += worldWidth;
    const px = dx + w / 2;
    const py = p.y - center.y + h / 2;
    if (px < -100 || px > w + 100 || py < -12 || py > h + 12) return '';
    const index = visibleChokepoints.push(point) - 1;
    return `<button class="chokepoint-marker" style="left:${px}px;top:${py}px" title="${esc(point.name)}" aria-label="Show ${esc(point.name)} details" data-index="${index}"><i></i><span>${esc(point.name)}</span></button>`;
  }).join('');
  layer.insertAdjacentHTML('beforeend', chokepoints);
  map._visibleChokepoints = visibleChokepoints;
  $$('.chokepoint-marker', layer).forEach((button) => {
    button.onclick = () => {
      if (!map.dataset.dragged) map._onChokepointClick?.(visibleChokepoints[Number(button.dataset.index)]);
    };
  });

  const overlay = $('.map-overlay', map);
  if (overlay) overlay.textContent = map._mapLabel || (kind === 'home'
    ? `LATEST AIS REPORTS · ${visible.length} VISIBLE`
    : `${map._air ? 'ADS-B AIRCRAFT' : 'AIS VESSELS'} · ${visible.length}/${tracks.length} IN VIEW`);

  $$('.map-point', layer).forEach((b) => {
    b.onclick = () => {
      // Suppress the click that ends a map drag. Selection goes through the
      // hooks seam: selectTrack belongs to the tracking feature, and maps
      // must not import features (they import maps).
      if (map.dataset.dragged) return;
      const item = visible[Number(b.dataset.index)];
      if (map._onPointClick) map._onPointClick(item, b);
      else if (!map._noSelect) emit('track:selected', item, !!map._air);
    };
  });

  if (map._routeCoords || map._routeSegments) {
    const segments = map._routeSegments || [map._routeCoords];
    const d = segments.filter(Boolean).map((coords) => coords.map((c, i) => {
      const p = mapProject(c[0], c[1], z);
      return `${i ? 'L' : 'M'} ${(p.x - center.x + w / 2) / w * 900} ${(p.y - center.y + h / 2) / h * 600}`;
    }).join(' ')).join(' ');
    const path = $('.route-layer > path', map);
    if (path) path.setAttribute('d', d);
    const status = $('#trackTrajectoryStatus');
    if (status && map._routeCoords && status.textContent.startsWith('PUBLIC TRACK')) status.textContent = `PUBLIC TRACK · ${map._routeCoords.length} WAYPOINTS · ${map._air ? 'OPENSKY' : 'OPEN WATERS AIS'}`;
  }

  const coverageLayer = $('.coverage-layer', map);
  if (coverageLayer) {
    coverageLayer.innerHTML = (map._coverageCells || []).map((feature, index) => {
      const ring = feature.geometry?.coordinates?.[0];
      if (!ring?.length) return '';
      const d = ring.map(([lon, lat], i) => {
        const p = mapProject(lon, lat, z);
        const x = (p.x - center.x + w / 2) / w * 900;
        const y = (p.y - center.y + h / 2) / h * 600;
        return `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ') + ' Z';
      const percent = Number(feature.properties?.percent) || 0;
      const level = percent >= 10 ? 'high' : percent >= 2 ? 'medium' : 'low';
      return `<path class="gpsjam-cell ${level}" d="${d}" data-index="${index}"><title>${percent}% reported interference · ${feature.properties?.bad || 0} affected / ${feature.properties?.good || 0} unaffected aircraft</title></path>`;
    }).join('');
    $$('.gpsjam-cell', coverageLayer).forEach((cell) => {
      cell.onclick = (event) => {
        if (map.dataset.dragged) return;
        map._onCoverageClick?.((map._coverageCells || [])[Number(cell.dataset.index)], event);
      };
    });
  }

  if (focusTrackId) {
    const index = visible.findIndex((x) => x.id === focusTrackId);
    const target = $$('.map-point', layer).find((b) => Number(b.dataset.index) === index);
    target?.focus({ preventScroll: true });
  }
}

/**
 * Store a position set on a map element and repaint it.
 * @param {Array} items - normalised position rows to plot.
 * @param {boolean} [air] - true for aircraft styling.
 * @param {HTMLElement} [layer] - `.map-point-layer` of the target map.
 */
function plotPoints(items, air = false, layer = $('.map-point-layer')) {
  if (!layer) return;
  const map = layer.closest('.module-map,.mini-map');
  map._tracks = items;
  map._air = air;
  renderMapView(map);
}

export { focusPositionView, renderMapView, plotPoints };
