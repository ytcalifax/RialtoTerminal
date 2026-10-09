import { MAX_PINNED_SYMBOLS, PINNED_COOKIE } from './constants.js';

const SYMBOL_RE = /^[A-Za-z0-9^.\-=]{1,15}$/;
export function loadPins() {
  try {
    const match = document.cookie
      .split('; ')
      .find((c) => c.startsWith(PINNED_COOKIE + '='));
    if (!match) return [];
    const raw = JSON.parse(decodeURIComponent(match.split('=').slice(1).join('=')));
    if (!Array.isArray(raw)) return [];
    const pins = [];
    const seen = new Set();
    let removedFuelPins = false;
    for (const entry of raw) {
      if (!entry || !SYMBOL_RE.test(String(entry.symbol || ''))) continue;
      const symbol = String(entry.symbol).toUpperCase();
      if (symbol.startsWith('FUEL-')) {
        removedFuelPins = true;
        continue;
      }
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      pins.push({ symbol, name: String(entry.name || symbol).slice(0, 60) });
      if (pins.length >= MAX_PINNED_SYMBOLS) break;
    }
    if (removedFuelPins) savePins(pins);
    return pins;
  } catch {
    return [];
  }
}
export function savePins(pins) {
  try {
    const value = encodeURIComponent(JSON.stringify(pins.slice(0, MAX_PINNED_SYMBOLS)));
    document.cookie = `${PINNED_COOKIE}=${value}; max-age=31536000; path=/; SameSite=Lax`;
  } catch {
    /* ignore cookie write errors in restricted or sandboxed environments */
  }
}
export function withPin(pins, symbol, name) {
  const sym = String(symbol || '').toUpperCase();
  if (!SYMBOL_RE.test(sym) || pins.some((p) => p.symbol === sym)) return pins;
  return [...pins, { symbol: sym, name: String(name || sym).slice(0, 60) }].slice(0, MAX_PINNED_SYMBOLS);
}
export function withoutPin(pins, symbol) {
  const sym = String(symbol || '').toUpperCase();
  return pins.filter((p) => p.symbol !== sym);
}
