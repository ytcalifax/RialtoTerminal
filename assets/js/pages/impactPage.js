/** Balkan-first, evidence-led risk and impact monitor. */
import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';
import { renderImpact } from '../features/impact.js';

export function renderImpactPage(root) {
  root.innerHTML = `<div class="module-title"><span>EARLY WARNING <small>GLOBAL + REGIONAL OBSERVATIONS · POTENTIAL PERSONAL / BALKAN IMPACT</small></span><span class="source-badge" id="impactUpdated">WAITING FOR LIVE SOURCES</span></div><div class="module-controls"><select id="impactGeography" aria-label="Filter impact assessments by relevance"><option value="ALL">ALL IMPACT RELEVANCE</option><option value="PERSONAL / LOCAL">PERSONAL / LOCAL</option><option value="BULGARIA">BULGARIA</option><option value="BALKANS">BALKANS</option><option value="EUROPE">EUROPE</option><option value="GLOBAL">GLOBAL</option></select><select id="impactSeverity" aria-label="Filter potential impact assessments by severity"><option value="ALL">ALL POTENTIAL IMPACT</option><option value="HIGH">HIGH</option><option value="MEDIUM">MEDIUM</option><option value="LOW">LOW</option></select><button class="primary" id="impactRefresh">REFRESH DATA</button><span class="source-badge" id="impactStatus">CONNECTING TO PUBLIC SOURCES</span><small>Filters affect assessments; all loaded observations stay below.</small></div><div class="impact-source-strip" id="impactSources"></div><div class="impact-content" id="impactContent"><div class="empty-state">LOADING VERIFIED OBSERVATIONS. NO PREDICTION IS CERTAIN.</div></div><div class="panel-foot" id="impactFoot">GLOBAL CONTEXT CAN AFFECT REGIONAL ENERGY / TRADE · FORECASTS ARE NOT OFFICIAL ALERTS · BASELINES WARM FROM THIS SERVER’S OBSERVATIONS</div>`;
  const geography = $('#impactGeography');
  const severity = $('#impactSeverity');
  geography.value = state.impactGeography;
  severity.value = state.impactSeverity;
  geography.onchange = () => { state.impactGeography = geography.value; renderImpact(); };
  severity.onchange = () => { state.impactSeverity = severity.value; renderImpact(); };
  $('#impactRefresh').onclick = () => loadImpact(true);
  if (state.impact) renderImpact();
}
