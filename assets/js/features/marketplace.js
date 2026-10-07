/**
 * Marketplace feature: load and render listings from Bazar.bg search.
 * Results are metadata + outbound links; failures retain the last table and
 * surface a retry path instead of blanking the module.
 */
import { $, esc } from '../core/dom.js';
import { fmtTime } from '../core/format.js';
import { req } from '../core/net.js';
import { state } from '../core/state.js';

/**
 * Fetch listings for an optional keyword filter and repaint the module.
 * @param {string} [q] - keyword passed to Bazar.bg's search endpoint.
 */
async function loadMarketplace(q = '') {
  const tbody = $('#listingRows');
  const id = ++state.request.marketplace;
  const scrollTop = tbody?.scrollTop || 0;
  const focusedHref = document.activeElement?.closest('#listingRows a')?.href;
  if (tbody && !tbody.querySelector('table')) {
    tbody.innerHTML = `<div class="empty-state">SEARCHING BAZAR.BG${q ? ` FOR “${esc(q.toUpperCase())}”` : ' · ALL CATEGORIES'} · MAX 80 RESULTS…</div>`;
  }
  try {
    const r = await req(`/api/marketplace?q=${encodeURIComponent(q)}&limit=80`);
    if (id !== state.request.marketplace) return;
    const rows = r.items || [];
    state.timestamps.marketplace = r.fetched ? Number(r.fetched) * 1000 : Date.now();
    if ($('#marketplaceStatus')) {
      $('#marketplaceStatus').textContent = `${rows.length} RESULTS · ${r.source} · LIMIT 80 · ${fmtTime(state.timestamps.marketplace)} · AUTO 15M`;
    }
    if ($('#listingRows')) {
      $('#listingRows').innerHTML = rows.length
        ? `<table><thead><tr><th>LISTING / DESCRIPTION</th><th>LOCATION</th><th>POSTED</th><th>PRICE</th><th>SOURCE</th><th>OPEN</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.title)}</td><td class="location">${esc(x.location || '—')}</td><td class="posted">${esc(x.posted || '—')}</td><td class="price">${esc(x.price || '—')}</td><td>BAZAR.BG</td><td><a href="${esc(x.url)}" target="_blank" rel="noopener">VIEW ↗</a></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty-state">${q ? 'NO BAZAR.BG RESULTS FOR “' + esc(q.toUpperCase()) + '”' : 'NO PUBLIC LISTING METADATA RETURNED'}${r.error ? ' · ' + esc(r.error) : ''}<br><a href="${esc(r.url)}" target="_blank" rel="noopener">OPEN SEARCH ON BAZAR.BG ↗</a></div>`;
    }
    if (tbody) {
      tbody.scrollTop = scrollTop;
      if (focusedHref) [...tbody.querySelectorAll('a')].find((a) => a.href === focusedHref)?.focus({ preventScroll: true });
    }
  } catch (e) {
    if (id !== state.request.marketplace) return;
    if ($('#marketplaceStatus')) {
      $('#marketplaceStatus').textContent = `MARKETPLACE UPDATE FAILED · ${e.message} · RETAINING LAST RESULTS · AUTO 15M`;
    }
    if ($('#listingRows') && !tbody.querySelector('table')) {
      $('#listingRows').innerHTML = `<div class="empty-state">PUBLIC MARKETPLACE REQUEST FAILED · ${esc(e.message)}<br><a href="https://bazar.bg/obiavi" target="_blank" rel="noopener">OPEN BAZAR.BG ↗</a></div>`;
    }
  }
}

export { loadMarketplace };
