/**
 * Chrome bindings: function navigation buttons, screen tabs, Sofia clock.
 */
import { $, $$ } from '../core/dom.js';
import { state } from '../core/state.js';
import { SCREEN_BY_PAGE } from '../core/constants.js';
import { openPage } from './navigation.js';
import { copyCurrentData } from '../core/exportData.js';

/** Sofia-local wall clock into the header; runs every second. */
function startClock() {
  const clock = () => {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Sofia',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    }).formatToParts(d);
    $('#clock').textContent = parts.filter((p) => ['hour', 'minute', 'second'].includes(p.type)).map((p) => p.value).join(':')
      + ' ' + parts.find((p) => p.type === 'timeZoneName').value;
  };
  clock();
  setInterval(clock, 1000);
}

/** Bind the static chrome: function nav, screen tabs, clock. */
function initChrome() {
  $$('.function-nav button[data-page],.text-action,.panel-foot button[data-page],.spot-head button[data-page]')
    .forEach((b) => b.addEventListener('click', () => openPage(b.dataset.page)));
  $$('.tab-small').forEach((b) => {
    b.onclick = () => {
      state.screen = b.dataset.screen;
      openPage(SCREEN_BY_PAGE[state.screen]);
    };
  });
  startClock();
  document.addEventListener('click', (event) => {
    const target = event.target;
    const button = target instanceof Element ? target.closest('[data-copy-data]') : null;
    if (!button) return;
    copyCurrentData(button).catch(() => {
      button.textContent = 'COPY FAILED';
      setTimeout(() => {
        button.textContent = button.dataset.copyLabel || 'COPY DATA';
      }, 1600);
    });
  });
}

export { initChrome };
