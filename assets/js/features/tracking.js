/**
 * Tracking feature: AIS vessels and ADS-B aircraft.
 *
 * Responsibilities: normalising two very different upstream payloads into
 * one position-row shape, polling, the tracking module view (table + map +
 * filters), track history, the dashboard vessel peek, and the detail strip.
 *
 * Both payloads degrade the same way: on fetch failure the last positions
 * stay on screen and the health indicator shows the error.
 */
import { $, $$, esc } from '../core/dom.js';
import { ageLabel, fmtTime } from '../core/format.js';
import { req } from '../core/net.js';
import { setHealth, setStatus } from '../core/status.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { vesselTypeLabel, VESSEL_LOOKUP_URL, TRACK_REFETCH_DEBOUNCE_MS, MAX_COVERAGE_CELLS } from '../core/constants.js';
import { clampMapZoom, mapProject, mapUnproject } from '../maps/projection.js';
import { plotPoints, renderMapView } from '../maps/view.js';
import { homeMapShell } from '../maps/shells.js';
import { setupMapInteraction } from '../maps/interaction.js';

/** Fallback vessel region (the home Black Sea box) when no view is known. */
const HOME_VESSEL_BBOX = '40,25,46,41';
/** Fallback aircraft coverage: three home circles over the Black Sea. */
const HOME_AIR_CIRCLES = '43,33,250;43,27.5,250;43,38.5,250';

/**
 * Geographic footprint of a map viewport: the box for vessels and the
 * centre + half-diagonal reach for aircraft.
 */
function viewportBounds(view, mapEl) {
  const z = clampMapZoom(view.zoom);
  const w = mapEl?.clientWidth || 900;
  const h = mapEl?.clientHeight || 600;
  const center = mapProject(view.lon, view.lat, z);
  const tl = mapUnproject(center.x - w / 2, center.y - h / 2, z);
  const br = mapUnproject(center.x + w / 2, center.y + h / 2, z);
  const dLatNm = Math.abs(br.lat - tl.lat) * 60;
  const dLonNm = Math.abs(br.lon - tl.lon) * 60 * Math.max(0.2, Math.cos(view.lat * Math.PI / 180));
  const halfDiagNm = Math.sqrt(dLatNm * dLatNm + dLonNm * dLonNm) / 2;
  return {
    minLat: Math.min(tl.lat, br.lat), maxLat: Math.max(tl.lat, br.lat),
    minLon: Math.min(tl.lon, br.lon), maxLon: Math.max(tl.lon, br.lon),
    halfDiagNm,
  };
}

/**
 * Zoom-adaptive coverage: split the viewport into up to 2×2 cells so every
 * upstream request stays within its per-request caps (250 nm radius for
 * aircraft, 100 sq° for vessels). At low zoom the cells are sampled
 * clusters spread across the view; zooming in shrinks the viewport until a
 * single cell covers it at full density.
 * @returns {string[]} vessel boxes / air circles, encoded per the backend.
 */
function coverageCells(view, mapEl, mode) {
  const b = viewportBounds(view, mapEl);
  const dLat = b.maxLat - b.minLat;
  const dLon = b.maxLon - b.minLon;
  const split = mode === 'air'
    ? Math.min(2, Math.max(1, Math.ceil(b.halfDiagNm / 250)))
    : Math.min(2, Math.max(1, Math.ceil(Math.sqrt((dLat * dLon) / 100))));
  const cells = [];
  for (let r = 0; r < split; r++) {
    for (let c = 0; c < split; c++) {
      if (mode === 'air') {
        const lat = Math.max(-85, Math.min(85, b.minLat + dLat * ((r + 0.5) / split)));
        const lon = Math.max(-180, Math.min(180, b.minLon + dLon * ((c + 0.5) / split)));
        const cellLatNm = (dLat / split) * 60;
        const cellLonNm = (dLon / split) * 60 * Math.max(0.2, Math.cos(lat * Math.PI / 180));
        const radius = Math.round(Math.min(250, Math.max(25, Math.sqrt(cellLatNm ** 2 + cellLonNm ** 2) / 2)));
        cells.push(`${lat.toFixed(1)},${lon.toFixed(1)},${radius}`);
      } else {
        const minLat = b.minLat + dLat * (r / split);
        const maxLat = b.minLat + dLat * ((r + 1) / split);
        const minLon = b.minLon + dLon * (c / split);
        const maxLon = b.minLon + dLon * ((c + 1) / split);
        cells.push(`${minLat.toFixed(2)},${minLon.toFixed(2)},${maxLat.toFixed(2)},${maxLon.toFixed(2)}`);
      }
    }
  }
  return cells.slice(0, MAX_COVERAGE_CELLS);
}

/** Vessel coverage boxes for the current ships map view (or last known). */
function currentShipBoxes() {
  if (state.page === 'ships') return coverageCells(state.mapViews.ship, $('.module-map'), 'vessel').join(';');
  return state.shipsRegion || HOME_VESSEL_BBOX;
}

/** Aircraft coverage circles for the current air map view (or last known). */
function currentAirCircles() {
  if (state.page === 'air') return coverageCells(state.mapViews.air, $('.module-map'), 'air').join(';');
  return state.airRegion || HOME_AIR_CIRCLES;
}

/**
 * A tracking map was panned/zoomed: refetch that region (debounced so a
 * drag across many pointer events becomes one request). The dashboard
 * mini-map ('home') previews the data and does not drive fetches.
 */
const refetchTimers = { ship: null, air: null };
function trackingViewChanged(kind) {
  if (kind !== 'ship' && kind !== 'air') return;
  const page = kind === 'ship' ? 'ships' : 'air';
  if (state.page !== page) return;
  clearTimeout(refetchTimers[kind]);
  refetchTimers[kind] = setTimeout(() => {
    kind === 'ship' ? loadShips() : loadAir();
  }, TRACK_REFETCH_DEBOUNCE_MS);
}

/**
 * Normalise a GeoJSON FeatureCollection of vessels into position rows.
 * Upstream property names vary; every candidate is probed in order and
 * rows without usable coordinates are dropped. The numeric AIS type code
 * is decoded into a readable craft label here.
 */
function featureRows(collection) {
  return (collection?.features || []).map((f, i) => {
    const p = f.properties || {};
    const c = f.geometry?.coordinates || [];
    return {
      id: p.mmsi || p.MMSI || p.imo || p.name || `AIS-${i + 1}`,
      name: p.name || p.vessel_name || p.shipname || 'VESSEL',
      type: vesselTypeLabel(p.ship_type || p.type || p.vessel_type),
      speed: p.speed ?? p.sog ?? p.velocity,
      course: p.course ?? p.cog,
      lon: Number(c[0]),
      lat: Number(c[1]),
      age: p.age_s ?? (p.seen ? Math.max(0, Math.floor((Date.now() - new Date(p.seen)) / 1000)) : null),
      dest: p.destination || p.dest || '',
      raw: p,
      rawFeature: f,
      source: 'OPEN WATERS',
    };
  }).filter((x) => Number.isFinite(x.lon) && Number.isFinite(x.lat));
}

/** Normalise the adsb.lol ADS-B rows (already unit-normalised server-side). */
function aircraftRows(raw) {
  return (raw.aircraft || []).filter((a) => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon))).map((a) => ({
    id: a.id,
    name: (a.callsign || '').trim() || String(a.id || '').toUpperCase(),
    callsign: (a.callsign || '').trim(),
    reg: a.reg || '',
    type: a.type || '',
    lon: Number(a.lon),
    lat: Number(a.lat),
    alt: a.altM,
    ground: !!a.ground,
    speed: a.speedMs,
    course: a.course,
    vertical: a.vertRateMs,
    lastContact: a.lastContact,
    age: a.ageS,
    geoAlt: a.geoAltM,
    squawk: a.squawk || '',
    raw: a,
    source: 'ADSB.LOL',
  }));
}

/**
 * Build a diacritics-insensitive search blob over every field of a row.
 * Values are walked recursively so upstream payload changes stay searchable.
 */
function trackSearchText(item) {
  const values = [];
  const collect = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        values.push(key);
        collect(child);
      }
      return;
    }
    values.push(String(value));
  };
  collect(item);
  return values.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Poll the AIS snapshot for the current coverage boxes and repaint the vessels surfaces. */
async function loadShips() {
  if (state.refreshingShips) return;
  state.refreshingShips = true;
  setHealth('vessels', 'loading');
  try {
    const boxes = currentShipBoxes();
    const r = await req(`/api/vessels?boxes=${encodeURIComponent(boxes)}`);
    state.shipsRegion = boxes;
    state.ships = featureRows(r);
    state.vesselAttribution = r.attribution || {};
    state.timestamps.vessels = r.received_at ? Number(r.received_at) * 1000 : Date.now();
    setHealth('vessels', 'ok');
    state.errors.vessels = '';
    renderShips();
  } catch (e) {
    state.errors.vessels = e.message;
    setHealth('vessels', 'error', e.message);
    renderShips(e.message);
  } finally {
    state.refreshingShips = false;
  }
}

/** Poll the ADS-B snapshot for the current coverage circles and repaint the aircraft surfaces. */
async function loadAir() {
  if (state.refreshingAir) return;
  state.refreshingAir = true;
  setHealth('air', 'loading');
  try {
    const circles = currentAirCircles();
    const r = await req(`/api/air?circles=${encodeURIComponent(circles)}`);
    state.airRegion = circles;
    state.aircraft = aircraftRows(r);
    state.timestamps.air = r.time ? Number(r.time) * 1000 : Date.now();
    state.errors.air = r.error || '';
    setHealth('air', r.error ? 'delayed' : 'ok', r.error || '');
    renderAir();
  } catch (e) {
    state.errors.air = e.message;
    setHealth('air', 'error', e.message);
    renderAir();
  } finally {
    state.refreshingAir = false;
  }
}

/** Repaint the aircraft surfaces for the current page. */
function renderAir() {
  if (state.page === 'air') updateTrackingView();
}

/** Repaint the vessels surfaces for the current page. */
function renderShips(error = '') {
  if (state.page === 'top') renderDashboardShips();
  else if (state.page === 'ships') updateTrackingView();
}

/**
 * Repaint the shared tracking module view: filter + table + map + status.
 * Used by both the ships and aircraft pages; `air` picks the dataset.
 */
function updateTrackingView() {
  if (!['ships', 'air'].includes(state.page) || !$('#trackRows')) return;
  const air = state.page === 'air';
  const all = air ? state.aircraft : state.ships;
  const input = $('#trackQuery');
  const type = $('#trackType');
  if (input) state.trackQuery = input.value;
  state.trackQueries[air ? 'air' : 'ships'] = state.trackQuery;
  if (type) state.trackMoving = type.value === 'moving';

  const q = state.trackQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = all.filter((x) =>
    (!q || trackSearchText(x).includes(q))
    && (!state.trackMoving || (air ? !x.ground : (x.speed ?? 0) > .5)));

  renderTrackTable(filtered, air);
  const map = $('.module-map');
  plotPoints(filtered, air, $('.map-point-layer', map));

  $$('#trackRows tr[data-track-id]').forEach((tr) => {
    tr.onclick = () => selectTrack(filtered[Number(tr.dataset.index)], air, true);
    tr.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTrack(filtered[Number(tr.dataset.index)], air, true);
      }
    };
  });

  const stamp = state.timestamps[air ? 'air' : 'vessels'];
  const status = $('#trackStatus');
  if (status) status.textContent = `${filtered.length} POSITIONS · ${air ? 'SOURCE AS OF' : 'CHECKED'} ${fmtTime(stamp)} · AUTO 60S${state.errors[air ? 'air' : 'vessels'] ? ' · FEED DELAYED' : ''}`;

  if (state.selectedTrack) {
    const updated = all.find((x) => x.id === state.selectedTrack.id);
    if (updated) {
      state.selectedTrack = updated;
      const detail = $('.detail-row');
      if (detail) {
        const cachedInfo = air && state.airInfo?.id === updated.id ? state.airInfo.info : undefined;
        detail.innerHTML = detailHTML(updated, air, cachedInfo);
      }
    }
  }
}

/** Repaint the dashboard vessel peek: recent ships list + mini map. */
function renderDashboardShips() {
  const rows = state.ships.slice(0, 6);
  const map = $('#miniMap');
  const shipList = $('#shipLines');
  const shipScroll = shipList?.scrollTop || 0;
  // Focus preservation: remember which list row / map marker was active.
  const activeShip = document.activeElement?.closest('#shipLines [data-ship-index]');
  const activeShipId = activeShip ? state.ships[Number(activeShip.dataset.shipIndex)]?.id : null;
  const activeMarker = document.activeElement?.closest('#miniMap .map-point');
  const activeMapId = activeMarker ? map?._visibleTracks?.[Number(activeMarker.dataset.index)]?.id : null;

  // Recentre the home map on the freshest reports (unless the user panned).
  const freshest = [...state.ships].sort((a, b) => (a.age ?? Number.MAX_SAFE_INTEGER) - (b.age ?? Number.MAX_SAFE_INTEGER)).slice(0, 6);
  if (freshest.length) {
    const lat = freshest.reduce((n, x) => n + x.lat, 0) / freshest.length;
    const lon = freshest.reduce((n, x) => n + x.lon, 0) / freshest.length;
    const zoom = state.mapViews.home.userMoved ? state.mapViews.home.zoom : 8;
    if (!state.mapViews.home.userMoved) Object.assign(state.mapViews.home, { lat, lon, zoom });
    Object.assign(state.mapViews.homeReset, { lat, lon, zoom, userMoved: false });
  }

  $('#shipCount').textContent = state.ships.length ? `${state.ships.length} POSITIONS${state.errors.vessels ? ' · DELAYED' : ''}` : 'NO DATA';
  shipList.innerHTML = rows.length
    ? rows.map((x, i) => `<button class="ship-row" data-ship-index="${i}"><b>${esc(x.name)}</b><span>${x.speed != null ? Number(x.speed).toFixed(1) + ' kn' : 'AIS'}</span><span>${ageLabel(x.age)}</span></button>`).join('')
    : `<div class="loading">${state.errors.vessels ? 'AIS FEED ERROR · ' + esc(state.errors.vessels) : 'NO POSITIONS IN CURRENT AIS SNAPSHOT · COVERAGE DEPENDS ON RECEIVER NETWORK'}</div>`;
  shipList.scrollTop = shipScroll;

  if (map) {
    map.innerHTML = homeMapShell();
    plotPoints(state.ships, false, $('.map-point-layer', map));
    setupMapInteraction('#miniMap');
    if (activeMapId) {
      const index = map._visibleTracks.findIndex((x) => x.id === activeMapId);
      $$('.map-point', map).find((x) => Number(x.dataset.index) === index)?.focus({ preventScroll: true });
    }
  }
  if (activeShipId) {
    const index = rows.findIndex((x) => x.id === activeShipId);
    if (index >= 0) $$('[data-ship-index]', shipList).find((x) => Number(x.dataset.shipIndex) === index)?.focus({ preventScroll: true });
  }

  const credits = Object.values(state.vesselAttribution);
  const foot = $('.ship-peek .panel-foot');
  if (foot && credits.length) foot.firstChild.textContent = `AIS source credit: ${credits.join(' · ').slice(0, 170)} `;

  $$('[data-ship-index]').forEach((el) => {
    el.onclick = () => {
      const x = rows[Number(el.dataset.shipIndex)];
      emit('navigate', 'ships');
      state.selectedTrack = x;
      emit('module:rerender');
      selectTrack(x, false, true);
    };
  });
}

/** Repaint the tracking rows table for the module list column. */
function renderTrackTable(items, air) {
  const tbody = $('#trackRows');
  if (!tbody) return;
  const list = tbody.closest('.module-list');
  const scrollTop = list?.scrollTop || 0;
  const focusId = document.activeElement?.closest('#trackRows tr[data-track-id]')?.dataset.trackId;

  tbody.innerHTML = items.map((x, i) => `<tr tabindex="0" data-index="${i}" data-track-id="${esc(x.id)}" class="${state.selectedTrack?.id === x.id ? 'chosen' : ''}"><td>${esc(x.name)}</td><td>${Number(x.lat).toFixed(3)}</td><td>${Number(x.lon).toFixed(3)}</td><td>${air ? (x.alt == null ? '—' : Math.round(x.alt)) : (x.speed == null ? '—' : Number(x.speed).toFixed(1))}</td><td>${ageLabel(x.age)}</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty-state">${state.errors[air ? 'air' : 'vessels'] ? `${air ? 'ADSB.LOL' : 'AIS'} FEED ERROR · ${esc(state.errors[air ? 'air' : 'vessels'])}` : `NO POSITIONS IN CURRENT ${air ? 'ADSB.LOL' : 'AIS'} SNAPSHOT · COVERAGE DEPENDS ON RECEIVER NETWORK`}</td></tr>`;

  if (list) list.scrollTop = scrollTop;
  if (focusId) {
    const row = $$('[data-track-id]', tbody).find((el) => el.dataset.trackId === focusId);
    row?.focus({ preventScroll: true });
  }
}

/**
 * Select a position: highlight everywhere, show its detail, fetch its track
 * history and draw the route. From the dashboard it first jumps to the
 * tracking page, then re-runs the selection there.
 * @param {object} x - position row.
 * @param {boolean} [air] - true for aircraft.
 * @param {boolean} [centerMap] - recenter the active map on the position.
 */
async function selectTrack(x, air = false, centerMap = false) {
  state.selectedTrack = x;
  const map = state.page === 'top' ? $('#miniMap') : $('.module-map');
  if (centerMap && map) {
    const kind = map.id === 'miniMap' ? 'home' : map.dataset.mapKind || (air ? 'air' : 'ship');
    state.mapViews[kind].lat = x.lat;
    state.mapViews[kind].lon = x.lon;
    renderMapView(map);
  }
  $$('#trackRows tr').forEach((tr) => tr.classList.toggle('chosen', tr.dataset.trackId === String(x.id)));
  if (map) {
    $$('.map-point', map).forEach((p) => p.classList.toggle('selected', map.dataset.trackIds.split('|')[Number(p.dataset.index)] === String(x.id)));
  }
  const detail = $('.detail-row');
  if (detail) detail.innerHTML = detailHTML(x, air);

  if (state.page === 'top') {
    setStatus(`${air ? 'AIRCRAFT' : 'VESSEL'} ${x.name} · ${x.id}`);
    emit('navigate', air ? 'air' : 'ships');
    if (!air) {
      const view = state.mapViews.ship;
      view.lat = x.lat;
      view.lon = x.lon;
      view.zoom = state.mapViews.home.zoom;
      view.userMoved = false;
      renderMapView($('.module-map'));
    }
    selectTrack(x, air, false);
    return;
  }

  const route = $('.route-layer path');
  if (route) route.setAttribute('d', '');
  if (map) {
    map._routeCoords = null;
    map.classList.toggle('air-track', air);
  }
  if (air) enrichAirDetail(x); // fills brand/model/airline/route/photo async
  const reqId = ++state.request.track;
  setTrajectoryState('REQUESTING PUBLIC TRACK HISTORY…');
  try {
    const endpoint = air
      ? `/api/air-track?icao24=${encodeURIComponent(x.id)}`
      : `/api/vessel-track?mmsi=${encodeURIComponent(x.id)}`;
    const r = await req(endpoint);
    if (reqId !== state.request.track || state.selectedTrack?.id !== x.id) return;
    let coords = [];
    if (air) {
      coords = (r.path || []).filter((p) => p[1] != null && p[2] != null).map((p) => [p[2], p[1]]);
    } else {
      const g = r.geometry || r.features?.[0]?.geometry;
      coords = g?.type === 'LineString' ? g.coordinates : [];
    }
    if (coords.length < 2) {
      setTrajectoryState('NO PUBLIC TRACK HISTORY FOR THIS POSITION');
      return;
    }
    map._routeCoords = coords;
    setTrajectoryState(`PUBLIC TRACK · ${coords.length} WAYPOINTS · ${air ? 'OPENSKY' : 'OPEN WATERS AIS'}`);
    renderMapView(map);
  } catch (e) {
    if (reqId === state.request.track) setTrajectoryState(`TRACK HISTORY UNAVAILABLE · ${e.message}`);
  }
}

/** Write a message into the track-history status strip. */
function setTrajectoryState(message) {
  const el = $('#trackTrajectoryStatus');
  if (el) el.textContent = message;
}

/**
 * Look up registry + route details for the selected aircraft (adsbdb via
 * the backend) and re-render the detail strip when they arrive. Best
 * effort: a failed lookup leaves the basic detail in place.
 * @param {object} x - the selected aircraft row.
 */
async function enrichAirDetail(x) {
  const id = ++state.request.airInfo;
  try {
    const info = await req(`/api/air-info?id=${encodeURIComponent(x.id)}&callsign=${encodeURIComponent(x.callsign || '')}`);
    if (id !== state.request.airInfo || state.selectedTrack?.id !== x.id) return;
    state.airInfo = { id: x.id, info };
    const detail = $('.detail-row');
    if (detail) detail.innerHTML = detailHTML(x, true, info);
  } catch (e) {
    state.airInfo = { id: x.id, info: { aircraft: null, route: null, error: e.message } };
  }
}

/**
 * HTML for the detail strip under the tracking module.
 * @param {object} x - position row.
 * @param {boolean} [air] - true renders the aircraft field set.
 * @param {object} [info] - adsbdb enrichment for aircraft ({aircraft, route});
 *   when omitted the enrichable fields render as pending ellipses.
 */
function detailHTML(x, air = false, info) {
  if (air) {
    const ac = info?.aircraft || null;
    const rt = info?.route || null;
    const pending = (v) => v ?? (info ? '—' : '…'); // '…' while lookup runs, '—' when answered
    const airport = (a) => a ? `${esc(a.city || a.name || a.code)} ${a.code ? '(' + esc(a.code) + ')' : ''}` : null;
    const fromA = airport(rt?.from);
    const toA = airport(rt?.to);
    const airline = rt?.airline || ac?.owner || null;
    const photo = ac?.photo
      ? `<a class="trade-link" href="${esc(ac.photo)}" target="_blank" rel="noopener" title="Photo of ${esc(ac.registration || 'this airframe')}">PHOTO ↗</a>`
      : (info ? '—' : '…');
    return `<span>CALLSIGN <b>${esc(x.name)}</b></span><span>ICAO24 <b>${esc(x.id)}</b></span><span>REG <b>${esc(x.reg || '—')}</b></span><span>BRAND <b>${pending(ac?.brand || null)}</b></span><span>MODEL <b>${pending(ac?.model || null)}</b></span><span>AIRLINE <b>${pending(airline)}</b></span><span>FROM <b>${fromA || (info ? '—' : '…')}</b></span><span>TO <b>${toA || (info ? '—' : '…')}</b></span><span>POSITION <b>${Number(x.lat).toFixed(4)}° / ${Number(x.lon).toFixed(4)}°</b></span><span>BARO ALT <b>${x.alt != null ? Math.round(x.alt) + ' m' : x.ground ? 'GND' : '—'}</b></span><span>GEO ALT <b>${x.geoAlt != null ? Math.round(x.geoAlt) + ' m' : '—'}</b></span><span>SPEED <b>${x.speed != null ? Math.round(x.speed * 1.94384) + ' kt' : '—'}</b></span><span>TRACK <b>${x.course != null ? Math.round(x.course) + '°' : '—'}</b></span><span>VERT RATE <b>${x.vertical != null ? Math.round(x.vertical * 196.85) + ' ft/min' : '—'}</b></span><span>SQUAWK <b>${esc(x.squawk || '—')}</b></span><span>LAST CONTACT <b>${x.lastContact ? fmtTime(x.lastContact * 1000) : '—'}</b></span><span class="detail-photo">${photo}</span>`;
  }
  const p = x.raw || {};
  // MarineTraffic shells bot traffic to its home page; VesselFinder's name
  // search reliably lands on the vessel (photos, voyage, operator).
  const photos = VESSEL_LOOKUP_URL + encodeURIComponent(x.name || '');
  return `<span>VESSEL <b>${esc(x.name)}</b></span><span>MMSI <b>${esc(x.id)}</b></span><span>IMO <b>${esc(p.imo || p.IMO || '—')}</b></span><span>FLAG <b>${esc(p.flag || '—')}</b></span><span>TYPE <b>${esc((x.type || 'AIS').toUpperCase())}</b></span><span>DEST <b>${esc(x.dest || '—')}</b></span><span>POSITION <b>${Number(x.lat).toFixed(4)}° / ${Number(x.lon).toFixed(4)}°</b></span><span>SOG <b>${x.speed != null ? Number(x.speed).toFixed(1) + ' kn' : '—'}</b></span><span>COG <b>${x.course != null ? Math.round(x.course) + '°' : '—'}</b></span><span>DRAUGHT <b>${p.draught != null ? Number(p.draught).toFixed(1) + ' m' : '—'}</b></span><span>DIMENSIONS <b>${p.length || '—'} × ${p.beam || '—'} m</b></span><span>LAST HEARD <b>${ageLabel(x.age)}</b></span><span class="detail-photo"><a class="trade-link" href="${esc(photos)}" target="_blank" rel="noopener" title="VesselFinder: photos, voyage and operator details">PHOTOS & VOYAGE ↗</a></span>`;
}

export {
  loadShips, loadAir, renderShips, renderDashboardShips,
  updateTrackingView, renderTrackTable, selectTrack, detailHTML,
  trackingViewChanged,
};
