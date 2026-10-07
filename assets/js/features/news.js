/**
 * News feature: feed loading, filtering, dashboard + module rendering, and
 * the news chrome bindings (feed tabs, topic chips, refresh buttons).
 *
 * All upstream data passes through `esc` before entering template literals.
 * Rendering preserves scroll position and keyboard focus across repaints so
 * the terminal stays keyboard-first.
 */
import { $, $$, esc } from '../core/dom.js';
import { fmtTime, newsTimestamp, timeAgo } from '../core/format.js';
import { req } from '../core/net.js';
import { setHealth, setStatus } from '../core/status.js';
import { state } from '../core/state.js';
import { TOPIC_TERMS } from '../core/constants.js';

/**
 * Load the merged news payload and repaint every news surface.
 * @param {string} [feed] - 'global' | 'bulgaria' | 'balkans'.
 * @param {string} [query] - headline search term.
 * @param {string} [country] - Balkan country code.
 */
async function loadNews(feed = state.feed, query = state.newsQuery || '', country = state.newsCountry) {
  state.feed = feed;
  state.newsCountry = feed === 'balkans' ? country : '';
  state.newsQuery = query.trim();
  const id = ++state.request.news; // superseded responses are dropped below
  setHealth('news', 'loading');
  updateNewsStatus('UPDATING PUBLIC FEEDS · AUTO 3M');
  try {
    const result = await req(`/api/news?feed=${encodeURIComponent(feed)}&q=${encodeURIComponent(query)}&country=${encodeURIComponent(state.newsCountry)}`);
    if (id !== state.request.news) return;
    state.newsSources = result.sources || [];
    const sourceCount = result.sourceCount || 0;
    const failed = state.newsSources.length - sourceCount;
    if (sourceCount || !state.news.length) {
      state.news = (result.items || []).sort((a, b) => newsTimestamp(b.published) - newsTimestamp(a.published));
      state.timestamps.news = Date.now();
    }
    state.errors.news = failed ? `${failed} FEED${failed === 1 ? '' : 'S'} UNAVAILABLE` : '';
    setHealth('news', failed ? 'delayed' : 'ok', state.errors.news);
    renderNews();
    const feedLabel = feed === 'bulgaria' ? 'BULGARIA · EN' : feed === 'balkans' ? `BALKANS${state.newsCountry ? ` · ${state.newsCountry}` : ''}` : 'GLOBAL';
    const status = `${state.news.length} STORIES · ${sourceCount}/${state.newsSources.length} FEEDS · ${feedLabel} · ${fmtTime(state.timestamps.news)} · AUTO 3M`;
    updateNewsStatus(status);
    const lsh = $('#leadSubhead');
    if (lsh) lsh.textContent = `${feedLabel} HEADLINES · ${query ? 'SEARCH: ' + query.toUpperCase() : 'PUBLIC FEEDS'}`;
  } catch (e) {
    if (id !== state.request.news) return;
    state.errors.news = e.message;
    setHealth('news', 'error', e.message);
    renderNews();
    updateNewsStatus(`FEED ERROR · ${e.message} · LAST DATA RETAINED · AUTO 3M`);
    const lsh = $('#leadSubhead');
    if (lsh) lsh.textContent = 'PUBLIC FEED STATUS · LAST SUCCESSFUL HEADLINES RETAINED';
    setStatus(`NEWS FEED ERROR · ${e.message}`);
  }
}

/** Update the dashboard news status only when that surface is mounted. */
function updateNewsStatus(message) {
  const element = $('#newsStatus');
  if (element) element.textContent = message;
}

/** Repaint the dashboard lead stories + compact news column. */
function renderNews() {
  const rows = state.news;
  const storyColumn = $('.story-column');
  const compact = $('#compactNews');
  // Preserve scroll position and focus across the repaint.
  const leadScroll = storyColumn?.scrollTop || 0;
  const compactScroll = compact?.scrollTop || 0;
  const activeRow = document.activeElement?.closest('.story[data-news-url],.compact-row[data-news-url]');
  const focusArea = activeRow?.closest('#leadStories,#compactNews');
  const focusUrl = activeRow?.dataset.newsUrl;
  const focusHref = document.activeElement?.closest('a')?.href;
  const lead = $('#leadStories');

  if (lead) {
    lead.innerHTML = rows.length
      ? rows.slice(0, 8).map((x, i) => `<div tabindex="0" class="story ${i === 0 ? 'featured' : ''} ${state.selectedNews === x.url ? 'selected' : ''}" data-news-url="${esc(x.url)}"><span class="story-num">${String(i + 1).padStart(2, '0')}</span><div><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="story-meta">${esc(x.source || 'NEWS')} · ${esc(x.region || 'GLOBAL')} · ${esc(x.category || 'NEWS')}</span></div><span class="story-time">${timeAgo(x.published)}</span></div>`).join('')
      : `<div class="empty-state">${state.errors.news ? 'NEWS SERVICE UNAVAILABLE · ' + esc(state.errors.news) : 'NO MATCHING HEADLINES · CHANGE FEED OR QUERY'}</div>`;
  }

  const visible = state.filter === 'all' ? rows
    : state.filter === 'bulgaria' ? rows.filter((x) => x.region === 'BULGARIA')
    : state.filter === 'europe' ? rows.filter((x) => x.region === 'EUROPE')
    : state.filter === 'balkans' ? rows.filter((x) => x.region === 'BALKANS' || x.region === 'BULGARIA')
    : rows.filter((x) => TOPIC_TERMS[state.filter]?.test(x.title) || String(x.category || '').toLowerCase() === state.filter);

  if (compact) {
    compact.innerHTML = visible.slice(0, 12).map((x) => `<div tabindex="0" class="compact-row ${state.selectedNews === x.url ? 'selected' : ''}" data-news-url="${esc(x.url)}"><span class="source">${esc((x.source || 'NEWS').slice(0, 12))}</span><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><time>${timeAgo(x.published)}</time></div>`).join('')
      || `<div class="empty-state">${state.errors.news ? 'PUBLIC FEED ERROR · ' + esc(state.errors.news) : 'NO HEADLINES MATCH THIS FILTER'}</div>`;
  }

  bindNewsRows();
  if (storyColumn) storyColumn.scrollTop = leadScroll;
  if (compact) compact.scrollTop = compactScroll;
  if (focusUrl && focusArea) {
    const target = $$('[data-news-url]', focusArea).find((row) => row.dataset.newsUrl === focusUrl);
    const link = focusHref && target ? [...target.querySelectorAll('a')].find((a) => a.href === focusHref) : null;
    (link || target)?.focus({ preventScroll: true });
  }
  if (state.page === 'news') renderNewsModuleRows();
}

/** Highlight a headline row and mirror its metadata into the detail strip. */
function selectNewsRow(row) {
  state.selectedNews = row.dataset.newsUrl;
  $$('[data-news-url]').forEach((x) => x.classList.toggle('selected', x.dataset.newsUrl === state.selectedNews));
  const x = state.news.find((item) => item.url === state.selectedNews);
  if (x) {
    setStatus(`${x.source} · ${x.region} · ${x.category} · ${fmtTime(newsTimestamp(x.published))} · OPEN PUBLISHER LINK`);
    const d = $('#newsDetail');
    if (d) d.innerHTML = `${esc(x.source)} · ${esc(x.region)} · ${esc(x.category)} · ${fmtTime(newsTimestamp(x.published))} · <a href="${esc(x.url)}" target="_blank" rel="noopener">OPEN PUBLISHER ↗</a>`;
  }
}

/** Bind click/keyboard activation on every headline row (all surfaces). */
function bindNewsRows() {
  $$('.story[data-news-url],.compact-row[data-news-url],.article-row[data-news-url]').forEach((row) => {
    row.onclick = () => selectNewsRow(row);
    row.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
        e.preventDefault();
        selectNewsRow(row);
      }
    };
  });
}

/** Repaint the news module page (article grid, counts, feed footer). */
function renderNewsModuleRows() {
  const body = $('#articleRows');
  if (!body) return;
  const scrollTop = body.scrollTop;
  const active = document.activeElement?.closest('#articleRows .article-row[data-news-url]');
  const focusUrl = active?.dataset.newsUrl;
  const focusHref = document.activeElement?.closest('a')?.href;

  body.innerHTML = state.news.map((x) => `<div tabindex="0" class="article-row ${state.selectedNews === x.url ? 'selected' : ''}" data-news-url="${esc(x.url)}"><span class="src">${esc(x.source || 'NEWS')}</span><div><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><small>${esc(x.region || 'GLOBAL')} · ${esc(x.category || 'NEWS')} · ${esc(x.language || '')} · ${esc(x.timeType || 'PUBLISHED')}</small></div><time>${timeAgo(x.published)}</time></div>`).join('')
    || '<div class="empty-state">No active publisher headlines. Source failures are isolated; retry after the next feed interval or broaden search.</div>';
  body.scrollTop = scrollTop;

  const count = $('#newsResultsCount');
  if (count) count.textContent = `${state.news.length} RESULTS · ${state.newsSources.filter((x) => x.ok).length}/${state.newsSources.length} FEEDS`;
  const detail = $('#newsDetail');
  const selected = state.news.find((x) => x.url === state.selectedNews);
  if (detail && selected) {
    detail.innerHTML = `${esc(selected.source)} · ${esc(selected.region)} · ${esc(selected.category)} · ${fmtTime(newsTimestamp(selected.published))} · <a href="${esc(selected.url)}" target="_blank" rel="noopener">OPEN PUBLISHER ↗</a>`;
  }
  const footer = $('#newsFeedStatus');
  if (footer) {
    const good = state.newsSources.filter((x) => x.ok).length;
    const bad = state.newsSources.length - good;
    footer.textContent = `${good}/${state.newsSources.length} FEEDS RESPONDING${bad ? ` · ${bad} OFFLINE` : ' · ALL AVAILABLE'} · PUBLIC RSS / GOOGLE NEWS · POLL 3M`;
  }
  bindNewsRows();
  if (focusUrl) {
    const row = $$('[data-news-url]', body).find((el) => el.dataset.newsUrl === focusUrl);
    const link = focusHref && row ? [...row.querySelectorAll('a')].find((a) => a.href === focusHref) : null;
    (link || row)?.focus({ preventScroll: true });
  }
}

/** Bind the static news chrome: refresh buttons, feed tabs, topic chips. */
function initNewsChrome() {
  $$('[data-refresh="news"]').forEach((b) => {
    b.onclick = () => loadNews(state.feed);
  });

  $$('.feed-tab').forEach((b) => {
    b.onclick = () => {
      state.filter = b.dataset.feed === 'bulgaria' ? 'bulgaria' : 'all';
      $$('.feed-tab').forEach((x) => x.classList.toggle('on', x === b));
      $$('.filter-chip').forEach((x) => {
        const active = x.dataset.filter === state.filter;
        x.classList.toggle('active', active);
        x.setAttribute('aria-pressed', String(active));
      });
      loadNews(b.dataset.feed);
    };
  });

  $$('.filter-chip').forEach((b) => {
    b.onclick = () => {
      state.filter = b.dataset.filter;
      $$('.filter-chip').forEach((x) => {
        const active = x === b;
        x.classList.toggle('active', active);
        x.setAttribute('aria-pressed', String(active));
      });
      const activeFeed = state.filter === 'bulgaria' ? 'bulgaria' : state.filter === 'balkans' ? 'balkans' : 'global';
      $$('.feed-tab').forEach((x) => x.classList.toggle('on', x.dataset.feed === activeFeed));
      if (state.filter === 'bulgaria') loadNews('bulgaria');
      else if (state.filter === 'balkans') loadNews('balkans');
      else if (state.feed !== 'global') loadNews('global');
      else renderNews();
    };
  });
}

export { loadNews, renderNews, renderNewsModuleRows, initNewsChrome };
