/**
 * Terminal-style command line: GO button, autocomplete suggestions,
 * history navigation, function menu and the F2 help panel.
 *
 * The command line is UI-layer, so it may import `openPage` directly;
 * feature data calls (news search) go through the feature module.
 */
import { $, $$ } from '../core/dom.js';
import { state } from '../core/state.js';
import { setStatus } from '../core/status.js';
import { COMMAND_NAMES, HELP_ITEMS, MENU_ITEMS, COMMAND_PAGES, HISTORY_LIMIT } from '../core/constants.js';
import { openPage } from './navigation.js';
import { loadNews } from '../features/news.js';

const getCmd = () => $('#command');

/** Activate the handler embedded in a suggestion/menu row. */
function bindPopupCommands(box) {
  $$('[data-command]', box).forEach((el) => {
    el.onclick = () => goCommand(el.dataset.command);
  });
}

/** Open the function menu popup. */
function openTerminalMenu() {
  const box = $('#suggestions');
  box.dataset.mode = 'menu';
  box.innerHTML = `<div class="help-head">FUNCTION MENU · SELECT DESTINATION</div>`
    + MENU_ITEMS.map(([c, n]) => `<div class="command-option" data-command="${c}"><b>${c}</b><span>${n}</span></div>`).join('');
  box.classList.add('open');
  bindPopupCommands(box);
  setStatus('MENU · SELECT A FUNCTION');
}

/** Open the keyboard-reference + function directory panel (F2). */
function runHelp() {
  const box = $('#suggestions');
  box.dataset.mode = 'help';
  box.innerHTML = `<div class="help-head">TERMINAL HELP · KEYBOARD REFERENCE</div>`
    + `<div class="command-option"><b>F2</b><span>Open this help panel</span></div>`
    + `<div class="command-option"><b>/</b><span>Focus command line</span></div>`
    + `<div class="command-option"><b>↑ / ↓</b><span>Command history and suggestions</span></div>`
    + `<div class="command-option"><b>ENTER</b><span>Run command or selected function</span></div>`
    + `<div class="command-option"><b>ESC</b><span>Close panel / return to top screen</span></div>`
    + `<div class="help-head">FUNCTIONS · SELECT TO OPEN</div>`
    + HELP_ITEMS.map(([c, n]) => `<div class="command-option" data-command="${c}"><b>${c}</b><span>${n}</span></div>`).join('');
  box.classList.add('open');
  bindPopupCommands(box);
  setStatus('HELP · F2 PANEL · / COMMAND LINE · ESC CLOSE');
}

/**
 * Execute a command word: navigate to its page (and run a news search when
 * extra words are given), or report an unknown function.
 * @param {string} value - raw command-line text.
 */
function goCommand(value) {
  const raw = value.trim();
  if (!raw) return;
  state.history.unshift(raw);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  state.historyIndex = -1;
  const parts = raw.toUpperCase().split(/\s+/);
  const page = COMMAND_PAGES[parts[0]];
  if (page) {
    openPage(page);
    if (page === 'news' && parts.length > 1) {
      const q = raw.trim().split(/\s+/).slice(1).join(' ');
      loadNews('global', q);
      // The module shell is rebuilt by openPage; restore the query box once
      // it exists again (after the current task).
      setTimeout(() => {
        if ($('#newsQuery')) $('#newsQuery').value = q;
      }, 0);
    }
  } else {
    setStatus(`UNKNOWN FUNCTION · ${parts[0]} · F2 FOR DIRECTORY`);
  }
  $('#command').value = '';
  $('#suggestions').classList.remove('open');
}

/** Show prefix-matched command suggestions for the current input. */
function showSuggestions(value) {
  const cmd = getCmd();
  const raw = value !== undefined ? value : (cmd?.value || '');
  const box = $('#suggestions');
  if (!box) return;
  const v = raw.trim().toUpperCase();
  const list = Object.keys(COMMAND_NAMES).filter((x) => !v || x.startsWith(v));
  box.dataset.mode = 'command';
  box.innerHTML = list.map((x) => `<div class="command-option" data-command="${x}"><b>${x}</b><span>${COMMAND_NAMES[x]}</span></div>`).join('');
  box.classList.toggle('open', (cmd && document.activeElement === cmd) || !v);
  bindPopupCommands(box);
}

/** Wire all command-line and global keyboard behaviour (call once at boot). */
function initCommandLine() {
  const cmd = getCmd();
  if (!cmd) return;
  cmd.addEventListener('keydown', (e) => {
    const box = $('#suggestions');
    const opts = $$('[data-command]', box);
    if (e.key === 'Enter') {
      e.preventDefault();
      const active = opts[state.activeSuggestion];
      goCommand(active?.dataset.command || cmd.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      box.classList.remove('open');
      cmd.value = '';
      if (state.page !== 'top') openPage('top');
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      if (!cmd.value.trim() && state.history.length) {
        // Empty input: walk the history buffer.
        if (up) state.historyIndex = state.historyIndex < 0 ? 0 : Math.min(state.history.length - 1, state.historyIndex + 1);
        else if (state.historyIndex >= 0) state.historyIndex--;
        if (state.historyIndex >= 0) {
          cmd.value = state.history[state.historyIndex];
          box.classList.remove('open');
        } else {
          cmd.value = '';
          showSuggestions('');
        }
        state.activeSuggestion = -1;
      } else if (box.classList.contains('open') && opts.length) {
        // Visible suggestions: move the highlight, wrapping at the ends.
        state.activeSuggestion = state.activeSuggestion < 0
          ? (up ? opts.length - 1 : 0)
          : (state.activeSuggestion + (up ? -1 : 1) + opts.length) % opts.length;
        opts.forEach((o, i) => o.classList.toggle('chosen', i === state.activeSuggestion));
      } else if (state.history.length) {
        // Non-empty input without a suggestion list: still browse history.
        state.historyIndex = up
          ? (state.historyIndex < 0 ? 0 : Math.min(state.history.length - 1, state.historyIndex + 1))
          : Math.max(-1, state.historyIndex - 1);
        cmd.value = state.history[state.historyIndex] || '';
      }
    } else if (e.key === 'Tab' && opts.length) {
      e.preventDefault();
      cmd.value = opts[Math.max(0, state.activeSuggestion)].dataset.command;
      showSuggestions(cmd.value);
    }
  });

  cmd.addEventListener('input', () => {
    state.activeSuggestion = -1;
    state.historyIndex = -1;
    showSuggestions();
  });

  $('#goBtn').onclick = () => goCommand(cmd.value);
  $('#menuBtn').onclick = () => {
    $('#suggestions').classList.contains('open') && $('#suggestions').dataset.mode === 'menu'
      ? $('#suggestions').classList.remove('open')
      : openTerminalMenu();
  };
  $('#helpBtn').onclick = runHelp;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      runHelp();
    }
    if (e.key === '/' && document.activeElement !== cmd) {
      e.preventDefault();
      cmd.focus();
      showSuggestions('');
    }
    if (e.key === 'Escape') {
      if ($('#suggestions').classList.contains('open')) $('#suggestions').classList.remove('open');
      else if (state.page !== 'top') openPage('top');
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#suggestions,.command-wrap,#menuBtn,#helpBtn')) $('#suggestions').classList.remove('open');
  });
}

export { initCommandLine, goCommand, runHelp };
