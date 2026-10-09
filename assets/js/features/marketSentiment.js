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
      const raw = fear[key]?.score;
      const value = raw == null ? NaN : Number(raw);
      if (!Number.isFinite(value)) return '';
      const percent = Math.max(0, Math.min(100, value));
      return `<div class="fear-greed-factor"><span>${label}</span><i><b style="width:${percent}%"></b></i><strong>${Math.round(value)}</strong></div>`;
    }).join('');
    $('#fearGreedUpdated').textContent = `${result.stale ? 'CACHED' : 'UPDATED'} ${fmtTime(Number(result.fetched) * 1000)}`;
  } catch (error) {
    if (id !== requestId) return;
    $('#fearGreedLabel').textContent = error.message || 'INDEX UNAVAILABLE';
    $('#fearGreedUpdated').textContent = 'WORLD MONITOR UNAVAILABLE';
  }
}

export { loadMarketSentiment };
