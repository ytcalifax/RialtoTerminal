/** Impact workspace data loading and evidence-first rendering. */
import { $, esc } from '../core/dom.js';
import { fmtTime, timeAgo } from '../core/format.js';
import { req } from '../core/net.js';
import { setStatus } from '../core/status.js';
import { state } from '../core/state.js';

const geographyMatches = (signal, filter) => {
  if (filter === 'ALL') return true;
  const geography = String(signal.relevance || '').toUpperCase();
  return filter === 'PERSONAL / LOCAL'
    ? geography.includes('PERSONAL') || geography.includes('LOCAL')
    : geography.includes(filter);
};

async function loadImpact(force = false) {
  if (state.impact && !force) return renderImpact();
  const requestId = ++state.request.impact;
  const status = $('#impactStatus');
  if (status) status.textContent = 'REFRESHING PUBLIC SIGNALS…';
  try {
    const payload = await req('/api/impact');
    if (requestId !== state.request.impact) return;
    state.impact = payload;
    renderImpact();
  } catch (error) {
    if (requestId !== state.request.impact) return;
    const content = $('#impactContent');
    if (content && !state.impact) content.innerHTML = `<div class="empty-state">PUBLIC SIGNALS UNAVAILABLE · ${esc(error.message)}</div>`;
    else renderImpact();
    const statusEl = $('#impactStatus');
    if (statusEl) statusEl.textContent = `DEGRADED · ${esc(error.message)}`;
    setStatus(`IMPACT DATA DEGRADED · ${error.message}`);
  }
}

function sourceAge(source, now) {
  const stamp = Number(source.asof || 0);
  if (!stamp) return source.ok ? 'AGE UNKNOWN' : 'NO DATA';
  const age = Math.max(0, now - (stamp > 10_000_000_000 ? stamp / 1000 : stamp));
  if (age < 60) return `${Math.round(age)}S`;
  if (age < 3600) return `${Math.floor(age / 60)}M`;
  return `${Math.floor(age / 3600)}H`;
}

function sparkline(values) {
  const points = (values || []).map(Number).filter(Number.isFinite);
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const span = Math.max(0.00001, Math.max(...points) - min);
  const coords = points.map((value, index) => `${(index / (points.length - 1) * 100).toFixed(1)},${(22 - (value - min) / span * 18).toFixed(1)}`);
  return `<svg class="impact-spark" viewBox="0 0 100 24" aria-label="Recent quote series"><polyline points="${coords.join(' ')}"></polyline></svg>`;
}

function observationHTML(item) {
  const value = esc(item.value ?? '—');
  const observed = item.observed_at
    ? (typeof item.observed_at === 'number' ? fmtTime(item.observed_at * (item.observed_at < 10_000_000_000 ? 1000 : 1)) : esc(item.observed_at))
    : 'TIME NOT PROVIDED';
  const source = esc(item.source || 'PUBLIC SOURCE');
  const url = /^https?:\/\//i.test(item.source_url || '') ? item.source_url : '';
  const location = Array.isArray(item.location) && item.location.length >= 2
    ? `<a class="impact-map-link" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(item.location[1])}&mlon=${encodeURIComponent(item.location[0])}#map=8/${encodeURIComponent(item.location[1])}/${encodeURIComponent(item.location[0])}" target="_blank" rel="noopener">MAP ↗</a>`
    : '';
  return `<li><span class="impact-observation-label">${esc(item.label || 'Observation')}</span><b>${value}</b><small>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${source} ↗</a>` : source} · ${observed} ${location}</small>${sparkline(item.series)}</li>`;
}

function sourceAnchor(url, label) {
  return /^https?:\/\//i.test(url || '')
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`
    : esc(label);
}

function headlineRows(rows) {
  return rows.map((row) => `<li><span>${esc(row.region || row.category || 'GLOBAL')}</span><b>${sourceAnchor(row.url, row.title || 'Headline')}</b><small>${esc(row.source || 'NEWS')} · ${row.published ? timeAgo(row.published) : 'TIME UNKNOWN'}</small></li>`).join('');
}

function eventRows(rows, kind) {
  return rows.map((feature) => {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [];
    const point = Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number'
      ? `<a class="impact-map-link" href="https://www.openstreetmap.org/?mlat=${coords[1]}&mlon=${coords[0]}#map=6/${coords[1]}/${coords[0]}" target="_blank" rel="noopener">MAP ↗</a>` : '';
    if (kind === 'quake') {
      return `<li><span>M${Number(props.mag || 0).toFixed(1)} · ${esc(props.place || 'LOCATION UNKNOWN')}</span><b>${sourceAnchor(props.url, 'USGS EVENT')}</b><small>${props.time ? fmtTime(props.time) : 'TIME UNKNOWN'} · ${point}</small></li>`;
    }
    const url = typeof props.url === 'object' ? props.url?.report : props.url;
    return `<li><span>${esc(String(props.alertlevel || 'ALERT').toUpperCase())} · ${esc(props.eventtype || 'EVENT')}</span><b>${sourceAnchor(url, props.name || 'GDACS ALERT')}</b><small>${esc(props.country || (Array.isArray(props.affectedcountries) ? props.affectedcountries : []).map((x) => typeof x === 'string' ? x : x.countryname || x.name || '').filter(Boolean).join(', ') || 'LOCATION AS REPORTED')} · ${esc(props.fromdate || props.datemodified || 'TIME UNKNOWN')} · ${point}</small></li>`;
  }).join('');
}

function conflictRows(conflict) {
  return (conflict.reports || []).map((feature) => {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [];
    const point = coords.length >= 2
      ? `<a class="impact-map-link" href="https://www.openstreetmap.org/?mlat=${coords[1]}&mlon=${coords[0]}#map=6/${coords[1]}/${coords[0]}" target="_blank" rel="noopener">MAP ↗</a>` : '';
    return `<li><span>${esc(props.name || 'REPORTED LOCATION')} · ${esc(props.event_date || 'DATE UNKNOWN')}</span><b>${sourceAnchor(props.url, props.mentionednames || 'GDELT REPORT')}</b><small>${esc(props.mentionedthemes || 'Media-derived coded event')} · ${esc(props.domain || 'GDELT')} · ${point}</small></li>`;
  }).join('');
}

function positionRows(rows, kind) {
  return rows.map((row) => {
    const label = kind === 'air'
      ? (row.callsign || row.id || 'AIRCRAFT')
      : (row.name || row.mmsi || 'VESSEL');
    const speed = kind === 'air'
      ? (row.speedMs == null ? 'SPEED N/A' : `${(Number(row.speedMs) * 1.94384).toFixed(1)} KN`)
      : (row.speed == null ? 'SPEED N/A' : `${Number(row.speed).toFixed(1)} KN`);
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const location = Number.isFinite(lat) && Number.isFinite(lon)
      ? `<a class="impact-map-link" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=9/${lat}/${lon}" target="_blank" rel="noopener">${lat.toFixed(2)}, ${lon.toFixed(2)} ↗</a>`
      : 'POSITION N/A';
    return `<li><span>${esc(label)} · ${esc(row.chokepoint || row.mmsi || row.id || '')}</span><b>${esc(speed)}</b><small>${location}${row.ageS == null ? '' : ` · ${Number(row.ageS)}S OLD`}</small></li>`;
  }).join('');
}

function signalHTML(signal, now) {
  const observations = signal.observations || [];
  const confidenceNote = signal.confidence === 'LOW'
    ? 'LOW CONFIDENCE · LIMITED OR MODEL-DEPENDENT EVIDENCE'
    : signal.confidence === 'MEDIUM'
      ? 'MEDIUM CONFIDENCE · MULTIPLE OBSERVATIONS, CAUSAL LINK UNCONFIRMED'
      : 'HIGH CONFIDENCE IN SOURCE OBSERVATION · LOCAL IMPACT MAY DIFFER';
  const headlineTag = signal.media_count === 0
    ? '<span class="impact-tag muted">NO RELATED HEADLINE FOUND IN MONITORED SAMPLE</span>' : '';
  return `<article class="impact-card impact-${esc(String(signal.severity || 'low').toLowerCase())}"><header><span class="impact-priority">POTENTIAL ${esc(signal.severity)} IMPACT</span><span class="impact-state">${esc(signal.status)}</span><time>${timeAgo(signal.updated_at * 1000)}</time></header><h3>${esc(signal.title)}</h3><p class="impact-summary">${esc(signal.summary)}</p><div class="impact-tags"><span>${esc(signal.relevance)}</span><span>${esc(signal.horizon)}</span>${headlineTag}</div><details><summary>WHY FLAGGED · ${observations.length} OBSERVATIONS · ${esc(signal.components.join(' + '))}</summary><ul class="impact-evidence">${observations.map(observationHTML).join('')}</ul><div class="impact-method"><b>${confidenceNote}</b><span>Confidence is about the evidence supporting this watch, not certainty that a future impact will occur.</span><span>FIRST DETECTED ${fmtTime(signal.first_detected * 1000)} · LAST CHANGED ${fmtTime(signal.last_changed * 1000)} · UPDATED ${sourceAge({ asof: signal.updated_at }, now)} AGO</span></div></details></article>`;
}

function renderObservationPanel(data) {
  const allMarkets = data.market || [];
  const market = allMarkets.filter((row) => ['BZ=F', 'CL=F', 'NG=F', 'RB=F', 'HO=F', 'EURUSD=X', 'USDTRY=X', '^SOFIX'].includes(row.symbol));
  const weather = data.weather || [];
  const news = data.news || [];
  const earthquakes = [...new Map(
    [...(data.earthquakes || []), ...(data.world_earthquakes || [])]
      .map((row) => [row.id || row.properties?.code || JSON.stringify(row.geometry?.coordinates || []), row]),
  ).values()];
  const gdacs = data.gdacs || [];
  const conflict = data.conflict || {};
  const chokepoints = data.chokepoints || {};
  const baselines = [
    ['AIS · FIXED BLACK SEA VIEW', data.ais],
    ['ADS-B · FIXED BLACK SEA VIEW', data.air],
  ];
  const keyMarkets = market.length ? `<ul>${market.map((row) => `<li><span>${esc(row.name || row.symbol)}</span><b class="${Number(row.pct) < 0 ? 'negative' : 'positive'}">${Number(row.pct) > 0 ? '+' : ''}${Number(row.pct).toFixed(2)}%</b>${sparkline(row.series)}</li>`).join('')}</ul>` : '<p class="impact-empty">Key prices unavailable.</p>';
  const output = `<section class="impact-observed"><h2>LIVE OBSERVATIONS <small>GLOBAL + REGIONAL · FILTERS APPLY TO SIGNALS ONLY</small></h2><h3>ENERGY / FX · DAILY CHANGE</h3>${keyMarkets}<details class="impact-observation-details"><summary>ALL TRACKED MARKET ROWS · ${allMarkets.length}</summary><ul>${allMarkets.map((row) => `<li><span>${esc(row.name || row.symbol)} · ${esc(row.group || '')}</span><b class="${Number(row.pct) < 0 ? 'negative' : 'positive'}">${Number(row.pct) > 0 ? '+' : ''}${Number(row.pct || 0).toFixed(2)}%</b><small>${esc(row.symbol)} · ${esc(row.currency || '')} · AS OF ${fmtTime(Number(row.asof || 0) * (Number(row.asof || 0) < 10_000_000_000 ? 1000 : 1))}</small></li>`).join('') || '<li>No additional market rows.</li>'}</ul></details><h3>GLOBAL / REGIONAL HEADLINES · ${news.length}</h3><ul>${headlineRows(news.slice(0, 8)) || '<li>No news rows returned.</li>'}</ul><details class="impact-observation-details"><summary>ALL LOADED HEADLINES · ${news.length}</summary><ul>${headlineRows(news) || '<li>No headlines returned.</li>'}</ul></details><h3>GEOPHYSICAL / DISASTER EVENTS · ${earthquakes.length + gdacs.length}</h3><details class="impact-observation-details"><summary>USGS EARTHQUAKES · ${earthquakes.length} (BALKANS M2.5+ / WORLD M4.5+)</summary><ul>${eventRows(earthquakes, 'quake') || '<li>No matching USGS events in the current lookback.</li>'}</ul></details><details class="impact-observation-details"><summary>GDACS RED / ORANGE ALERTS · ${gdacs.length} WORLDWIDE</summary><ul>${eventRows(gdacs, 'gdacs') || '<li>No current alerts returned.</li>'}</ul></details><h3>CONFLICT / GNSS · GLOBAL SOURCE DATA</h3><ul><li><span>UKRAINE FRONTLINE</span><b>${Number(conflict.frontline_segments || 0)} SEGMENTS</b><small>${sourceAnchor('https://gis.unocha.org/', conflict.frontline_source || 'UN OCHA public layer')}</small></li><li><span>GPSJAM DAILY AGGREGATE</span><b>${Number(conflict.gpsjam_cells || 0)} CELLS · ${esc(conflict.gpsjam_date || 'DATE UNKNOWN')}</b><small>Aircraft-reported navigation accuracy anomalies; not proof of jamming or cause.</small></li></ul><details class="impact-observation-details"><summary>UKRAINE FRONTLINE GEOMETRY · ${(conflict.frontline || []).length} FEATURES</summary><ul>${(conflict.frontline || []).map((feature, index) => `<li><span>FEATURE ${index + 1} · ${esc(feature.geometry?.type || 'GEOMETRY')}</span><b>PUBLIC CONFLICT MAP LAYER</b><small>${esc(JSON.stringify(feature.properties || {}))}</small></li>`).join('') || '<li>No frontline geometry returned.</li>'}</ul></details><details class="impact-observation-details"><summary>GDELT CODED EVENT REPORTS · ${(conflict.reports || []).length}</summary><ul>${conflictRows(conflict) || '<li>No coded reports returned.</li>'}</ul></details><details class="impact-observation-details"><summary>GPSJAM HIGHEST REPORTED CELLS · ${(conflict.gpsjam_top || []).length}</summary><ul>${(conflict.gpsjam_top || []).map((feature) => { const props = feature.properties || {}; return `<li><span>${esc(props.date || conflict.gpsjam_date || 'DAILY')}</span><b>${Number(props.percent || 0).toFixed(1)}% AIRCRAFT-REPORTED ANOMALY</b><small>${Number(props.bad || 0)} AFFECTED · ${Number(props.good || 0)} UNAFFECTED</small></li>`; }).join('') || '<li>No cells returned.</li>'}</ul></details><h3>MARITIME · GLOBAL CHOKEPOINT SAMPLES</h3><ul>${(chokepoints.items || []).map((row) => `<li><span>${esc(row.name)}</span><b>${Number(row.count_25nm || 0)} AIS REPORTS WITHIN 25 NM</b></li>`).join('') || '<li>Global chokepoint AIS snapshot unavailable.</li>'}</ul><small>${Number(chokepoints.position_count || 0)} positions sampled · one current snapshot does not establish a closure or congestion trend.</small><h3>REGIONAL WEATHER · NEXT 24H</h3><ul>${weather.map((row) => `<li><span>${esc(row.location)}</span><b>${Number(row.next_24h?.precipitation_mm || 0).toFixed(1)} MM · ${Number(row.next_24h?.max_wind_gust_kmh || 0).toFixed(0)} KM/H GUST</b><small>${Number(row.current?.temperature_2m ?? 0).toFixed(1)}°C NOW · ${Number(row.current?.wind_speed_10m ?? 0).toFixed(0)} KM/H WIND · ${esc(row.model_time || 'MODEL TIME UNKNOWN')} · FORECAST</small></li>`).join('') || '<li>Forecast unavailable.</li>'}</ul><h3>ACTIVITY BASELINES · BULGARIA / BLACK SEA</h3><ul>${baselines.map(([label, item]) => {
    const baseline = item?.baseline || {};
    return `<li><span>${label}</span><b>${Number(item?.count || 0)} CURRENT · ${baseline.value == null ? 'BASELINE WARMING' : `${Number(baseline.value).toFixed(0)} MEDIAN`}</b><small>${baseline.samples || 0} SAME-REGION SAMPLES · ${baseline.hours || 0}H COLLECTED${baseline.value == null ? ' · NEED 24H / 24 SAMPLES' : ''}</small></li>`;
  }).join('')}</ul></section>`;
  return output.replace('</section>', `<details class="impact-observation-details"><summary>CHOKEPOINT AIS BASELINES · SERVER SAMPLE HISTORY</summary><ul>${(chokepoints.items || []).map((row) => { const baseline = row.baseline || {}; return `<li><span>${esc(row.name)}</span><b>${Number(row.count_25nm || 0)} CURRENT · ${baseline.value == null ? 'BASELINE WARMING' : `${Number(row.change_pct || 0) > 0 ? '+' : ''}${Number(row.change_pct || 0).toFixed(0)}% VS ${Number(baseline.hours || 0).toFixed(0)}H MEDIAN`}</b><small>${baseline.samples || 0} SAME-WINDOW SAMPLES · ${baseline.value == null ? 'NEED 24H / 24 SAMPLES' : `${Number(baseline.value).toFixed(0)} REPORTS MEDIAN`}</small></li>`; }).join('') || '<li>No chokepoint counts returned.</li>'}</ul></details><details class="impact-observation-details"><summary>ALL GLOBAL CHOKEPOINT AIS POSITIONS · ${(chokepoints.vessels || []).length}</summary><ul>${positionRows(chokepoints.vessels || [], 'ship') || '<li>No positions returned.</li>'}</ul></details><details class="impact-observation-details"><summary>ALL BULGARIA / BLACK SEA AIS POSITIONS · ${(data.ais_positions || []).length}</summary><ul>${positionRows(data.ais_positions || [], 'ship') || '<li>No positions returned.</li>'}</ul></details><details class="impact-observation-details"><summary>ALL BULGARIA / BLACK SEA ADS-B AIRCRAFT · ${(data.aircraft || []).length}</summary><ul>${positionRows(data.aircraft || [], 'air') || '<li>No positions returned.</li>'}</ul></details></section>`);
}

function renderImpact() {
  const data = state.impact;
  const content = $('#impactContent');
  if (!data || !content) return;
  const now = Date.now() / 1000;
  const signals = (data.signals || []).filter((signal) => geographyMatches(signal, state.impactGeography)
    && (state.impactSeverity === 'ALL' || signal.severity === state.impactSeverity));
  const sources = $('#impactSources');
  if (sources) sources.innerHTML = (data.sources || []).map((source) => `<span class="impact-source ${source.ok ? source.stale ? 'stale' : 'online' : 'offline'}" title="${esc(source.error || source.detail || source.name)}"><i></i>${esc(source.name)} ${sourceAge(source, now)} · ${source.count ?? 0}</span>`).join('');
  const updated = $('#impactUpdated');
  if (updated) updated.textContent = `UPDATED ${fmtTime(data.updated_at * 1000)} · ${timeAgo(data.updated_at * 1000)}`;
  const status = $('#impactStatus');
  if (status) status.textContent = `${data.status} · ${data.healthy_sources}/${data.source_count} SOURCES · ${signals.length} SIGNALS`;
  const sourceNotes = (data.sources || []).filter((source) => !source.ok || source.stale)
    .map((source) => `${source.name}: ${source.stale ? 'STALE' : source.error || 'UNAVAILABLE'}`).join(' · ');
  content.innerHTML = `<div class="impact-grid"><section class="impact-signals"><h2>DEVELOPING SIGNALS <small>${signals.length} MEET CURRENT DISPLAY CRITERIA</small></h2>${signals.length ? signals.map((signal) => signalHTML(signal, now)).join('') : `<div class="impact-empty">No assessment currently crossed the selected criteria. All observations continue to load below, including global reporting, markets, conflict data, alerts, and activity.</div>`}${sourceNotes ? `<div class="impact-degraded">SOURCE LIMITATIONS · ${esc(sourceNotes)}</div>` : ''}<div class="impact-method"><b>HOW TO READ THIS</b><span>Observed facts, derived signals and potential-impact assessments are separated in each evidence panel. Correlation does not establish cause. No signal is a prediction or official emergency instruction.</span></div></section>${renderObservationPanel(data.observations || {})}</div>`;
  const foot = $('#impactFoot');
  if (foot) foot.textContent = `${data.baseline_note} · LAST SNAPSHOT ${fmtTime(data.updated_at * 1000)} · EACH SOURCE RETAINS ITS OWN FRESHNESS STAMP`;
}

export { loadImpact, renderImpact };
