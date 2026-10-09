import { $, esc } from './dom.js';
import { state } from './state.js';

const bytes = (value) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const duration = (seconds) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
let latestSnapshot = null;

function renderDecisionDiagnostics(data) {
  const summary = $('#debugDecisionSummary');
  const inputs = $('#debugDecisionInputs');
  const list = $('#debugDecisions');
  if (!data?.evaluatedAt || !Array.isArray(data.rules)) {
    summary.textContent = 'Waiting for the first engine evaluation…';
    inputs.textContent = '';
    list.innerHTML = '<div class="debug-empty">NO DECISION DIAGNOSTICS AVAILABLE</div>';
    return;
  }
  const topics = data.selectedTopics?.length ? data.selectedTopics.join(' · ') : 'ALL TOPICS (NO TERMS SELECTED)';
  summary.textContent = `EVALUATED ${new Date(data.evaluatedAt).toLocaleTimeString()} · TOPIC FILTER: ${topics}`;
  const sourceCounts = data.inputs;
  inputs.innerHTML = sourceCounts
    ? `<b>INPUT VISIBILITY · ${esc(sourceCounts.topicFilter)}</b><span>HEADLINES ${sourceCounts.headlines.fresh}/${sourceCounts.headlines.considered} FRESH → ${sourceCounts.headlines.topicMatched} TOPIC MATCHED</span><span>CONFLICT REPORTS ${sourceCounts.conflictReports.fresh} FRESH → ${sourceCounts.conflictReports.topicMatched} TOPIC MATCHED → ${sourceCounts.conflictReports.uniqueTopicMatched} UNIQUE</span><span>OUTAGES ${sourceCounts.outages.fresh} FRESH → ${sourceCounts.outages.topicMatched} TOPIC MATCHED</span><span>OUTBREAKS ${esc(sourceCounts.outbreaks.feedStatus)} · ${sourceCounts.outbreaks.fresh} FRESH → ${sourceCounts.outbreaks.topicMatched} TOPIC MATCHED → ${sourceCounts.outbreaks.topicMatchedSevere} MATCHED SEVERE</span>`
    : '<b>INPUT VISIBILITY UNAVAILABLE</b>';
  list.innerHTML = data.rules.map((rule) => {
    const statusClass = rule.status === 'FIRED' ? 'fired' : rule.status === 'GATE CLOSED' ? 'closed' : 'below';
    const requirements = (rule.requirements || []).map((item) => `<div><b class="${item.passed ? 'pass' : 'fail'}">${item.passed ? '✓' : '·'}</b><span>${esc(item.label)} <small>+${item.weight}</small>${item.detail ? ` — ${esc(item.detail)}` : ' — no matching evidence'}</span></div>`).join('');
    const gates = (rule.gateChecks || []).map((check) => `<div><b class="${check.passed ? 'pass' : 'fail'}">${check.passed ? '✓' : '·'}</b>${esc(check.detail)}</div>`).join('');
    const effects = (rule.effects || []).map((effect) => `<span>${esc(effect.symbol)} ${esc(effect.name)} · expected ${esc(effect.dir)}${effect.observed ? ` · observed ${esc(effect.observed)}` : ` · ${esc(effect.quoteStatus || 'NO MATCHING QUOTE')}`}</span>`).join('');
    return `<article class="debug-rule"><div class="debug-rule-head"><b>${esc(rule.title)}</b><span class="debug-rule-status ${statusClass}">${esc(rule.status)}</span></div><div class="debug-rule-meta">SCORE ${rule.score}/${rule.maxScore} · MINIMUM ${rule.minScore}</div><div class="debug-rule-summary">${esc(rule.summary)}</div><div class="debug-rule-gate">GATE ${rule.gatePassed ? 'OPEN' : 'CLOSED'} · ${esc(rule.gateDescription)}${gates ? `<div class="debug-gate-checks">${gates}</div>` : ''}</div><div class="debug-rule-evidence">${requirements}</div><div class="debug-rule-effects">${effects}</div></article>`;
  }).join('') || '<div class="debug-empty">NO RULES EVALUATED</div>';
}

function renderDebugStats(data) {
  latestSnapshot = data;
  const totals = data.totals;
  $('#debugButton').textContent = `DEBUG · ${totals.requests}`;
  $('#debugSummary').textContent = `UP ${duration(data.uptime_seconds)} · ${totals.requests} CALLS · ${totals.in_flight} IN FLIGHT · ${totals.failures} FAILURES · UPLOAD ${bytes(totals.request_bytes)} · DOWNLOAD ${bytes(totals.response_bytes)} · AVG ${totals.average_duration_ms} MS`;
  $('#debugServices').innerHTML = data.services.length
    ? data.services.map((service) => `<tr><td><b>${esc(service.method)} ${esc(service.service)}</b><small>${esc(service.target)}</small></td><td>${service.requests}</td><td>${service.failures}</td><td>${bytes(service.request_bytes)}</td><td>${bytes(service.response_bytes)}</td><td>${service.average_duration_ms} ms</td><td>${esc(String(service.last_status))} · ${service.last_duration_ms ?? '—'} ms</td></tr>`).join('')
    : '<tr><td colspan="7">NO EXTERNAL REQUESTS RECORDED YET</td></tr>';
  $('#debugRecent').innerHTML = data.recent.length
    ? data.recent.slice(0, 80).map((item) => {
      const time = new Date(item.time * 1000).toLocaleTimeString();
      return `<div class="debug-request"><time>${esc(time)}</time><b>${esc(item.method)} ${esc(item.service)}${esc(item.target)}</b><span class="debug-request-status">${esc(String(item.status))}</span><small>${item.duration_ms == null ? 'IN FLIGHT' : `${item.duration_ms} ms`} · ↑ ${bytes(item.request_bytes)} · ↓ ${bytes(item.response_bytes)}${item.error ? ` · ${esc(item.error)}` : ''}</small></div>`;
    }).join('')
    : '<div class="debug-empty">NO RECENT EXTERNAL REQUESTS</div>';
}

async function copyDebugData(button) {
  if (!latestSnapshot) return;
  const serviceData = Object.fromEntries(
    Object.entries(latestSnapshot).filter(([key]) => key !== 'recent'),
  );
  const text = JSON.stringify({
    schema: 'rialto.api-debug.v1',
    exported_at: new Date().toISOString(),
    ...serviceData,
  }, null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) {
        button.textContent = 'COPY FAILED';
        setTimeout(() => { button.textContent = 'COPY JSON'; }, 1600);
        return;
      }
    }
    button.textContent = 'COPIED JSON';
    button.disabled = true;
    setTimeout(() => { button.textContent = 'COPY JSON'; button.disabled = false; }, 1600);
  } catch {
    button.textContent = 'COPY FAILED';
    setTimeout(() => { button.textContent = 'COPY JSON'; }, 1600);
  }
}

async function refreshDebugStats() {
  try {
    const response = await fetch('/api/debug/stats', { cache: 'no-store' });
    if (!response.ok) {
      $('#debugButton').hidden = true;
      $('#debugPanel').hidden = true;
      return false;
    }
    const data = await response.json();
    if (!data.enabled) {
      $('#debugButton').hidden = true;
      $('#debugPanel').hidden = true;
      return false;
    }
    $('#debugButton').hidden = false;
    renderDebugStats(data);
    renderDecisionDiagnostics(state.deductionDiagnostics);
    return true;
  } catch {
    $('#debugButton').hidden = true;
    $('#debugPanel').hidden = true;
    return false;
  }
}

function initDebugPanel() {
  const button = $('#debugButton');
  const panel = $('#debugPanel');
  refreshDebugStats();
  setInterval(refreshDebugStats, 3000);
  button.onclick = () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  };
  $('#debugClose').onclick = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  $('#debugCopy').onclick = (event) => copyDebugData(event.currentTarget);
  const handle = panel.querySelector('[data-debug-drag-handle]');
  let drag = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(window.innerWidth - Math.min(rect.width, 100), drag.left + event.clientX - drag.x));
    const top = Math.max(0, Math.min(window.innerHeight - Math.min(rect.height, 40), drag.top + event.clientY - drag.y));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  const stopDragging = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', stopDragging);
  handle.addEventListener('pointercancel', stopDragging);
}

export { initDebugPanel };
