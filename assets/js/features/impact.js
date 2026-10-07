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
  const market = (data.market || []).filter((row) => ['BZ=F', 'CL=F', 'NG=F', 'EURUSD=X', '^SOFIX'].includes(row.symbol));
  const weather = data.weather || [];
  const baselines = [
    ['AIS · FIXED BLACK SEA VIEW', data.ais],
    ['ADS-B · FIXED BLACK SEA VIEW', data.air],
  ];
  return `<section class="impact-observed"><h2>LIVE OBSERVATIONS</h2><h3>MARKETS · DAILY CHANGE</h3>${market.length ? `<ul>${market.map((row) => `<li><span>${esc(row.name || row.symbol)}</span><b class="${Number(row.pct) < 0 ? 'negative' : 'positive'}">${Number(row.pct) > 0 ? '+' : ''}${Number(row.pct).toFixed(2)}%</b>${sparkline(row.series)}</li>`).join('')}</ul>` : '<p class="impact-empty">Market snapshot unavailable.</p>'}<h3>WEATHER · NEXT 24H</h3><ul>${weather.map((row) => `<li><span>${esc(row.location)}</span><b>${Number(row.next_24h?.precipitation_mm || 0).toFixed(1)} MM · ${Number(row.next_24h?.max_wind_gust_kmh || 0).toFixed(0)} KM/H GUST</b><small>${esc(row.model_time || 'MODEL TIME UNKNOWN')} · FORECAST</small></li>`).join('') || '<li>Forecast unavailable.</li>'}</ul><h3>ACTIVITY BASELINES</h3><ul>${baselines.map(([label, item]) => {
    const baseline = item?.baseline || {};
    return `<li><span>${label}</span><b>${Number(item?.count || 0)} CURRENT · ${baseline.value == null ? 'BASELINE WARMING' : `${Number(baseline.value).toFixed(0)} MEDIAN`}</b><small>${baseline.samples || 0} SAME-REGION SAMPLES · ${baseline.hours || 0}H COLLECTED${baseline.value == null ? ' · NEED 24H / 24 SAMPLES' : ''}</small></li>`;
  }).join('')}</ul></section>`;
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
  content.innerHTML = `<div class="impact-grid"><section class="impact-signals"><h2>DEVELOPING SIGNALS <small>${signals.length} MEET CURRENT DISPLAY CRITERIA</small></h2>${signals.length ? signals.map((signal) => signalHTML(signal, now)).join('') : `<div class="impact-empty">No cross-source or direct-alert signal meets the current filters. Isolated changes remain observations, not alerts.</div>`}${sourceNotes ? `<div class="impact-degraded">SOURCE LIMITATIONS · ${esc(sourceNotes)}</div>` : ''}<div class="impact-method"><b>HOW TO READ THIS</b><span>Observed facts, derived signals and potential-impact assessments are separated in each evidence panel. Correlation does not establish cause. No signal is a prediction or official emergency instruction.</span></div></section>${renderObservationPanel(data.observations || {})}</div>`;
  const foot = $('#impactFoot');
  if (foot) foot.textContent = `${data.baseline_note} · LAST SNAPSHOT ${fmtTime(data.updated_at * 1000)} · EACH SOURCE RETAINS ITS OWN FRESHNESS STAMP`;
}

export { loadImpact, renderImpact };
