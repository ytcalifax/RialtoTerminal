/**
 * News & Research module page: search controls and the article grid shell.
 */
import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';
import { loadNews, renderNewsModuleRows } from '../features/news.js';

/**
 * Render the news module into `root` and bind its controls.
 * @param {HTMLElement} root - the `#module` container.
 */
export function renderNewsPage(root) {
  root.innerHTML = `<div class="module-title"><span>NEWS &amp; RESEARCH <small>N &lt;GO&gt; · MULTI-SOURCE HEADLINES</small></span><span id="newsResultsCount">${state.news.length} RESULTS</span></div><div class="module-controls"><select id="newsFeed"><option value="global">GLOBAL · MULTI-PUBLISHER RSS + NEWS INDEX</option><option value="bulgaria">БЪЛГАРИЯ · Bulgarian publishers</option></select><input id="newsQuery" value="${esc(state.newsQuery)}" placeholder="Search headline terms, company, person…"><button class="primary" id="newsSearch">SEARCH</button><button id="newsClear">CLEAR</button><span class="source-badge">HEADLINES ONLY · OPEN ORIGINAL PUBLISHER</span></div><div class="article-grid" id="articleRows"></div><div class="news-detail" id="newsDetail">SELECT HEADLINE · SOURCE RSS / PUBLIC INDEX · ORIGINAL PUBLISHER LINKED</div><div class="panel-foot" id="newsFeedStatus">PUBLIC PUBLISHER RSS + GOOGLE NEWS INDEX · POLLED EVERY 3 MIN · PUBLISHER UPDATE TIMING VARIES</div>`;

  $('#newsFeed').value = state.feed;
  $('#newsSearch').onclick = () => loadNews($('#newsFeed').value, $('#newsQuery').value);
  $('#newsQuery').onkeydown = (e) => {
    if (e.key === 'Enter') loadNews($('#newsFeed').value, e.target.value);
  };
  $('#newsClear').onclick = () => {
    $('#newsQuery').value = '';
    loadNews($('#newsFeed').value);
  };
  renderNewsModuleRows();
}
