/**
 * Map interaction: pointer drag panning, wheel/dblclick/buttons zooming,
 * and viewport bookkeeping. Pan/zoom writes back into `state.mapViews` and
 * repaints through renderMapView, so all maps share one code path.
 */
import { $, $$ } from '../core/dom.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { clampMapZoom, mapProject, mapUnproject } from './projection.js';
import { focusPositionView, renderMapView } from './view.js';

/** The map kind a given map element serves ('home' | 'ship' | 'air'). */
const mapKindOf = (map) => (map.id === 'miniMap' ? 'home' : map.dataset.mapKind || 'ship');

/** In-flight drag descriptor, or null when no drag is active. */
let mapDrag = null;

window.addEventListener('pointermove', (e) => {
  if (!mapDrag) return;
  const d = mapDrag;
  d.dx = e.clientX - d.x;
  d.dy = e.clientY - d.y;
  if (Math.abs(d.dx) + Math.abs(d.dy) > 3) d.moved = true;
  if (d.moved) d.stage.style.transform = `translate3d(${d.dx}px,${d.dy}px,0)`;
});

/** Commit a finished drag: convert the pixel delta into a new map center. */
function finishMapDrag() {
  if (!mapDrag) return;
  const d = mapDrag;
  mapDrag = null;
  d.stage.classList.remove('dragging');
  if (d.moved) {
    d.view.userMoved = true;
    const center = mapProject(d.view.lon, d.view.lat, d.view.zoom);
    Object.assign(d.view, mapUnproject(center.x - d.dx, center.y - d.dy, d.view.zoom));
    d.stage.style.transform = '';
    renderMapView(d.map);
    // Mark the map so the click released after the drag is ignored, then
    // clear the flag after the event loop drains (click fires after pointerup).
    d.map.dataset.dragged = '1';
    setTimeout(() => delete d.map.dataset.dragged, 0);
    emit('map:view-changed', mapKindOf(d.map));
  }
}

window.addEventListener('pointerup', finishMapDrag);
window.addEventListener('pointercancel', finishMapDrag);

window.addEventListener('resize', () => {
  requestAnimationFrame(() => $$('#miniMap,.module-map').forEach(renderMapView));
});

/**
 * Wire pointer/wheel/zoom-control handlers onto a map element and repaint it.
 * Safe to call again after a shell re-render.
 * @param {string} [selector] - selector of the map element to bind.
 */
function setupMapInteraction(selector = '.module-map') {
  const map = $(selector);
  const stage = $('.map-stage', map);
  if (!map || !stage) return;
  const kind = mapKindOf(map);
  const view = state.mapViews[kind];
  renderMapView(map);

  map.onpointerdown = (e) => {
    if (e.target.closest('.map-controls') || e.target.closest('.map-grid-label a') || e.target.closest('.map-point-popup')) return;
    mapDrag = { map, stage, view, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    stage.classList.add('dragging');
  };

  // Zoom keeping the geographic point under (cx, cy) fixed: convert the
  // cursor offset to world pixels, scale by 2^(target-current), reproject.
  const setZoom = (next, cx = map.getBoundingClientRect().left + map.clientWidth / 2,
                   cy = map.getBoundingClientRect().top + map.clientHeight / 2) => {
    const current = clampMapZoom(view.zoom);
    const target = clampMapZoom(next);
    view.zoom = current;
    const old = mapProject(view.lon, view.lat, current);
    const rect = map.getBoundingClientRect();
    const px = cx - rect.left - map.clientWidth / 2;
    const py = cy - rect.top - map.clientHeight / 2;
    const k = 2 ** (target - current);
    const z = target;
    const point = { x: old.x + px, y: old.y + py };
    const newPoint = { x: point.x * k, y: point.y * k };
    const center = mapUnproject(newPoint.x - px, newPoint.y - py, z);
    view.zoom = z;
    view.lon = center.lon;
    view.lat = center.lat;
    view.userMoved = true;
    renderMapView(map);
    emit('map:view-changed', mapKindOf(map));
  };

  map.onwheel = (e) => {
    e.preventDefault();
    setZoom(view.zoom + (e.deltaY < 0 ? 1 : -1), e.clientX, e.clientY);
  };
  map.ondblclick = (e) => setZoom(view.zoom + 1, e.clientX, e.clientY);

  $$('.map-controls button', map).forEach((button) => {
    button.onclick = () => {
      if (button.dataset.action === 'reset') {
        if (kind === 'home') Object.assign(view, state.mapViews.homeReset);
        else if (kind === 'air' || kind === 'ship') focusPositionView(kind, kind === 'air' ? state.aircraft : state.ships);
        else Object.assign(view, { lat: 48, lon: 32, zoom: 5 });
        view.userMoved = false;
        renderMapView(map);
        emit('map:view-changed', kind);
      } else {
        setZoom(view.zoom + (button.dataset.action === 'in' ? 1 : -1));
      }
    };
  });
}

export { setupMapInteraction };
