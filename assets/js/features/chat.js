import { CHAT_COOKIE } from '../core/constants.js';
import { req } from '../core/net.js';

export const CHAT_DEFAULT_MODEL = 'gpt-4o-mini';

function getCookie(name) {
  try {
    const entry = document.cookie.split('; ').find((item) => item.startsWith(name + '='));
    if (!entry) return '';
    return entry.slice(name.length + 1);
  } catch {
    return '';
  }
}

export function loadChatSettings() {
  try {
    const raw = getCookie(CHAT_COOKIE);
    if (!raw) return { url: '', apiKey: '' };
    const parsed = JSON.parse(decodeURIComponent(raw));
    return {
      url: String(parsed?.url || ''),
      apiKey: String(parsed?.apiKey || ''),
      model: String(parsed?.model || CHAT_DEFAULT_MODEL),
    };
  } catch {
    return { url: '', apiKey: '', model: CHAT_DEFAULT_MODEL };
  }
}

export function saveChatSettings(settings) {
  try {
    const payload = {
      url: String(settings?.url || '').trim(),
      apiKey: String(settings?.apiKey || '').trim(),
      model: String(settings?.model || CHAT_DEFAULT_MODEL).trim() || CHAT_DEFAULT_MODEL,
    };
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

export async function sendChat(settings, messages) {
  const base = String(settings?.url || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Chat endpoint URL is required.');
  const endpoint = `${base}/chat/completions`;
  const conversation = messages.map((m) => ({ ...m }));
  const maxRounds = 8;
  for (let round = 0; round < maxRounds; round += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings?.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings?.model || CHAT_DEFAULT_MODEL,
        messages: conversation,
        tools: CHAT_TOOLS,
        tool_choice: 'auto',
      }),
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        if (body?.error) detail = ` · ${typeof body.error === 'string' ? body.error : JSON.stringify(body.error)}`;
      } catch { /* non-json */ }
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('No chat completion returned.');
    conversation.push(message);
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length) {
      for (const call of toolCalls) {
        let args = {};
        try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { args = {}; }
        let result;
        try {
          result = await executeChatTool(call?.function?.name, args);
        } catch (err) {
          result = { error: String(err?.message || err) };
        }
        const content = typeof result === 'string' ? result : JSON.stringify(result);
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call?.function?.name,
          content: content.length > 16000 ? `${content.slice(0, 16000)}…` : content,
        });
      }
      continue;
    }
    return { messages: conversation, content: message.content || '' };
  }
  throw new Error('Too many tool rounds.');
}