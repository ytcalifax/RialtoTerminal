/** Alert preferences and recent activity workspace. */
import { state } from '../core/state.js';
import { initAlertsPage } from '../core/notifications.js';

export function renderAlertsPage(root) {
  root.innerHTML = `<div class="module-title"><span>ALERTS &amp; TRENDS <small>ALT &lt;GO&gt; · PERSONAL SIGNALS · LOCAL PREFERENCES</small></span><span class="module-title-actions"><span class="source-badge" id="alertRecentCount">${state.notifications.length} RECENT</span></span></div>
    <div class="alerts-layout">
      <div class="alerts-settings">
        <section class="alert-card alert-subscriptions">
          <div class="alert-card-head"><span><i class="dot orange"></i> SUBSCRIPTIONS</span><small>CHOOSE WHAT SHOULD REACH YOU</small></div>
          <label class="alert-option"><span class="alert-option-icon">N</span><span class="alert-option-copy"><b>Headline matches</b><small>New stories that match your selected terms</small></span><input id="alertNews" type="checkbox" aria-label="Subscribe to headline alerts"><span class="switch"></span></label>
          <label class="alert-option"><span class="alert-option-icon conflict">!</span><span class="alert-option-copy"><b>Conflict updates</b><small>New reports added to the conflict feed</small></span><input id="alertConflict" type="checkbox" aria-label="Subscribe to conflict alerts"><span class="switch"></span></label>
          <label class="alert-option"><span class="alert-option-icon market">↗</span><span class="alert-option-copy"><b>Market moves</b><small>Instruments moving beyond your threshold</small></span><input id="alertMarkets" type="checkbox" aria-label="Subscribe to market move alerts"><span class="switch"></span></label>
          <label class="alert-option"><span class="alert-option-icon">V</span><span class="alert-option-copy"><b>Vessel reports</b><small>New vessels detected in active coverage</small></span><input id="alertVessels" type="checkbox" aria-label="Subscribe to vessel alerts"><span class="switch"></span></label>
          <label class="alert-option"><span class="alert-option-icon">A</span><span class="alert-option-copy"><b>Aircraft reports</b><small>New aircraft detected in active coverage</small></span><input id="alertAircraft" type="checkbox" aria-label="Subscribe to aircraft alerts"><span class="switch"></span></label>
          <div class="alert-keywords"><div class="alert-section-title"><span>HEADLINE TERMS</span><small>REMOVE ANY TERM WITH ×</small></div><div id="alertKeywordChips" class="alert-keyword-chips"></div><div class="alert-add-term"><input id="alertKeywordAdd" placeholder="Add a term or phrase" aria-label="Add headline alert term"><button id="addAlertKeyword" type="button">ADD TERM <b>＋</b></button></div></div>
          <div class="alert-filter-grid">
            <label class="alert-filter"><span><b>Conflict report terms</b><small>Comma separated; blank matches all reports</small></span><input id="alertConflictTerms" type="text" placeholder="e.g. Black Sea, border"></label>
            <label class="alert-filter"><span><b>Vessel name or destination</b><small>Comma separated; blank matches all vessels</small></span><input id="alertVesselTerms" type="text" placeholder="e.g. tanker, Constanta"></label>
            <label class="alert-filter"><span><b>Minimum vessel speed</b><small>Ignore vessels moving below this speed</small></span><span class="threshold-input"><input id="alertVesselSpeed" type="number" min="0" step="1"><b>kn</b></span></label>
            <label class="alert-filter"><span><b>Aircraft callsign or ID</b><small>Comma separated; blank matches all aircraft</small></span><input id="alertAircraftTerms" type="text" placeholder="e.g. airline, callsign"></label>
            <label class="alert-filter"><span><b>Minimum aircraft altitude</b><small>Ignore aircraft below this altitude</small></span><span class="threshold-input"><input id="alertAircraftAltitude" type="number" min="0" step="100"><b>m</b></span></label>
            <label class="alert-filter"><span><b>Market move threshold</b><small>Notify when a quote moves by at least this amount</small></span><span class="threshold-input"><input id="alertMove" type="number" min="0.1" step="0.1" aria-label="Market move threshold"><b>%</b></span></label>
          </div>
        </section>
      </div>
      <section class="alert-card alert-activity">
        <div class="alert-card-head"><span><i class="dot green"></i> ACTIVITY</span><button id="clearNotifications" type="button">CLEAR ACTIVITY</button></div>
        <div id="notificationList" class="notification-list"></div>
      </section>
    </div>`;
  initAlertsPage();
}
