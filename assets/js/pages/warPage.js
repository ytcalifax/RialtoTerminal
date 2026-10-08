/** Conflict-report map workspace. */
import { $, $$, esc } from '../core/dom.js';
import { state } from '../core/state.js';
import { mapShell } from '../maps/shells.js';
import { setupMapInteraction } from '../maps/interaction.js';
import { renderMapView } from '../maps/view.js';
import { loadWar } from '../features/conflict.js';

function reportRows() {
  return state.warReports.map((feature, index) => {
    const [lon, lat] = feature.geometry?.coordinates || [];
    const p = feature.properties || {};
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
    const names = Array.isArray(p.mentionednames) ? p.mentionednames.join(', ') : String(p.mentionednames || '');
    const themes = Array.isArray(p.mentionedthemes) ? p.mentionedthemes.join(', ') : String(p.mentionedthemes || '');
    const url = typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : '';
    return { id: `war-${index}`, name: p.name || 'REPORTED LOCATION', lat: Number(lat), lon: Number(lon), url, domain: p.domain || 'GDELT', names, themes, date: p.event_date || '', geores: Number(p.geores) };
  }).filter(Boolean);
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
  return reports.filter((report) => {
    const kind = report.themes.split(' · ')[0].toUpperCase();
    const matchesType = state.conflictType === 'ALL' || kind === state.conflictType;
    const haystack = `${report.name} ${report.domain} ${report.date} ${report.names} ${report.themes}`.toLocaleLowerCase();
    return matchesType && (!query || haystack.includes(query));
  });
}

function reportRowsHTML(reports) {
  return reports.map((x) => `<${x.url ? 'a' : 'div'} class="intel-row ${state.warSelectedId === x.id ? 'selected' : ''}" data-intel-id="${esc(x.id)}"${x.url ? ` href="${esc(x.url)}" target="_blank" rel="noopener"` : ''}><b>${esc(x.name)}</b><span>${esc(x.domain)} · ${esc(x.date)} · ${x.geores >= 3 ? 'LOCALITY' : 'AREA MENTION'}</span><small>${esc([x.names, x.themes].filter(Boolean).join(' · ') || 'CONFLICT COVERAGE')}</small></${x.url ? 'a' : 'div'}>`).join('');
}

function renderWarPage(root) {
  const data = reportRows();
  const filtered = filterReports(data);
  const rows = reportRowsHTML(filtered);
  const gpsDate = state.warGpsJam?.date || 'UNAVAILABLE';
  root.innerHTML = `<div class="module-title"><span>CONFLICT MONITOR<small>CON &lt;GO&gt; · REPORTS · FRONT LINE · GPS INTERFERENCE ${gpsDate}</small></span><span class="module-title-actions"><span class="source-badge">GDELT · UN OCHA · GPSJAM</span><button data-copy-data>COPY DATA</button></span></div><div class="module-controls"><button class="primary" id="intelRefresh">REFRESH REPORTS</button><input id="conflictQuery" value="${esc(state.conflictQuery)}" placeholder="Filter location, actor, source…" aria-label="Filter conflict reports"><select id="conflictType" aria-label="Filter reports by event type"><option value="ALL" ${state.conflictType === 'ALL' ? 'selected' : ''}>ALL EVENT TYPES</option><option value="ASSAULT" ${state.conflictType === 'ASSAULT' ? 'selected' : ''}>ASSAULT</option><option value="FIGHT" ${state.conflictType === 'FIGHT' ? 'selected' : ''}>FIGHT</option><option value="MASS VIOLENCE" ${state.conflictType === 'MASS VIOLENCE' ? 'selected' : ''}>MASS VIOLENCE</option></select><span class="source-badge" id="conflictCount">${filtered.length}/${data.length} REPORTS · ${state.warGpsJam?.features?.length || 0} GPS HEXES${state.errors.war ? ` · ${esc(state.errors.war)}` : ''}</span></div><div class="module-body intel-body"><div class="module-list intel-list">${rows || `<div class="empty-state">${data.length ? 'NO REPORTS MATCH THESE FILTERS' : esc(state.errors.war || 'WAITING FOR PUBLIC DATA')}</div>`}</div>${mapShell('war')}</div><div class="detail-row">GPSJAM HEXES: GREEN &lt;2% · YELLOW 2–10% · RED &gt;10%. AIRCRAFT-REPORTED GPS ACCURACY ANOMALIES, DAILY AGGREGATE; NOT VERIFIED JAMMER LOCATIONS. GDELT: NEWS-CODED EVENTS · OCHA: FRONT LINE.</div>`;

  const map = $('.module-map');
  map._tracks = filtered.map((x) => ({ ...x, id: x.id || x.name }));
  map._air = false;
  map._noSelect = true;
  map._mapLabel = `CONFLICT REPORTS + GPSJAM ${gpsDate} · CLICK A HEX OR DOT`;
  map._routeSegments = linesFromGeoJSON(state.warFrontline);
  map._coverageCells = state.warGpsJam?.features || [];
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
    popup.innerHTML = `<button class="map-point-popup-close" type="button" aria-label="Close event details">×</button><b>${esc(item.name)}</b><span>${esc(item.date)} · ${esc(item.domain)}</span><p>${esc(item.themes || 'CONFLICT EVENT')}</p><p>${esc(item.names || 'ACTORS NOT CODED')}</p>${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">OPEN ORIGINAL REPORT ↗</a>` : ''}`;
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
  const updateFilters = () => {
    state.conflictQuery = $('#conflictQuery').value;
    state.conflictType = $('#conflictType').value;
    const matches = filterReports(data);
    $('.intel-list').innerHTML = reportRowsHTML(matches) || `<div class="empty-state">NO REPORTS MATCH THESE FILTERS</div>`;
    $('#conflictCount').textContent = `${matches.length}/${data.length} REPORTS · ${state.warGpsJam?.features?.length || 0} GPS HEXES${state.errors.war ? ` · ${state.errors.war}` : ''}`;
    map._tracks = matches.map((x) => ({ ...x, id: x.id || x.name }));
    renderMapView(map);
  };
  $('#conflictQuery').oninput = updateFilters;
  $('#conflictType').onchange = updateFilters;
}

export { renderWarPage };
