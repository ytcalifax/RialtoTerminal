import { $ } from '../core/dom.js';
import { escHtml as esc, renderMarkdown } from '../core/format.js';
import { state } from '../core/state.js';
import {
  listProviderModels,
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
  'Never call the same function twice with the same arguments.',
  'When you do call one, use the smallest number of calls that answers the question, then cite the source and keep the answer short.',
  'Format replies in Markdown: short bold lead sentence, then a bullet list of at most 5 items. Never use Markdown tables — this is a narrow panel and they render unreadable. Do not paste raw JSON. State the date when the data is time-sensitive.',
].join(' ');

/**
 * Endpoint presets.
 *
 * Free-tier rate limits differ by an order of magnitude between providers and
 * move every few months, so this is a convenience list rather than a source of
 * truth — the URL stays editable and free-text, and a newly published endpoint
 * needs no code change. Model ids are deliberately absent: the provider's own
 * `GET {base}/models` is asked at runtime, so the dropdown is never stale.
 * Notes are as of October 2026:
 *
 *  - OpenRouter `:free` — 20 RPM and 50 requests/day, or 1000/day once the
 *    account has bought $10 of credit ever. Paid variants have no platform cap.
 *  - Groq — fastest tokens per second by a wide margin, but the free plan meters
 *    input and output against one 8,000 token/minute window, which a four-round
 *    tool query exhausts on its own.
 *  - Cerebras — 1,000 RPM on pay-as-you-go; the no-card trial dropped to 5 RPM.
 *  - Google AI Studio — no card, ~15 RPM observed, limits only shown per project.
 *  - Mistral — no card; limits enforced but never published.
 */
const PROVIDERS = [
  { label: 'OpenRouter · 20 RPM free · uncapped when paid', url: 'https://openrouter.ai/api/v1' },
  { label: 'Groq · fastest tokens/s · 8k tokens/min free cap', url: 'https://api.groq.com/openai/v1' },
  { label: 'Cerebras · 1000 RPM pay-as-you-go · 5 RPM trial', url: 'https://api.cerebras.ai/v1' },
  { label: 'Google AI Studio · Gemini free tier · no card', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { label: 'Mistral · free mode · limits unpublished', url: 'https://api.mistral.ai/v1' },
];

const CUSTOM_PROVIDER = 'custom';

const CONTROL_STYLE = 'width:100%;background:#20282c;border:1px solid #4b585e;color:#dce2e4;padding:5px 7px;outline:0;font:10px Roboto Mono,monospace;';
const LABEL_STYLE = 'font:500 10px Roboto,Arial,sans-serif;color:#dce3e5;';

function field(id, label, type, attrs = '') {
  return `<label style="display:grid;gap:4px;margin-bottom:8px;"><b style="${LABEL_STYLE}">${label}</b><input id="${id}" type="${type}" ${attrs} style="${CONTROL_STYLE}"></label>`;
}

function picker(id, label, options) {
  const body = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  return `<label style="display:grid;gap:4px;margin-bottom:8px;"><b style="${LABEL_STYLE}">${label}</b><select id="${id}" style="${CONTROL_STYLE}">${body}</select></label>`;
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
  ${picker('chatProvider', 'Provider preset', [
    ...PROVIDERS.map((p, i) => ({ value: String(i), label: p.label })),
    { value: CUSTOM_PROVIDER, label: 'Custom endpoint' },
  ])}
  ${field('chatUrl', 'Endpoint URL', 'url', 'placeholder="https://openrouter.ai/api/v1"')}
  ${field('chatApiKey', 'API key', 'password', 'placeholder="sk-or-…"')}
  ${field('chatModel', 'Model', 'text', 'list="chatModels" placeholder="loaded from the endpoint"')}
  <datalist id="chatModels"></datalist>
  <div class="alert-delivery-status" id="chatModelNote">Open ⚙ CHAT to load this endpoint's models.</div>
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

  const providerSelect = $('#chatProvider');
  const modelList = $('#chatModels');
  const modelNote = $('#chatModelNote');

  const persist = () => saveChatSettings(
    Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])),
  );
  Object.values(inputs).forEach((input) => input.addEventListener('input', persist));

  /** Point the preset dropdown at whichever endpoint the URL field holds. */
  const syncProviderState = () => {
    const preset = PROVIDERS.find((p) => p.url === inputs.url.value.trim().replace(/\/+$/, ''));
    providerSelect.value = preset ? String(PROVIDERS.indexOf(preset)) : CUSTOM_PROVIDER;
  };

  /** Ask the endpoint itself what it serves, and fill the datalist from it. */
  const refreshModels = async () => {
    if (modelNote) modelNote.textContent = 'Loading models…';
    const { models, note } = await listProviderModels({ url: inputs.url.value, apiKey: inputs.apiKey.value });
    modelList.innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    if (modelNote) modelNote.textContent = note;
    // Adopt the first listed model only when the box holds nothing usable for
    // this endpoint: the same id often exists on the next provider too, while a
    // model the endpoint does not serve would just fail on send. Assigning
    // `.value` fires no input event, so persist it explicitly.
    if (models.length && !models.includes(inputs.model.value.trim())) {
      inputs.model.value = models[0];
      persist();
    }
  };
  syncProviderState();

  // Picking a preset rewrites the endpoint and reloads its catalog. The API key
  // is deliberately left alone: it is per-account, and the person who just
  // switched provider may not hold one for it yet.
  providerSelect.addEventListener('change', () => {
    const preset = PROVIDERS[Number(providerSelect.value)];
    if (!preset) return;
    inputs.url.value = preset.url;
    syncProviderState();
    persist();
    refreshModels();
  });

  // A hand-edited endpoint or a freshly pasted key both change what the provider
  // will answer with, so reload — debounced, since these fire per keystroke.
  let refreshTimer = 0;
  const queueRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { syncProviderState(); refreshModels(); }, 600);
  };
  inputs.url.addEventListener('input', queueRefresh);
  inputs.apiKey.addEventListener('input', queueRefresh);

  // Opening the panel is the natural moment to catch up on a key entered earlier.
  const settingsMenu = root.querySelector('.alert-tools-menu');
  settingsMenu?.addEventListener('toggle', () => { if (settingsMenu.open) refreshModels(); });

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
      const result = await sendChat(current, base, ({ round, limits: seen, inputTokens, final }) => {
        lastTokens = inputTokens;
        if (readout) readout.textContent = formatLimits(seen, inputTokens);
        if (!status) return;
        if (final) status.textContent = 'ANSWERING…';
        else if (round > 1) status.textContent = `TOOLS ${round}…`;
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