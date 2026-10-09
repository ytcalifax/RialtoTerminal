import { $ } from '../core/dom.js';
import { fmtTime } from '../core/format.js';
import { req } from '../core/net.js';

let requestId = 0;
const FACTORS = [
  ['SENTIMENT', 'sentiment'],
  ['VOLATILITY', 'volatility'],
  ['POSITIONING', 'positioning'],
  ['TREND', 'trend'],
  ['BREADTH', 'breadth'],
  ['MOMENTUM', 'momentum'],
  ['LIQUIDITY', 'liquidity'],
  ['CREDIT', 'credit'],
  ['MACRO', 'macro'],
  ['CROSS-ASSET', 'crossAsset'],
];

async function loadMarketSentiment() {
  const id = ++requestId;
  try {
    const result = await req('/api/market-sentiment');
    if (id !== requestId) return;
    const fear = result.fear_greed;
    const score = Number(fear?.compositeScore);
    if (!fear || !Number.isFinite(score)) throw new Error('INDEX UNAVAILABLE');
    $('#fearGreedScore').textContent = score.toFixed(1);
    $('#fearGreedLabel').textContent = fear.compositeLabel || 'UNRATED';
    $('#fearGreedMarker').hidden = false;
    $('#fearGreedMarker').style.left = `${Math.max(0, Math.min(100, score))}%`;
    const cnnScore = fear.cnnFearGreed == null ? NaN : Number(fear.cnnFearGreed);
    const previous = fear.previousScore == null ? NaN : Number(fear.previousScore);
    $('#cnnFearGreed').textContent = `CNN ${fear.cnnLabel || '—'}${Number.isFinite(cnnScore) ? ` ${cnnScore}` : ''}`;
    $('#fearGreedPrevious').textContent = `PRIOR ${Number.isFinite(previous) ? previous.toFixed(1) : '—'}`;
    $('#fearGreedFactors').innerHTML = FACTORS.map(([label, key]) => {
      const factor = fear[key];
      const raw = factor?.score;
      const value = raw == null ? NaN : Number(raw);
      if (!Number.isFinite(value)) return `<div class="fear-greed-factor unavailable" title="${label} factor unavailable"><span>${label}</span><i></i><strong>—</strong></div>`;
      const percent = Math.max(0, Math.min(100, value));
      const weight = Number.isFinite(Number(factor.weight)) ? ` · WEIGHT ${(Number(factor.weight) * 100).toFixed(0)}%` : '';
      const degraded = factor.degraded ? ' · DEGRADED INPUT' : '';
      return `<div class="fear-greed-factor${factor.degraded ? ' degraded' : ''}" title="${label}${weight}${degraded}"><span>${label}${factor.degraded ? ' *' : ''}</span><i><b style="width:${percent}%"></b></i><strong>${Math.round(value)}</strong></div>`;
    }).join('');
    const sourceAt = Date.parse(fear.seededAt || '');
    const sourceLabel = Number.isFinite(sourceAt)
      ? `SRC ${new Date(sourceAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase()} ${fmtTime(sourceAt)}`
      : 'SRC TIME N/A';
    $('#fearGreedUpdated').textContent = sourceLabel;
    $('#fearGreedFetched').textContent = `${result.stale ? 'CACHED' : 'FETCH'} ${fmtTime(Number(result.fetched) * 1000)}`;
    $('#fearGreedUpdated').title = `Source snapshot: ${fear.seededAt || 'timestamp unavailable'} · API fetched: ${fmtTime(Number(result.fetched) * 1000)}`;
  } catch (error) {
    if (id !== requestId) return;
    $('#fearGreedLabel').textContent = error.message || 'INDEX UNAVAILABLE';
    $('#fearGreedUpdated').textContent = 'WORLD MONITOR UNAVAILABLE';
  }
}

export { loadMarketSentiment };
