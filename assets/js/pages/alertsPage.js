/** Alert preferences and recent activity workspace. */
import { state } from '../core/state.js';
import { initAlertsPage } from '../core/notifications.js';

export function renderAlertsPage(root) {
  root.innerHTML = `<div class="module-title"><span>ALERTS &amp; TRENDS <small>PERSONAL SIGNALS · LOCAL PREFERENCES</small></span><span class="module-title-actions"><span class="source-badge" id="alertRecentCount">${state.notifications.length} RECENT</span></span></div>
    <div class="alerts-layout">
      <div class="alerts-settings">
        <section class="alert-card alert-subscriptions">
          <div class="alert-card-head"><span><i class="dot orange"></i> SUBSCRIPTIONS</span><small>CHOOSE WHAT SHOULD REACH YOU</small></div>
          <label class="alert-option"><span class="alert-option-icon">N</span><span class="alert-option-copy"><b>Headline matches</b><small>New stories that match your selected terms</small></span><input id="alertNews" type="checkbox" aria-label="Subscribe to headline alerts"><span class="switch"></span></label>
          <label class="alert-option"><span class="alert-option-icon conflict">!</span><span class="alert-option-copy"><b>Conflict updates</b><small>New reports added to the conflict feed</small></span><input id="alertConflict" type="checkbox" aria-label="Subscribe to conflict alerts"><span class="switch"></span></label>
          <label class="alert-option"><span class="alert-option-icon market">↗</span><span class="alert-option-copy"><b>Market moves</b><small>Instruments moving beyond your threshold</small></span><input id="alertMarkets" type="checkbox" aria-label="Subscribe to market move alerts"><span class="switch"></span></label>
          <div class="alert-keywords"><div class="alert-section-title"><span>HEADLINE TERMS</span><small>REMOVE ANY TERM WITH ×</small></div><div id="alertKeywordChips" class="alert-keyword-chips"></div><div class="alert-add-term"><input id="alertKeywordAdd" placeholder="Add a term or phrase" aria-label="Add headline alert term"><button id="addAlertKeyword" type="button">ADD TERM <b>＋</b></button></div></div>
          <label class="alert-threshold"><span><b>Market move threshold</b><small>Notify when a quote moves by at least this amount</small></span><span class="threshold-input"><input id="alertMove" type="number" min="0.1" step="0.1" aria-label="Market move threshold"><b>%</b></span></label>
        </section>
      </div>
      <section class="alert-card alert-activity">
        <div class="alert-card-head"><span><i class="dot green"></i> ACTIVITY</span><button id="clearNotifications" type="button">CLEAR ACTIVITY</button></div>
        <div id="notificationList" class="notification-list"></div>
      </section>
    </div>`;
  initAlertsPage();
}
