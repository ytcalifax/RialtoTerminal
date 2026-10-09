import { $, esc } from './dom.js';

const bytes = (value) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const duration = (seconds) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
let latestSnapshot = null;

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
      if (!copied) throw new Error('Clipboard unavailable');
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
}

export { initDebugPanel };
