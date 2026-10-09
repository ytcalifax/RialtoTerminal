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
const EXPECTED_INPUTS = {
  sentiment: ['cnnFearGreed', 'aaiBull', 'aaiBear', 'cryptoFg'],
  volatility: ['vix', 'vix9d', 'vix3m'],
  positioning: ['putCallRatio', 'skew'],
  trend: ['spxPrice', 'sma20', 'sma50', 'sma200'],
  breadth: ['pctAbove200d', 'rspSpyRatio', 'advDecRatio'],
  momentum: ['spxRoc20d', 'sectorRsiAvg'],
  liquidity: ['m2Yoy', 'fedBsMom', 'sofr'],
  credit: ['hySpread', 'igSpread', 'hyTrend30d'],
  macro: ['fedRate', 't10y2y', 'unrate'],
  crossAsset: ['goldReturn30d', 'tltReturn30d', 'spyReturn30d', 'dxyChange30d'],
};

function factorInputs(factor) {
  if (factor?.inputs && typeof factor.inputs === 'object') return factor.inputs;
  try { return JSON.parse(factor?.inputsJson || '{}'); } catch { return {}; }
}

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
      const inputs = factorInputs(factor);
      const missing = (EXPECTED_INPUTS[key] || []).filter((input) => inputs[input] == null);
      const partial = Boolean(factor.degraded) || missing.length > 0;
      const inputStatus = factor.degraded ? ' · SOURCE MARKED DEGRADED' : '';
      const missingStatus = missing.length ? ` · MISSING ${missing.join(', ')}` : '';
      const title = `${label}${weight}${inputStatus}${missingStatus}`;
      return `<div class="fear-greed-factor${partial ? ' degraded' : ''}" title="${title}"><span>${label}${partial ? ' *' : ''}</span><i><b style="width:${percent}%"></b></i><strong>${Math.round(value)}</strong></div>`;
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
