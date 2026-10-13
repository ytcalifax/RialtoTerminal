import { $ } from '../core/dom.js';
import { escHtml as esc, renderMarkdown } from '../core/format.js';
import { state } from '../core/state.js';
import {
  loadChatSettings,
  saveChatSettings,
  sendChat,
} from '../features/chat.js';

const SYSTEM_PROMPT = [
  'You are the Rialto Terminal assistant.',
  'Answer directly from the conversation whenever you can. Only call a function when the answer actually depends on live terminal data — current headlines, quotes, vessel or aircraft positions, conflict reports, or listings.',
  'Greetings, thanks, general knowledge, writing help, and questions about the terminal itself never need a function call: just reply.',
  'You may only call the functions in the tools list you were given, by their exact names. Never invent, guess, or approximate a function name.',
  'If no function returns the exact figure asked for, do not stop at "I do not have that". Call the closest available function that informs the answer — futures, benchmarks, or regional aggregates are useful proxies — then answer from what you gathered and state plainly what the data covers and what it does not.',
  'Never call the same function twice with the same arguments, and never make more than three calls for one question.',
  'When you do call one, use the smallest number of calls that answers the question, then cite the source and keep the answer short.',
  'Format replies in Markdown: short bold lead sentence, then a bullet list of at most 5 items. Never use Markdown tables — this is a narrow panel and they render unreadable. Do not paste raw JSON. State the date when the data is time-sensitive.',
].join(' ');

// Models confirmed on Groq's free plan. Kept as a convenience only — the
// field stays free-text so a newly published model needs no code change.
const MODEL_CHOICES = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
];

const INPUT_STYLE = 'width:100%;background:#20282c;border:1px solid #4b585e;color:#dce2e4;padding:5px 7px;outline:0;font:10px Roboto Mono,monospace;';

function field(id, label, type, attrs = '') {
  return `<label style="display:grid;gap:4px;margin-bottom:8px;"><b style="font:500 10px Roboto,Arial,sans-serif;color:#dce3e5;">${label}</b><input id="${id}" type="${type}" ${attrs} style="${INPUT_STYLE}"></label>`;
}

function formatLimits(limits, inputTokens) {
  const parts = [];
  if (inputTokens) parts.push(`~${inputTokens.toLocaleString()} tok sent`);
  if (limits?.tpm_remaining != null) parts.push(`${limits.tpm_remaining.toLocaleString()} tok/min left`);
  if (limits?.rpd_remaining != null) parts.push(`${limits.rpd_remaining.toLocaleString()} req/day left`);
  return parts.length ? parts.join(' · ') : 'Rate-limit readout needs provider headers.';
}

/**
 * Which tool-call turns are currently expanded.
 *
 * A Set rather than one boolean, so the header button can expand/collapse all
 * while the × on an individual block closes just that turn.
 */
const expandedToolTurns = new Set();

/** Stable identity for a tool-call turn: the provider's own call ids. */
function toolTurnKey(message, index) {
  const ids = (message.tool_calls || []).map((c) => c?.id).filter(Boolean);
  return ids.length ? ids.join('|') : `idx-${index}`;
}

function allToolTurnKeys() {
  return state.chatMessages.flatMap((m, i) => (
    m && m.role === 'assistant' && !m.content && Array.isArray(m.tool_calls) && m.tool_calls.length
      ? [toolTurnKey(m, i)]
      : []
  ));
}

/**
 * Keep the header toggle in sync with the expanded set.
 *
 * The button is created by renderChatPage(), so it cannot be captured in a
 * module-scope helper — look it up at the point of use instead.
 */
function syncToolToggle() {
  const button = $('#chatToolToggle');
  if (!button) return;
  const open = expandedToolTurns.size > 0;
  button.classList.toggle('on', open);
  button.textContent = open ? 'TOOLS ON' : 'TOOLS';
}

function renderMessages() {
  const log = $('#chatLog');
  if (!log) return;
  const parts = [];
  // Tool results always follow the assistant message that requested them, so
  // this tracks whether the current turn is expanded.
  let turnOpen = false;
  state.chatMessages.forEach((m, i) => {
    if (!m || m.role === 'system') return;
    if (m.role === 'user') {
      parts.push(`<div class="chat-msg user"><b>YOU</b><div>${esc(m.content)}</div></div>`);
      return;
    }
    if (m.role === 'assistant') {
      if (!m.content && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const key = toolTurnKey(m, i);
        const names = m.tool_calls.map((c) => c?.function?.name).join(', ');
        turnOpen = expandedToolTurns.has(key);
        if (turnOpen) {
          parts.push(`<div class="chat-msg tool"><b>TOOLS · ${esc(names)}<button class="chat-tool-close" type="button" data-turn="${esc(key)}" aria-label="Hide tool calls" title="Hide">×</button></b></div>`);
        } else {
          parts.push(`<button class="chat-tool-marker" type="button" data-turn="${esc(key)}" title="${esc(names)}">⚙ ${m.tool_calls.length} call${m.tool_calls.length === 1 ? '' : 's'}</button>`);
        }
        return;
      }
      if (!m.content) return;
      turnOpen = false;
      parts.push(`<div class="chat-msg assistant"><b>ASSISTANT</b><div class="md">${renderMarkdown(m.content)}</div></div>`);
      return;
    }
    if (m.role === 'tool' && turnOpen) {
      parts.push(`<div class="chat-msg tool"><b>TOOL · ${esc(m.name || 'result')}</b><pre>${esc(m.content)}</pre></div>`);
    }
  });
  log.innerHTML = parts.join('');
  log.querySelectorAll('.chat-tool-marker').forEach((marker) => {
    marker.addEventListener('click', () => {
      expandedToolTurns.add(marker.getAttribute('data-turn'));
      syncToolToggle();
      renderMessages();
    });
  });
  log.querySelectorAll('.chat-tool-close').forEach((close) => {
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      expandedToolTurns.delete(close.getAttribute('data-turn'));
      syncToolToggle();
      renderMessages();
    });
  });
  log.scrollTop = log.scrollHeight;
}

export function renderChatPage(root) {
  const settings = loadChatSettings();
  root.innerHTML = `<div class="module-title"><span>CHAT <small>CHAT &lt;GO&gt; · LLM CHAT · FUNCTION CALLS</small></span><span class="module-title-actions"><span class="source-badge" id="chatStatus">IDLE</span><button id="chatToolToggle" type="button" title="Expand or collapse all tool calls">TOOLS</button><details class="alert-tools-menu"><summary aria-label="Chat settings" title="Chat settings">⚙ CHAT</summary><div class="alert-tools-popover">
  ${field('chatUrl', 'Endpoint URL', 'url', 'placeholder="https://api.groq.com/openai/v1"')}
  ${field('chatApiKey', 'API key', 'password', 'placeholder="gsk_…"')}
  ${field('chatModel', 'Model', 'text', 'list="chatModels"')}
  <datalist id="chatModels">${MODEL_CHOICES.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
  ${field('chatTemperature', 'Temperature (0–2)', 'number', 'min="0" max="2" step="0.1"')}
  ${field('chatMaxTokens', 'Max completion tokens', 'number', 'min="64" max="32000" step="64"')}
  ${field('chatMaxRounds', 'Max tool rounds', 'number', 'min="1" max="8" step="1"')}
  ${field('chatToolChars', 'Tool result cap (chars)', 'number', 'min="300" max="16000" step="100"')}
  ${field('chatInputBudget', 'Input budget (tokens)', 'number', 'min="500" max="200000" step="100"')}
  <div class="alert-delivery-status" id="chatLimits">Idle</div>
  <div class="alert-delivery-status">Per-browser settings. This key stays in your cookie, not the server.</div>
</div></details></span></div>
    <div class="chat-layout">
      <div class="chat-log" id="chatLog"></div>
      <div class="chat-compose">
        <textarea id="chatInput" placeholder="Ask about markets, news, vessels, aircraft, conflicts…"></textarea>
        <button id="chatSend" class="primary" type="button">SEND</button>
        <button id="chatClear" type="button">CLEAR</button>
      </div>
    </div>`;

  const inputs = {
    url: $('#chatUrl'),
    apiKey: $('#chatApiKey'),
    model: $('#chatModel'),
    temperature: $('#chatTemperature'),
    maxCompletionTokens: $('#chatMaxTokens'),
    maxRounds: $('#chatMaxRounds'),
    toolResultChars: $('#chatToolChars'),
    inputBudget: $('#chatInputBudget'),
  };
  for (const [key, input] of Object.entries(inputs)) input.value = settings[key];

  const persist = () => saveChatSettings(
    Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])),
  );
  Object.values(inputs).forEach((input) => input.addEventListener('input', persist));

  // Declared before the first renderMessages() call below, so the marker
  // handlers inside it can reference this without a TDZ error.
  const toolToggle = $('#chatToolToggle');
  toolToggle.addEventListener('click', () => {
    // Master switch: collapse everything when anything is open, else open
    // every tool-call turn currently in the transcript.
    if (expandedToolTurns.size) expandedToolTurns.clear();
    else allToolTurnKeys().forEach((key) => expandedToolTurns.add(key));
    syncToolToggle();
    renderMessages();
  });
  syncToolToggle();

  renderMessages();

  const send = async () => {
    const text = $('#chatInput').value.trim();
    if (!text) return;
    $('#chatInput').value = '';
    state.chatMessages.push({ role: 'user', content: text });
    renderMessages();
    const status = $('#chatStatus');
    const readout = $('#chatLimits');
    if (status) status.textContent = 'THINKING…';
    try {
      const current = loadChatSettings();
      const base = [{ role: 'system', content: SYSTEM_PROMPT }, ...state.chatMessages.filter((m) => m.role !== 'system')];
      let lastTokens = 0;
      const result = await sendChat(current, base, ({ round, limits: seen, inputTokens }) => {
        lastTokens = inputTokens;
        if (readout) readout.textContent = formatLimits(seen, inputTokens);
        if (status && round > 1) status.textContent = `TOOLS ${round}…`;
      });
      state.chatMessages = result.messages.filter((m) => m.role !== 'system');
      if (readout) readout.textContent = formatLimits(result.limits, lastTokens);
      renderMessages();
    } catch (err) {
      state.chatMessages.push({ role: 'assistant', content: `Error: ${err?.message || err}` });
      renderMessages();
    } finally {
      if (status) status.textContent = 'IDLE';
    }
  };

  $('#chatSend').onclick = send;
  $('#chatInput').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  $('#chatClear').onclick = () => {
    state.chatMessages = [];
    renderMessages();
  };
}