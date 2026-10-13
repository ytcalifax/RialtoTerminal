import { CHAT_COOKIE, LLM_TIMEOUT_MS } from '../core/constants.js';
import { emit } from '../core/hooks.js';
import { state } from '../core/state.js';
import { req } from '../core/net.js';

/**
 * Per-user chat settings: endpoint, credential, model, and limits.
 *
 * These live in this browser's cookie rather than the server's `.env` so each
 * person using the terminal brings their own key and can point at whichever
 * OpenAI-compatible endpoint they have an account with. The server holds no
 * LLM credential at all.
 *
 * OpenRouter is the default because its limits are the only ones that can be
 * lifted: the `:free` models run at 20 RPM, and any paid model carries no
 * platform-level request cap at all — it is billed per token instead, at
 * roughly $0.08–0.15 per million input tokens for the models listed in
 * chatPage.js. A single question costs a fraction of a cent even when it burns
 * five rounds, so topping up $10 removes the rate ceiling for good.
 *
 * The limit defaults below are therefore provider-neutral safety values rather
 * than a fit to one free plan. Each round re-sends the whole history plus these
 * tool schemas (~1k tokens), so `inputBudget` is what keeps a long
 * function-calling session from growing without bound.
 */
export const CHAT_DEFAULTS = {
  url: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'nvidia/nemotron-3-super-120b-a12b:free',
  temperature: 0.6,
  maxCompletionTokens: 1500,
  maxRounds: 4,
  toolResultChars: 2500,
  // Input ceiling applied to the replayed history before each request.
  inputBudget: 3500,
};

function num(value, fallback, low, high) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(high, Math.max(low, Math.round(parsed)));
}

function getCookie(name) {
  try {
    const entry = document.cookie.split('; ').find((item) => item.startsWith(name + '='));
    if (!entry) return '';
    return entry.slice(name.length + 1);
  } catch {
    return '';
  }
}

function coerceSettings(parsed, base) {
  return {
    url: String(parsed.url || base.url).trim().replace(/\/+$/, ''),
    apiKey: String(parsed.apiKey || ''),
    model: String(parsed.model || base.model).trim() || base.model,
    temperature: num(parsed.temperature, base.temperature, 0, 2),
    maxCompletionTokens: num(parsed.maxCompletionTokens, base.maxCompletionTokens, 64, 32000),
    maxRounds: num(parsed.maxRounds, base.maxRounds, 1, 8),
    toolResultChars: num(parsed.toolResultChars, base.toolResultChars, 300, 16000),
    inputBudget: num(parsed.inputBudget, base.inputBudget, 500, 200000),
  };
}

export function loadChatSettings() {
  const base = { ...CHAT_DEFAULTS };
  try {
    const raw = getCookie(CHAT_COOKIE);
    if (!raw) return base;
    return coerceSettings(JSON.parse(decodeURIComponent(raw)) || {}, base);
  } catch {
    return base;
  }
}

export function saveChatSettings(settings) {
  try {
    const payload = coerceSettings(settings || {}, { ...CHAT_DEFAULTS });
    document.cookie = `${CHAT_COOKIE}=${encodeURIComponent(JSON.stringify(payload))}; max-age=31536000; path=/; SameSite=Lax`;
  } catch {
    /* ignore cookie write errors in restricted browser contexts */
  }
}

async function fetchJson(path) {
  return req(path);
}

function qs(params) {
  return Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export async function executeChatTool(name, args = {}) {
  const a = args || {};
  switch (name) {
    case 'get_news': {
      const q = qs({ feed: a.feed || 'global', q: a.q || a.query || '', country: a.country || '' });
      return fetchJson(`/api/news${q ? `?${q}` : ''}`);
    }
    case 'get_market': {
      const q = qs({ group: String(a.group || 'CORE').toUpperCase() });
      return fetchJson(`/api/market?${q}`);
    }
    case 'get_market_sentiment':
      return fetchJson('/api/market-sentiment');
    case 'search_symbols': {
      const q = qs({ q: a.q || a.query || '' });
      return fetchJson(`/api/symbol-search?${q}`);
    }
    case 'get_quotes': {
      const symbols = Array.isArray(a.symbols) ? a.symbols.join(',') : (a.symbols || a.symbol || '');
      const q = qs({ symbols });
      return fetchJson(`/api/quotes?${q}`);
    }
    case 'get_marketplace': {
      const q = qs({ q: a.q || a.query || '', limit: a.limit || 40 });
      return fetchJson(`/api/marketplace?${q}`);
    }
    case 'get_vessels': {
      const q = qs({ boxes: a.boxes || a.box || '' });
      return fetchJson(`/api/vessels${q ? `?${q}` : ''}`);
    }
    case 'get_vessel_track': {
      const q = qs({ mmsi: a.mmsi });
      return fetchJson(`/api/vessel-track?${q}`);
    }
    case 'get_aircraft': {
      const q = qs({ bbox: a.bbox || a.box || '' });
      return fetchJson(`/api/air${q ? `?${q}` : ''}`);
    }
    case 'get_aircraft_info': {
      const q = qs({ id: a.id || a.hex || '', callsign: a.callsign || '' });
      return fetchJson(`/api/air-info?${q}`);
    }
    case 'get_aircraft_track': {
      const q = qs({ icao24: a.icao24 || a.id || '' });
      return fetchJson(`/api/air-track?${q}`);
    }
    case 'get_conflicts':
      return fetchJson('/api/conficts');
    case 'get_disease_outbreaks':
      return fetchJson('/api/health/outbreaks');
    case 'get_debug_stats':
      return fetchJson('/api/debug/stats');
    case 'get_state_summary': {
      // Imported lazily to avoid circular dependency churn.
      const { state } = await import('../core/state.js');
      return {
        page: state.page,
        newsCount: state.news?.length || 0,
        marketCount: state.market?.length || 0,
        shipsCount: state.ships?.length || 0,
        aircraftCount: state.aircraft?.length || 0,
        warReportsCount: state.warReports?.length || 0,
        marketplaceCount: state.marketplace?.length || 0,
        diseaseOutbreaksCount: state.diseaseOutbreaks?.length || 0,
        pins: (state.pins || []).map((p) => p.symbol),
      };
    }
    case 'get_data': {
      const resource = String(a.resource || a.endpoint || '').toLowerCase();
      const params = a.params || a.arguments || {};
      const mapping = {
        news: () => executeChatTool('get_news', params),
        market: () => executeChatTool('get_market', params),
        markets: () => executeChatTool('get_market', params),
        sentiment: () => executeChatTool('get_market_sentiment', params),
        market_sentiment: () => executeChatTool('get_market_sentiment', params),
        symbols: () => executeChatTool('search_symbols', params),
        symbol_search: () => executeChatTool('search_symbols', params),
        quotes: () => executeChatTool('get_quotes', params),
        marketplace: () => executeChatTool('get_marketplace', params),
        vessels: () => executeChatTool('get_vessels', params),
        vessel_track: () => executeChatTool('get_vessel_track', params),
        aircraft: () => executeChatTool('get_aircraft', params),
        air: () => executeChatTool('get_aircraft', params),
        aircraft_info: () => executeChatTool('get_aircraft_info', params),
        air_info: () => executeChatTool('get_aircraft_info', params),
        aircraft_track: () => executeChatTool('get_aircraft_track', params),
        air_track: () => executeChatTool('get_aircraft_track', params),
        conflicts: () => executeChatTool('get_conflicts', params),
        conflict: () => executeChatTool('get_conflicts', params),
        disease: () => executeChatTool('get_disease_outbreaks', params),
        disease_outbreaks: () => executeChatTool('get_disease_outbreaks', params),
        outbreaks: () => executeChatTool('get_disease_outbreaks', params),
        debug: () => executeChatTool('get_debug_stats', params),
        state: () => executeChatTool('get_state_summary', params),
        summary: () => executeChatTool('get_state_summary', params),
      };
      const fn = mapping[resource];
      if (!fn) throw new Error(`Unknown terminal resource: ${resource}`);
      return fn();
    }
    default:
      throw new Error(`Unknown chat tool: ${name}`);
  }
}

export const CHAT_TOOLS = [
  { type: 'function', function: {
      name: 'get_news', description: 'Fetch news headlines from Rialto (global, Bulgaria, Balkans).',
      parameters: { type: 'object', properties: {
        feed: { type: 'string', description: 'global | bulgaria | balkans' },
        q: { type: 'string', description: 'Optional search query' },
        country: { type: 'string', description: 'Country filter' },
      }, required: [] } } },
  { type: 'function', function: {
      name: 'get_market', description: 'Fetch market quotes for a group (INDICES, FX, RATES, COMMODITIES, CRYPTO, ETFS, STOCKS, CORE).',
      parameters: { type: 'object', properties: { group: { type: 'string' } }, required: [] } } },
  { type: 'function', function: {
      name: 'get_market_sentiment', description: 'Fetch composite fear and greed market sentiment.',
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: {
      name: 'search_symbols', description: 'Search tradeable symbols by name or ticker.',
      parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } },
  { type: 'function', function: {
      name: 'get_quotes', description: 'Fetch quotes for one or more symbols (comma-separated or array).',
      parameters: { type: 'object', properties: {
        symbols: { description: 'Symbol or array of symbols', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      }, required: ['symbols'] } } },
  { type: 'function', function: {
      name: 'get_marketplace', description: 'Search Bazar.bg marketplace listings.',
      parameters: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'number' } }, required: [] } } },
  { type: 'function', function: {
      name: 'get_vessels', description: 'Fetch AIS vessel positions, optionally filtered by bounding box string.',
      parameters: { type: 'object', properties: { boxes: { type: 'string' } }, required: [] } } },
  { type: 'function', function: {
      name: 'get_vessel_track', description: 'Fetch track for a vessel by MMSI.',
      parameters: { type: 'object', properties: { mmsi: { type: 'string' } }, required: ['mmsi'] } } },
  { type: 'function', function: {
      name: 'get_aircraft', description: 'Fetch live aircraft states, optionally by bounding box string.',
      parameters: { type: 'object', properties: { bbox: { type: 'string' } }, required: [] } } },
  { type: 'function', function: {
      name: 'get_aircraft_info', description: 'Fetch aircraft details by ICAO24 id or callsign.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, callsign: { type: 'string' } }, required: [] } } },
  { type: 'function', function: {
      name: 'get_aircraft_track', description: 'Fetch track for an aircraft by ICAO24.',
      parameters: { type: 'object', properties: { icao24: { type: 'string' } }, required: ['icao24'] } } },
  { type: 'function', function: {
      name: 'get_conflicts', description: 'Fetch conflict reports, front line and GPSJam data.',
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: {
      name: 'get_disease_outbreaks', description: 'Fetch latest WHO/ProMED disease outbreak alerts.',
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: {
      name: 'get_debug_stats', description: 'Fetch server request/debug statistics.',
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: {
      name: 'get_state_summary', description: 'Summarize currently loaded terminal state counts and pins.',
      parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: {
      name: 'get_data', description: 'Generic accessor: fetch any terminal resource by name (news, market, markets, sentiment, symbols, quotes, marketplace, vessels, vessel_track, aircraft, aircraft_info, aircraft_track, conflicts, disease_outbreaks, debug, state).',
      parameters: { type: 'object', properties: {
        resource: { type: 'string' },
        params: { type: 'object', additionalProperties: true },
      }, required: ['resource'] } } },
];

/**
 * Drop the last element of the first shrinkable list in a payload.
 *
 * Returns a smaller copy, or null when nothing further can be removed. Used
 * to fit a tool result inside its character budget by discarding whole
 * records — headline lists, quote rows, vessel arrays — rather than slicing
 * mid-string, which would hand the model invalid JSON to guess at.
 */
function trimOnce(node) {
  if (Array.isArray(node)) {
    return node.length > 1 ? node.slice(0, -1) : null;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const smaller = trimOnce(node[key]);
      if (smaller) return { ...node, [key]: smaller };
    }
  }
  return null;
}

export function shrinkToolResult(value, maxChars) {
  let node = value;
  let text = typeof node === 'string' ? node : JSON.stringify(node);
  if (text.length <= maxChars) return text;
  // Bounded so a pathological deeply-nested payload cannot spin here.
  for (let guard = 0; guard < 500 && text.length > maxChars; guard += 1) {
    const smaller = trimOnce(node);
    if (!smaller) break;
    node = smaller;
    text = typeof node === 'string' ? node : JSON.stringify(node);
  }
  // Nothing list-shaped to trim (e.g. one oversized string): fall back to a
  // hard slice so a single result can never blow the whole budget.
  return text.length > maxChars ? `${text.slice(0, maxChars)}…[truncated]` : text;
}

/** Rough token estimate (~4 chars/token). Directional only — it just has to
 * be close enough to keep a request under the window. */
function estimateTokens(value) {
  const chars = typeof value === 'string' ? value.length : JSON.stringify(value).length;
  return Math.max(1, Math.ceil(chars / 4));
}

/**
 * Group messages into units that must be kept or dropped together: a `tool`
 * result is meaningless without the assistant message that requested it.
 */
function toolRounds(messages) {
  const groups = [];
  for (const message of messages) {
    const open = groups.length
      && groups[groups.length - 1][0].role === 'assistant'
      && Array.isArray(groups[groups.length - 1][0].tool_calls)
      && groups[groups.length - 1][0].tool_calls.length;
    if (open && message.role === 'tool') groups[groups.length - 1].push(message);
    else groups.push([message]);
  }
  return groups;
}

/**
 * Drop the oldest whole rounds until the replayed history fits the budget.
 *
 * This is the fix for provider 429s. Every round re-sends the entire
 * conversation, so without it a four-round function-calling query exceeds an
 * 8,000 token/minute window on input alone. Dropping whole rounds rather than
 * individual messages keeps the assistant/tool_call pairing the provider
 * requires, and the system prompt is always retained because it is the only
 * thing that tells the model it has terminal tools at all.
 */
export function pruneConversation(messages, budget, reserved = 0) {
  const groups = toolRounds(messages);
  let spent = reserved;
  const kept = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const cost = groups[i].reduce((sum, m) => sum + estimateTokens(m), 0);
    if (spent + cost > budget && kept.length) break;
    spent += cost;
    kept.push(groups[i]);
  }
  kept.reverse();
  const flat = kept.flat();
  if (flat.length && flat[0].role !== 'system') {
    const system = messages.find((m) => m.role === 'system');
    if (system) flat.unshift(system);
  }
  return { messages: flat, tokens: spent };
}

/**
 * Ask the configured endpoint which models it serves.
 *
 * Every OpenAI-compatible provider exposes `GET {base}/models` in the same
 * `{ data: [{ id }] }` shape. OpenRouter answers without a key, Groq/Mistral/
 * Cerebras/Gemini need one, so this is called with whatever the browser already
 * holds. A provider that refuses or does not implement listing is not an error:
 * the model field stays free-text, so a failure resolves to an empty list and a
 * short note explaining what happened.
 *
 * @param {object} settings - { url, apiKey }
 * @returns {Promise<{models: string[], note: string}>}
 */
export async function listProviderModels(settings) {
  const cfg = { ...CHAT_DEFAULTS, ...(settings || {}) };
  const base = String(cfg.url || '').trim().replace(/\/+$/, '');
  if (!base) return { models: [], note: 'Set an endpoint URL first.' };
  try {
    const response = await fetch(`${base}/models`, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? ' — check the API key' : '';
      return { models: [], note: `Model list unavailable (HTTP ${response.status})${hint}. Type the model id.` };
    }
    const data = await response.json();
    const ids = (Array.isArray(data?.data) ? data.data : [])
      .map((m) => (typeof m === 'string' ? m : m?.id))
      .filter((id) => typeof id === 'string' && id.trim());
    // Free variants first: this terminal defaults to a free model, and a long
    // catalog sorted alphabetically buries exactly the ids worth trying.
    const models = [...new Set(ids)].sort((a, b) => (
      Number(b.endsWith(':free')) - Number(a.endsWith(':free')) || a.localeCompare(b)
    ));
    return models.length
      ? { models, note: `${models.length} models offered by this endpoint` }
      : { models: [], note: 'Endpoint returned no models. Type the model id.' };
  } catch {
    return { models: [], note: 'Could not reach the endpoint. Type the model id.' };
  }
}

/** Read the provider's remaining-budget headers, when CORS exposes them.
 * Not every endpoint sets Access-Control-Expose-Headers, so a null here is
 * normal and simply means the readout is unavailable for that provider. */
function readLimits(headers) {
  const int = (name) => {
    const raw = headers.get(name);
    const parsed = Number(raw);
    return raw && Number.isFinite(parsed) ? parsed : null;
  };
  const tpm = int('x-ratelimit-remaining-tokens');
  const rpd = int('x-ratelimit-remaining-requests');
  if (tpm === null && rpd === null) return null;
  return {
    tpm_remaining: tpm,
    rpd_remaining: rpd,
    tpm_limit: int('x-ratelimit-limit-tokens'),
    rpd_limit: int('x-ratelimit-limit-requests'),
  };
}

/**
 * Condense a provider rate-limit body into one readable line.
 *
 * The raw 429 carries the organisation id, the model, the service tier, a
 * millisecond retry hint and an upgrade pitch. None of that belongs in a
 * transcript next to the user's question.
 */
function tidyRateLimit(text, retryAfter) {
  const raw = String(text || '');
  // "Used 5791, Requested" — the character class would swallow that comma.
  const grab = (re) => raw.match(re)?.[1]?.replace(/[,\s]+$/, '');
  const used = grab(/Used\s+([\d,]+)/i);
  const limit = grab(/Limit\s+([\d,]+)/i);
  const millis = raw.match(/try again in\s+([\d.]+)\s*ms/i)?.[1];
  const parts = ['Rate limit reached'];
  if (used && limit) parts.push(`${used} of ${limit} tokens/min used`);
  else if (raw.trim()) parts.push(raw.split(/\.\s| · /)[0].slice(0, 110));
  let seconds;
  if (millis !== undefined) seconds = Math.max(1, Math.round(Number(millis) / 1000));
  else if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed)) seconds = parsed;
  }
  if (seconds !== undefined) parts.push(`retry in ${seconds}s`);
  return `${parts.join(' · ')}.`;
}

async function callProvider(cfg, payload) {
  const base = String(cfg.url || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Set the endpoint URL in ⚙ CHAT.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const raw = (data && data.error && (data.error.message || data.error.message)) || (data && data.error) || '';
      if (response.status === 429) {
        throw new Error(tidyRateLimit(raw, response.headers.get('retry-after')));
      }
      const detail = raw ? ` · ${String(raw).slice(0, 200)}` : '';
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    return { data, limits: readLimits(response.headers) };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the chat loop against the user's configured endpoint.
 *
 * @param {object} settings - from loadChatSettings()
 * @param {Array} messages - full conversation, system prompt first
 * @param {(progress: {round: number, limits: object|null, final?: boolean}) => void} [onProgress]
 * @returns {Promise<{messages: Array, content: string, limits: object|null}>}
 */
const KNOWN_TOOLS = new Set(CHAT_TOOLS.map((tool) => tool.function.name));
const CHAT_TRACE_LIMIT = 60;

/** Closing instruction for the tool-free turn that ends a capped run. */
const FINAL_TURN_PROMPT = 'Tool budget spent. Answer now from the data above: lead with the '
  + 'best supported figure or fact, then state plainly what the data does not cover.';

/**
 * State the real tool budget in the system prompt.
 *
 * The shared prompt cannot quote a number the browser owns, and a model that has
 * to guess spends one call per round and arrives at the cap with no answer.
 * This rewrites the system message in place instead of adding a second one,
 * which some OpenAI-compatible providers reject mid-conversation.
 */
function stateToolBudget(messages, maxRounds) {
  const line = `Tool budget: ${maxRounds} call${maxRounds === 1 ? '' : 's'} for this question,`
    + ' then you must answer from what you already have. Batch independent calls into a single'
    + ' turn instead of one per turn, and name what is missing rather than fetching more.';
  const system = messages.find((m) => m.role === 'system');
  if (system) system.content = `${system.content} ${line}`;
  else messages.unshift({ role: 'system', content: line });
}

/** Append one entry to the tool-call trace the debug pane renders. */
function traceCall(entry) {
  state.chatToolCalls.unshift({ at: Date.now(), ...entry });
  if (state.chatToolCalls.length > CHAT_TRACE_LIMIT) {
    state.chatToolCalls.length = CHAT_TRACE_LIMIT;
  }
  emit('chat:tools', state.chatToolCalls);
}

function startTrace(model, rounds) {
  state.chatRun = { at: Date.now(), model, rounds, outcome: 'RUNNING', reason: '', calls: 0 };
  emit('chat:tools', state.chatToolCalls);
}

function endTrace(outcome, reason = '') {
  if (!state.chatRun) return;
  state.chatRun.outcome = outcome;
  state.chatRun.reason = reason;
  state.chatRun.elapsed = Date.now() - state.chatRun.at;
  emit('chat:tools', state.chatToolCalls);
}

export async function sendChat(settings, messages, onProgress) {
  const cfg = { ...CHAT_DEFAULTS, ...(settings || {}) };
  const conversation = messages.map((m) => ({ ...m }));
  const maxRounds = num(cfg.maxRounds, CHAT_DEFAULTS.maxRounds, 1, 8);
  const toolChars = num(cfg.toolResultChars, CHAT_DEFAULTS.toolResultChars, 300, 16000);
  const budget = num(cfg.inputBudget, CHAT_DEFAULTS.inputBudget, 500, 200000);
  const toolsTokens = estimateTokens(CHAT_TOOLS);
  const seenCalls = new Set();
  let inventedCalls = 0;
  let limits = null;
  stateToolBudget(conversation, maxRounds);
  startTrace(cfg.model, maxRounds);

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const { messages: trimmed, tokens } = pruneConversation(conversation, budget, toolsTokens);
      const { data, limits: seen } = await callProvider(cfg, {
        model: cfg.model,
        messages: trimmed,
        tools: CHAT_TOOLS,
        tool_choice: 'auto',
        temperature: num(cfg.temperature, CHAT_DEFAULTS.temperature, 0, 2),
        max_completion_tokens: num(cfg.maxCompletionTokens, CHAT_DEFAULTS.maxCompletionTokens, 64, 32000),
        stream: false,
      });

      limits = seen;
      if (onProgress) onProgress({ round: round + 1, limits, inputTokens: tokens });

      const message = data?.choices?.[0]?.message;
      if (!message) throw new Error('No chat completion returned.');

      // Preserve the provider's tool_call ids verbatim: the next round pairs
      // them with `tool` results, and a regenerated id breaks that pairing.
      conversation.push({ ...message, role: 'assistant' });

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length) {
        endTrace('ANSWERED');
        return { messages: conversation, content: message.content || '', limits };
      }

      // A model that asks for a function we do not define has invented it. Give
      // it one correction naming the real functions — most questions have a
      // usable proxy, and aborting outright would block answers it could have
      // produced. A second invention means it is not recovering, so stop before
      // the remaining rounds burn the per-minute budget.
      const invented = toolCalls.find((call) => !KNOWN_TOOLS.has(call?.function?.name));
      if (invented) {
        inventedCalls += 1;
        traceCall({
          round: round + 1,
          name: invented.function?.name || '(unnamed)',
          args: String(invented.function?.arguments || ''),
          status: 'INVENTED',
          detail: `no such function · correction issued (${inventedCalls}/1)`,
          chars: 0,
          ms: 0,
        });
        if (inventedCalls > 1) {
          throw new Error(
            `The model tried to call "${invented.function?.name}", which this terminal does not have. `
            + 'Rialto covers news, markets, vessels, aircraft, conflicts, outbreaks, listings, and the current screen state.',
          );
        }
        conversation.push({
          role: 'tool',
          tool_call_id: invented.id,
          name: invented.function?.name,
          content: `No such function. Available functions: ${[...KNOWN_TOOLS].join(', ')}. `
            + 'Pick the closest one that informs the answer, or reply without calling anything.',
        });
        continue;
      }

      for (const call of toolCalls) {
        let args = {};
        try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { args = {}; }
        const signature = `${call?.function?.name}:${JSON.stringify(args)}`;
        if (seenCalls.has(signature)) {
          traceCall({
            round: round + 1,
            name: call?.function?.name,
            args: JSON.stringify(args),
            status: 'REPEAT',
            detail: 'identical call already made in this run',
            chars: 0,
            ms: 0,
          });
          throw new Error(
            `The model repeated the same call (${call?.function?.name}) without new information. `
            + 'It is looping rather than answering — try rephrasing the question.',
          );
        }
        seenCalls.add(signature);
        const startedAt = Date.now();
        let out;
        let status = 'OK';
        let detail = '';
        try {
          out = await executeChatTool(call?.function?.name, args);
          if (out && typeof out === 'object' && out.error) {
            status = 'ERROR';
            detail = String(out.error);
          }
        } catch (err) {
          out = { error: String(err?.message || err) };
          status = 'ERROR';
          detail = String(err?.message || err);
        }
        const content = shrinkToolResult(out, toolChars);
        const rawChars = (typeof out === 'string' ? out : JSON.stringify(out) || '').length;
        traceCall({
          round: round + 1,
          name: call?.function?.name,
          args: JSON.stringify(args),
          status,
          detail: detail || `sent ${rawChars} chars`,
          chars: content.length,
          shrunk: content.length < rawChars,
          ms: Date.now() - startedAt,
        });
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call?.function?.name,
          content,
        });
      }
    }

    // The round cap is a cost cap, not a reason to throw away an answer the
    // model can already give: at this point it is holding every result it
    // gathered. One last turn with no tools attached makes it commit to those
    // instead of the question dying with data already in the transcript.
    const { messages: trimmed, tokens } = pruneConversation(conversation, budget);
    const { data, limits: seen } = await callProvider(cfg, {
      model: cfg.model,
      messages: [...trimmed, { role: 'user', content: FINAL_TURN_PROMPT }],
      temperature: num(cfg.temperature, CHAT_DEFAULTS.temperature, 0, 2),
      max_completion_tokens: num(cfg.maxCompletionTokens, CHAT_DEFAULTS.maxCompletionTokens, 64, 32000),
      stream: false,
    });
    limits = seen;
    if (onProgress) onProgress({ round: maxRounds + 1, limits, inputTokens: tokens, final: true });

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      throw new Error(
        `Stopped at the ${maxRounds}-round tool limit without an answer. Raise "Max rounds" in ⚙ CHAT, or ask something narrower.`,
      );
    }
    conversation.push({ role: 'assistant', content: answer });
    endTrace('ANSWERED', `tool cap of ${maxRounds} rounds reached · answered from the ${seenCalls.size} gathered result${seenCalls.size === 1 ? '' : 's'}`);
    return { messages: conversation, content: answer, limits };
  } catch (err) {
    endTrace('ABORTED', String(err?.message || err));
    throw err;
  }
}