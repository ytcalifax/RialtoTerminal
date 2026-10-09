/** Conflict-report map workspace. */
import { $, $$, esc, safeExternalUrl } from '../core/dom.js';
import { state } from '../core/state.js';
import { CONFLICT_TYPE_OPTIONS, saveConflictTypes, saveConflictDateRange } from '../core/conflictFilters.js';
import { mapShell } from '../maps/shells.js';
import { setupMapInteraction } from '../maps/interaction.js';
import { renderMapView } from '../maps/view.js';
import { loadWar } from '../features/conflict.js';

function displayCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  const known = {
    OUTAGE_SEVERITY_MAJOR: 'MAJOR OUTAGE',
    OUTAGE_SEVERITY_TOTAL: 'TOTAL OUTAGE',
    OUTAGE_SEVERITY_PARTIAL: 'PARTIAL OUTAGE',
    OUTAGE_SEVERITY_UNSPECIFIED: 'SEVERITY UNREPORTED',
    GOVERNMENT_DIRECTED: 'GOVERNMENT-DIRECTED',
    UCDP_VIOLENCE_TYPE_STATE_BASED: 'STATE-BASED',
    UCDP_VIOLENCE_TYPE_NON_STATE: 'NON-STATE',
    UCDP_VIOLENCE_TYPE_ONE_SIDED: 'ONE-SIDED',
  };
  if (known[raw]) return known[raw];
  return raw.replace(/^(?:OUTAGE_SEVERITY_|UCDP_VIOLENCE_TYPE_)/, '')
    .replaceAll('_', ' ').replaceAll('-', ' ');
}

function day(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function reportRows() {
  return state.warReports.map((feature, index) => {
    const [lon, lat] = feature.geometry?.coordinates || [];
    const p = feature.properties || {};
    const names = Array.isArray(p.mentionednames) ? p.mentionednames.join(', ') : String(p.mentionednames || '');
    const themes = Array.isArray(p.mentionedthemes) ? p.mentionedthemes.join(', ') : String(p.mentionedthemes || '');
    const type = displayCode(themes.split(' · ')[0] || 'ASSAULT');
    const url = typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : '';
    const validPoint = lat != null && lon != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
    return { id: `war-${index}`, category: 'reports', type, typeLabel: type, name: p.name || 'REPORTED LOCATION', lat: validPoint ? Number(lat) : NaN, lon: validPoint ? Number(lon) : NaN, url, domain: p.domain || 'GDELT', names, themes, date: p.event_date || '', geores: Number(p.geores) };
  }).filter(Boolean);
}

function worldMonitorRows() {
  const wm = state.warWorldMonitor || {};
  const rows = [];
  const add = (type, category, items, mapItem) => items.forEach((item, index) => {
    const row = mapItem(item, index);
    if (row) rows.push({ category, type, typeLabel: type, geores: 0, ...row });
  });
  const coords = (item) => {
    const point = item.location || item.coordinates || item;
    return { lat: Number(point.latitude ?? point.lat), lon: Number(point.longitude ?? point.lon) };
  };
  add('ARMED CONFLICT', 'armed', wm.armed || [], (item, i) => {
    const point = coords(item);
    const violence = displayCode(item.violenceType || item.eventType || 'ARMED CONFLICT');
    return { id: `wm-armed-${item.id || i}`, name: item.locationName || item.admin1 || item.country || 'ARMED CONFLICT EVENT', ...point, domain: item.source || 'UCDP / ACLED', date: day(item.occurredAt || item.dateStart), names: [item.sideA, item.sideB, ...(item.actors || [])].filter(Boolean).join(' vs '), themes: `${violence} · ${item.fatalities ?? item.deathsBest ?? 0} FATALITIES` };
  });
  add('INTERNET DISRUPTION', 'outages', wm.outages || [], (item, i) => {
    const point = coords(item);
    const severity = displayCode(item.severity || 'OUTAGE');
    const cause = displayCode(item.cause || item.outageType || 'CAUSE UNKNOWN');
    return { id: `wm-outage-${item.id || i}`, name: item.title || `${item.country || 'INTERNET'} CONNECTIVITY DISRUPTION`, ...point, domain: 'CLOUDFLARE RADAR · WORLD MONITOR', date: day(item.detectedAt), names: [item.country, item.region].filter(Boolean).join(' · '), themes: `${severity} · ${cause}`, url: typeof item.link === 'string' && item.link.startsWith('https://') ? item.link : '' };
  });
  return rows;
}

function linesFromGeoJSON(features) {
  const lines = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry?.type === 'LineString') lines.push(geometry.coordinates);
    if (geometry?.type === 'MultiLineString') lines.push(...geometry.coordinates);
  }
  return lines;
}

function filterReports(reports) {
  const query = state.conflictQuery.trim().toLocaleLowerCase();
  const selectedTypes = new Set(state.conflictTypes);
  const { from, to } = state.conflictDateRange;
  return reports.filter((report) => {
    const haystack = `${report.name} ${report.domain} ${report.date} ${report.names} ${report.themes}`.toLocaleLowerCase();
    const inDateRange = !report.date || ((!from || report.date >= from) && (!to || report.date <= to));
    return selectedTypes.has(report.type) && inDateRange && (!query || haystack.includes(query));
  });
}

function hasMapPoint(item) {
  if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return false;
  return item.category !== 'reports' || item.geores >= 3;
}

function reportRowsHTML(reports) {
  return reports.map((item) => {
    const url = safeExternalUrl(item.url);
    const metadata = [item.typeLabel, item.date, item.domain].filter(Boolean).join(' · ');
    const themeParts = String(item.themes || '').split(' · ');
    const detailThemes = themeParts.filter((part) => displayCode(part) !== item.type).join(' · ');
    const detail = [item.names, detailThemes, item.category === 'reports' ? (item.geores >= 3 ? 'LOCALITY' : 'AREA MENTION') : ''].filter(Boolean).join(' · ');
    const mentionLink = url && !hasMapPoint(item);
    const title = `<div class="intel-row-title"><b>${esc(item.name)}</b>${mentionLink ? '<span class="external-indicator" aria-label="Mention only — open source link" title="Mention only · open source link">↗</span>' : ''}</div>`;
    return `<${url ? 'a' : 'div'} class="intel-row ${state.warSelectedId === item.id ? 'selected' : ''}" data-intel-id="${esc(item.id)}"${url ? ` href="${esc(url)}" target="_blank" rel="noopener"` : ''}>${title}<span>${esc(metadata)}</span><small>${esc(detail || 'CONFLICT COVERAGE')}</small></${url ? 'a' : 'div'}>`;
  }).join('');
}

function renderWarPage(root) {
  const data = [...reportRows(), ...worldMonitorRows()];
  const filtered = filterReports(data);
  const gpsDate = state.warGpsJam?.date || 'UNAVAILABLE';
  const frontlineDate = state.warFrontline.map((feature) => day(feature.properties?.date)).filter(Boolean).sort().at(-1) || 'UNAVAILABLE';
  const activeTypeCount = state.conflictTypes.length;
  root.innerHTML = `<div class="module-title"><span>CONFLICT MONITOR<small>CON &lt;GO&gt; · CONFLICT · INTERNET DISRUPTIONS</small></span><span class="module-title-actions"><span class="source-badge">GDELT · UN OCHA · GPSJAM · WORLD MONITOR</span><button data-copy-data>COPY DATA</button></span></div><div class="module-controls"><button class="primary" id="intelRefresh">REFRESH LAYERS</button><details class="event-type-filter map-layer-filter"><summary>≡ MAP LAYERS</summary><div class="event-type-options">${[['frontline', 'FRONT LINE', state.warShowFrontline], ['gpsjam', 'GPS HEXES', state.warShowGpsJam]].map(([id, label, enabled]) => `<label><input type="checkbox" data-map-layer="${id}" ${enabled ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></details><label class="source-badge" for="conflictDateFrom">FROM</label><input type="date" id="conflictDateFrom" value="${esc(state.conflictDateRange.from)}" aria-label="Show conflict events from date"><label class="source-badge" for="conflictDateTo">TO</label><input type="date" id="conflictDateTo" value="${esc(state.conflictDateRange.to)}" aria-label="Show conflict events through date"><input id="conflictQuery" value="${esc(state.conflictQuery)}" placeholder="Filter location, actor, source…" aria-label="Filter conflict reports"><details class="event-type-filter"><summary id="eventTypeSummary">EVENT TYPES · ${activeTypeCount}/${CONFLICT_TYPE_OPTIONS.length}</summary><div class="event-type-options">${CONFLICT_TYPE_OPTIONS.map((option) => `<label><input type="checkbox" data-event-type="${esc(option.id)}" ${state.conflictTypes.includes(option.id) ? 'checked' : ''}><span>${esc(option.label)}</span></label>`).join('')}</div></details><span class="source-badge" id="conflictCount">${filtered.length}/${data.length} ITEMS · ${state.warGpsJam?.features?.length || 0} GPS HEXES${state.errors.war ? ` · ${esc(state.errors.war)}` : ''}</span></div><div class="module-body intel-body"><div class="module-list intel-list">${reportRowsHTML(filtered) || `<div class="empty-state">${data.length ? 'NO REPORTS MATCH THESE FILTERS' : esc(state.errors.war || 'WAITING FOR PUBLIC DATA')}</div>`}</div>${mapShell('war')}</div><div class="detail-row">GPSJAM HEXES: GREEN &lt;2% · YELLOW 2–10% · RED &gt;10%. GPS ANOMALIES ARE NOT VERIFIED JAMMER LOCATIONS. UCDP / ACLED: ARMED EVENTS · INTERNET DISRUPTIONS: CLOUDFLARE RADAR.</div>`;

  const map = $('.module-map');
  map._tracks = filtered.filter(hasMapPoint).map((item) => ({ ...item, id: item.id || item.name }));
  map._air = false;
  map._noSelect = true;
  map._mapLabel = `FRONT LINE ${frontlineDate} · GPSJAM ${gpsDate} · CLICK A HEX OR DOT`;
  map._routeSegments = state.warShowFrontline ? linesFromGeoJSON(state.warFrontline) : [];
  map._coverageCells = state.warShowGpsJam ? (state.warGpsJam?.features || []) : [];
  map._selectedPointId = state.warSelectedId;
  const popup = document.createElement('aside');
  popup.className = 'map-point-popup';
  popup.hidden = true;
  map.append(popup);
  map._onPointClick = (item) => {
    state.warSelectedId = item.id;
    map._selectedPointId = item.id;
    $$('.map-point', map).forEach((point) => point.classList.toggle('selected', map._visibleTracks[Number(point.dataset.index)]?.id === item.id));
    $$('.intel-row[data-intel-id]').forEach((row) => row.classList.toggle('selected', row.dataset.intelId === item.id));
    $$('.intel-row.selected').find((row) => row.dataset.intelId === item.id)?.scrollIntoView({ block: 'nearest' });
    const url = safeExternalUrl(item.url);
    popup.innerHTML = `<button class="map-point-popup-close" type="button" aria-label="Close event details">×</button><b>${esc(item.name)}</b><span>${esc([item.typeLabel, item.date, item.domain].filter(Boolean).join(' · '))}</span><p>${esc(item.themes || 'CONFLICT EVENT')}</p><p>${esc(item.names || 'ACTORS NOT CODED')}</p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">OPEN ORIGINAL REPORT ↗</a>` : ''}`;
    popup.hidden = false;
    $('.map-point-popup-close', popup).onclick = () => { popup.hidden = true; };
  };
  map._onCoverageClick = (feature) => {
    if (!feature) return;
    const p = feature.properties || {};
    popup.innerHTML = `<button class="map-point-popup-close" type="button" aria-label="Close interference details">×</button><b>LOW GPS ACCURACY · ${esc(p.percent)}%</b><span>GPSJAM DAILY AGGREGATE · ${esc(p.date || gpsDate)}</span><p>${esc(p.bad || 0)} aircraft reported low navigation accuracy; ${esc(p.good || 0)} reported good accuracy.</p><a href="https://gpsjam.org/" target="_blank" rel="noopener">OPEN GPSJAM ↗</a>`;
    popup.hidden = false;
    $('.map-point-popup-close', popup).onclick = () => { popup.hidden = true; };
  };
  renderMapView(map);
  setupMapInteraction();
  $('#intelRefresh').onclick = () => loadWar(true);
  $$('[data-map-layer]').forEach((control) => {
    control.onchange = () => {
      if (control.dataset.mapLayer === 'frontline') state.warShowFrontline = control.checked;
      if (control.dataset.mapLayer === 'gpsjam') state.warShowGpsJam = control.checked;
      map._routeSegments = state.warShowFrontline ? linesFromGeoJSON(state.warFrontline) : [];
      map._coverageCells = state.warShowGpsJam ? (state.warGpsJam?.features || []) : [];
      renderMapView(map);
    };
  });

  const updateFilters = () => {
    state.conflictQuery = $('#conflictQuery').value;
    state.conflictDateRange = { from: $('#conflictDateFrom').value, to: $('#conflictDateTo').value };
    saveConflictDateRange(state.conflictDateRange);
    const matches = filterReports(data);
    $('.intel-list').innerHTML = reportRowsHTML(matches) || `<div class="empty-state">NO ITEMS MATCH THESE FILTERS</div>`;
    const summary = $('#eventTypeSummary');
    summary.textContent = `EVENT TYPES · ${state.conflictTypes.length}/${CONFLICT_TYPE_OPTIONS.length}`;
    $('#conflictCount').textContent = `${matches.length}/${data.length} ITEMS · ${state.warGpsJam?.features?.length || 0} GPS HEXES${state.errors.war ? ` · ${state.errors.war}` : ''}`;
    map._tracks = matches.filter(hasMapPoint).map((item) => ({ ...item, id: item.id || item.name }));
    renderMapView(map);
  };
  $('#conflictQuery').oninput = updateFilters;
  $('#conflictDateFrom').onchange = updateFilters;
  $('#conflictDateTo').onchange = updateFilters;
  $$('[data-event-type]').forEach((control) => {
    control.onchange = () => {
      state.conflictTypes = $$('[data-event-type]:checked').map((input) => input.dataset.eventType);
      saveConflictTypes(state.conflictTypes);
      updateFilters();
    };
  });
}

export { renderWarPage };
