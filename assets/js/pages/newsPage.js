import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';
import { loadNews, renderNewsModuleRows } from '../features/news.js';

/**
 * Render the news module into `root` and bind its controls.
 * @param {HTMLElement} root - the `#module` container.
 */
export function renderNewsPage(root) {
  root.innerHTML = `<div class="module-title"><span>NEWS &amp; RESEARCH <small>N &lt;GO&gt; · MULTI-SOURCE HEADLINES · SEARCH &amp; FILTER</small></span><span class="module-title-actions"><span id="newsResultsCount">${state.news.length} RESULTS</span><button data-copy-data>COPY DATA</button></span></div><div class="module-controls"><select id="newsFeed"><option value="global">GLOBAL · MULTI-PUBLISHER RSS + NEWS INDEX</option><option value="bulgaria">BULGARIA · ENGLISH-LANGUAGE NEWS</option><option value="balkans">BALKANS · LOCAL + REGIONAL SOURCES</option></select><select id="newsCountry" aria-label="Filter Balkan news by country" hidden><option value="">ALL BALKAN COUNTRIES</option><option value="BG">BULGARIA</option><option value="RO">ROMANIA</option><option value="GR">GREECE</option><option value="RS">SERBIA</option><option value="MK">NORTH MACEDONIA</option><option value="AL">ALBANIA</option><option value="XK">KOSOVO</option><option value="ME">MONTENEGRO</option><option value="BA">BOSNIA AND HERZEGOVINA</option><option value="HR">CROATIA</option><option value="SI">SLOVENIA</option><option value="TR">TÜRKIYE</option><option value="MD">MOLDOVA</option></select><input id="newsQuery" value="${esc(state.newsQuery)}" placeholder="Search headline terms, company, person…"><button class="primary" id="newsSearch">SEARCH</button><button id="newsClear">CLEAR</button><span class="source-badge">HEADLINES ONLY · OPEN ORIGINAL PUBLISHER</span></div><div class="article-grid" id="articleRows"></div><div class="news-detail" id="newsDetail">SELECT HEADLINE · SOURCE RSS / PUBLIC INDEX · ORIGINAL PUBLISHER LINKED</div><div class="panel-foot" id="newsFeedStatus">PUBLIC PUBLISHER RSS + GOOGLE NEWS INDEX · POLLED EVERY 3 MIN · PUBLISHER UPDATE TIMING VARIES</div>`;

  const feedSelect = $('#newsFeed');
  const queryInput = $('#newsQuery');
  const searchButton = $('#newsSearch');
  const clearButton = $('#newsClear');
  const countrySelect = $('#newsCountry');
  feedSelect.value = state.feed;
  countrySelect.value = state.newsCountry;
  countrySelect.hidden = feedSelect.value !== 'balkans';
  feedSelect.onchange = () => {
    countrySelect.hidden = feedSelect.value !== 'balkans';
    loadNews(feedSelect.value, queryInput.value, countrySelect.value);
  };
  countrySelect.onchange = () => loadNews('balkans', queryInput.value, countrySelect.value);
  searchButton.onclick = () => loadNews(feedSelect.value, queryInput.value, countrySelect.value);
  queryInput.onkeydown = (e) => {
    if (e.key === 'Enter') loadNews(feedSelect.value, e.target.value, countrySelect.value);
  };
  clearButton.onclick = () => {
    queryInput.value = '';
    loadNews(feedSelect.value, '', countrySelect.value);
  };
  renderNewsModuleRows();
}
