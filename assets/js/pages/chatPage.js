import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import {
  loadChatSettings,
  saveChatSettings,
  sendChat,
} from '../features/chat.js';

const SYSTEM_PROMPT = 'You are the Rialto Terminal assistant. Use the provided functions to fetch live terminal data before answering. Keep answers concise and grounded in returned data.';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMessages() {
  const log = $('#chatLog');
  if (!log) return;
  log.innerHTML = state.chatMessages
    .filter((m) => m && m.role !== 'system')
    .map((m) => {
      if (m.role === 'user') {
        return `<div class="chat-msg user"><b>YOU</b><div>${esc(m.content)}</div></div>`;
      }
      if (m.role === 'assistant') {
        const text = m.content || (Array.isArray(m.tool_calls) ? `Calling: ${m.tool_calls.map((c) => c?.function?.name).join(', ')}` : '');
        return `<div class="chat-msg assistant"><b>ASSISTANT</b><div>${esc(text)}</div></div>`;
      }
      if (m.role === 'tool') {
        return `<div class="chat-msg tool"><b>TOOL · ${esc(m.name || 'result')}</b><pre>${esc(m.content)}</pre></div>`;
      }
      return '';
    })
    .join('');
  log.scrollTop = log.scrollHeight;
}

export function renderChatPage(root) {
  const settings = loadChatSettings();
  root.innerHTML = `<div class="module-title"><span>CHAT <small>CHAT &lt;GO&gt; · LLM CHAT · FUNCTION CALLS</small></span><span class="module-title-actions"><span class="source-badge" id="chatStatus">IDLE</span><details class="alert-tools-menu"><summary aria-label="Chat settings" title="Chat settings">⚙ CHAT</summary><div class="alert-tools-popover"><label style="display:grid;gap:4px;margin-bottom:8px;"><b style="font:500 10px Roboto,Arial,sans-serif;color:#dce3e5;">Endpoint URL</b><input id="chatUrl" type="url" placeholder="https://api.openai.com/v1" style="width:100%;background:#20282c;border:1px solid #4b585e;color:#dce2e4;padding:5px 7px;outline:0;font:10px Roboto Mono,monospace;"></label><label style="display:grid;gap:4px;margin-bottom:8px;"><b style="font:500 10px Roboto,Arial,sans-serif;color:#dce3e5;">API key</b><input id="chatApiKey" type="password" placeholder="sk-..." style="width:100%;background:#20282c;border:1px solid #4b585e;color:#dce2e4;padding:5px 7px;outline:0;font:10px Roboto Mono,monospace;"></label><label style="display:grid;gap:4px;margin-bottom:8px;"><b style="font:500 10px Roboto,Arial,sans-serif;color:#dce3e5;">Model</b><input id="chatModel" type="text" placeholder="gpt-4o-mini" style="width:100%;background:#20282c;border:1px solid #4b585e;color:#dce2e4;padding:5px 7px;outline:0;font:10px Roboto Mono,monospace;"></label><div class="alert-delivery-status">Settings are saved in cookies on this browser.</div></div></details></span></div>
    <div class="chat-layout">
      <div class="chat-log" id="chatLog"></div>
      <div class="chat-compose">
        <textarea id="chatInput" placeholder="Ask about markets, news, vessels, aircraft, conflicts…"></textarea>
        <button id="chatSend" class="primary" type="button">SEND</button>
        <button id="chatClear" type="button">CLEAR</button>
      </div>
    </div>`;

  const urlInput = $('#chatUrl');
  const keyInput = $('#chatApiKey');
  const modelInput = $('#chatModel');
  urlInput.value = settings.url || '';
  keyInput.value = settings.apiKey || '';
  modelInput.value = settings.model || '';

  const persist = () => saveChatSettings({
    url: urlInput.value.trim(),
    apiKey: keyInput.value.trim(),
    model: modelInput.value.trim(),
  });
  urlInput.addEventListener('input', persist);
  keyInput.addEventListener('input', persist);
  modelInput.addEventListener('input', persist);

  renderMessages();

  const send = async () => {
    const text = $('#chatInput').value.trim();
    if (!text) return;
    $('#chatInput').value = '';
    state.chatMessages.push({ role: 'user', content: text });
    renderMessages();
    const status = $('#chatStatus');
    if (status) status.textContent = 'THINKING…';
    try {
      const current = loadChatSettings();
      if (!current.url) throw new Error('Set chat endpoint URL in settings.');
      if (!current.model) current.model = 'gpt-4o-mini';
      // Ensure system prompt at the front without duplicating in state.
      const base = [{ role: 'system', content: SYSTEM_PROMPT }, ...state.chatMessages.filter((m) => m.role !== 'system')];
      const result = await sendChat(current, base);
      state.chatMessages = result.messages.filter((m) => m.role !== 'system');
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