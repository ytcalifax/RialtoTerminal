import { state } from './state.js';
import { deductionNotificationText } from './deduction.js';

/**
 * Alerts export: the activity list, the deduction text each alert is built
 * from, and the evidence behind every rule.
 *
 * The activity list on its own is a bare claim — "FUEL PRICE PRESSURE" with the
 * numbers stripped out — so it cannot be checked or argued with. This carries
 * the whole basis for the pass: every rule that was evaluated, fired or not,
 * with each source signal's weight and the value that signal actually read, so
 * the pasted JSON shows both what fired and what was close.
 */

function exportText() {
  const data = {
    workspace: state.page,
    capturedAt: new Date().toISOString(),
    news: {
      feed: state.feed,
      country: state.newsCountry,
      query: state.newsQuery,
      items: state.news,
      sources: state.newsSources,
      ingestion: state.newsMeta || null,
      staleSources: state.newsStaleSources || [],
      displayedDataStale: Boolean(state.newsDataStale),
    },
    markets: {
      group: state.marketGroup,
      query: state.marketQuery,
      items: state.market,
      pins: state.pins,
    },
    vessels: {
      region: state.shipsRegion,
      items: state.ships,
    },
    aircraft: {
      region: state.airRegion,
      items: state.aircraft,
    },
    conflict: {
      reports: state.warReports,
      frontline: state.warFrontline,
      gpsJam: state.warGpsJam,
      worldMonitor: state.warWorldMonitor,
      enabledTypes: state.conflictTypes,
      dateRange: state.conflictDateRange,
    },
    marketplace: {
      query: state.marketplaceQuery,
      items: state.marketplace,
    },
    selections: {
      instrument: state.selectedInstrument,
      track: state.selectedTrack,
      aircraftInfo: state.airInfo,
    },
    timestamps: state.timestamps,
    errors: state.errors,
  };
  return JSON.stringify(data, null, 2);
}

/** Per-effect market evidence, including last-session values when not scoreable. */
const effectRows = (effects = []) => effects.map((effect) => {
  const quote = (state.deductionQuotes || []).find((item) => item.symbol === effect.symbol);
  const asof = Number(quote?.asof);
  return {
    symbol: effect.symbol,
    name: effect.name,
    direction: effect.dir,
    observed: effect.observed || '',
    latestQuoteChangePct: quote?.pct == null || !Number.isFinite(Number(quote.pct)) ? null : Number(quote.pct),
    dailyVolatilityPct: quote?.dailyVolatilityPct ?? null,
    moveThresholdPct: quote?.moveThresholdPct ?? null,
    changeReference: quote?.changeReference || 'UNSPECIFIED',
    changeReferencePrice: quote?.changeReferencePrice == null || !Number.isFinite(Number(quote.changeReferencePrice)) ? null : Number(quote.changeReferencePrice),
    changeReferenceConsistency: quote?.changeReferenceConsistency || { status: 'UNAVAILABLE' },
    latestQuoteAsOf: Number.isFinite(asof) && asof > 0 ? new Date(asof * 1000).toISOString() : null,
    retrievedAt: Number(quote?.retrievedAt) > 0 ? new Date(Number(quote.retrievedAt) * 1000).toISOString() : null,
    marketState: quote?.marketState || 'UNKNOWN',
    exchangeCalendar: quote?.exchangeCalendar || 'UNKNOWN',
    quote: effect.quoteStatus || '',
  };
});

function exportAlertsText() {
  const diagnostics = state.deductionDiagnostics || { at: null, rules: [] };
  const rules = diagnostics.rules || [];
  const returnedQuoteSymbols = new Set((state.deductionQuotes || []).map((quote) => quote.symbol));
  const requiredQuoteSymbols = [...new Set(rules.flatMap((rule) => (rule.effects || []).map((effect) => effect.symbol)))];
  const evaluatedAt = Number(diagnostics.evaluatedAt);
  const firedRuleIds = new Set(rules.filter((rule) => rule.triggered).map((rule) => rule.id));
  const currentNextSteps = rules.filter((rule) => !firedRuleIds.has(rule.id)).map((rule) => ({
    kind: 'NEXT_STEP',
    rule: rule.id,
    title: rule.title,
    status: rule.status,
    score: rule.score,
    maxScore: rule.maxScore,
    minScore: rule.minScore,
    whatWouldChangeThis: [
      rule.minimalPath?.text || '',
    ],
    missingSignals: (rule.requirements || []).filter((requirement) => !requirement.passed).map((requirement) => ({
      signal: requirement.label,
      points: requirement.weight,
      status: requirement.dataStatus || 'NOT_OBSERVED',
    })),
  }));
  const divergenceMap = new Map();
  rules.flatMap((rule) => (rule.effects || [])
    .filter((effect) => /^OPPOSITE\b/.test(effect.quoteStatus || ''))
    .map((effect) => ({ rule, effect }))).forEach(({ rule, effect }) => {
    const key = `${effect.symbol}:${effect.dir}`;
    const finding = divergenceMap.get(key) || { type: 'MARKET_DIVERGENCE', symbol: effect.symbol, name: effect.name,
      expectedDirection: effect.dir, observed: effect.quoteStatus, rules: [] };
    finding.rules.push(rule.id);
    divergenceMap.set(key, finding);
  });
  const marketDivergences = [...divergenceMap.values()].map((finding) => ({
    ...finding,
    interpretation: 'Observed move contradicts these rule effects; this is a divergence flag, not evidence of causation.',
  }));
  for (const route of diagnostics.routeEvidence || []) {
    if (route.sourceDisagreement && !marketDivergences.some((finding) => finding.type === 'SOURCE_DISAGREEMENT' && finding.route === route.id)) {
      marketDivergences.push({ type: 'SOURCE_DISAGREEMENT', route: route.id, name: route.name, detail: route.sourceDisagreement,
        interpretation: 'Conflicting source claims are shown side by side; the World Monitor flow contribution is downweighted.' });
    }
  }
  for (const quote of state.deductionQuotes || []) {
    if (quote.changeReferenceConsistency?.status === 'METADATA_DISAGREEMENT') marketDivergences.push({
      type: 'QUOTE_METADATA_DISAGREEMENT', symbol: quote.symbol, name: quote.name,
      metadataReferencePrice: quote.changeReferenceConsistency.metadataReferencePrice,
      selectedReferencePrice: quote.changeReferencePrice,
      changeReference: quote.changeReference,
      detail: quote.changeReferenceConsistency.comparison || '',
      usedForScoring: false,
      interpretation: 'Yahoo metadata disagrees with the prior completed daily bar. The move and rule scoring use the daily bar; independent settlement confirmation remains unavailable.',
    });
  }
  const hormuz = rules.find((rule) => rule.id === 'theater-hormuz');
  const hormuzBenchmarks = hormuz?.marketConfirmation?.signals || [];
  const brent = hormuzBenchmarks.find((signal) => signal.symbol === 'BZ=F');
  const wti = hormuzBenchmarks.find((signal) => signal.symbol === 'CL=F');
  if (brent && wti && (!brent.passed || !wti.passed)) marketDivergences.push({
    type: 'BRENT_WTI_NON_CONFIRMATION',
    rule: 'theater-hormuz',
    status: brent.passed !== wti.passed ? 'MIXED_CONFIRMATION' : 'BOTH_NOT_CONFIRMING',
    brent: { passed: brent.passed, detail: brent.detail },
    wti: { passed: wti.passed, detail: wti.detail },
    spread: hormuzBenchmarks.find((signal) => signal.symbol === null) || null,
    interpretation: 'Brent and WTI confirmation disagree; Hormuz market confirmation weights Brent and the Brent–WTI spread more heavily than WTI.',
  });
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    workspace: state.page,
    evaluation: {
      evaluatedAt: Number.isFinite(evaluatedAt) && evaluatedAt > 0 ? new Date(evaluatedAt).toISOString() : null,
      status: !Number.isFinite(evaluatedAt) || evaluatedAt <= 0 ? 'NOT_EVALUATED'
        : Object.values(state.errors).some(Boolean) ? 'PARTIAL' : 'COMPLETE',
      statusSemantics: 'FIRED means gate passed and score met the threshold; BUILDING means the gate passed and score reached at least 80% of the threshold; GATE CLOSED means an activation gate failed. Gate-closed rules are diagnostic only. Ongoing conflict is context; the theater gate requires rising severity-weighted activity or accelerating headlines.',
    },
    alerts: {
      count: state.notifications.length,
      items: state.notifications.map((item) => ({
        at: item.at,
        title: item.title,
        detail: item.detail,
        link: item.link || '',
      })),
    },
    // Deductions that crossed their threshold, quoted exactly as the activity
    // list shows them, with the weighted evidence that carried them there.
    deductions: [
      ...state.deductions.map((deduction) => ({
        kind: 'FIRED',
        fingerprint: deduction.fingerprint,
        dedupeBasis: deduction.dedupeBasis || 'legacy rule-level key',
        evidenceSignature: deduction.evidenceSignature || '',
        rule: deduction.rule,
        title: deduction.title,
        summary: deduction.summary,
        score: deduction.score,
        maxScore: deduction.maxScore,
        minScore: deduction.minScore,
        evidenceCoveragePct: deduction.evidenceCoveragePct,
        hits: deduction.hits,
        firstAt: deduction.firstAt,
        lastAt: deduction.lastAt,
        lastNotifiedAt: deduction.lastNotified,
        notification: deductionNotificationText(deduction),
        causes: (deduction.causes || []).map((cause) => ({
          source: cause.source,
          weight: cause.weight ?? null,
          value: cause.detail || '',
        })),
        effects: effectRows(deduction.effects),
      })),
      ...currentNextSteps,
    ],
    findings: marketDivergences,
    alertDelivery: {
      channels: ['in-app', ...(state.alertSettings?.browserNotifications ? ['browser-notification'] : [])],
      dedupeKey: 'rule id plus normalized cause-evidence signature',
      cooldownSeconds: 21600,
      externalChannels: { email: 'NOT_CONFIGURED', webhook: 'NOT_CONFIGURED', push: 'NOT_CONFIGURED' },
      activityPersistence: 'server-side local SQLite history shared across browser sessions (maximum 500 entries), with browser storage as an offline fallback; stored on this installation only',
    },
    sources: {
      evaluatedAt: Number.isFinite(evaluatedAt) && evaluatedAt > 0 ? new Date(evaluatedAt).toISOString() : null,
      inputCoverage: diagnostics.inputs || {},
      routeEvidence: diagnostics.routeEvidence || [],
      // Every rule the engine looked at, not only the ones that fired: a rule
      // that fell short is the more interesting half of the record, and its
      // checklist shows exactly which signal was missing.
      rules: rules.map((rule) => ({
        id: rule.id,
        title: rule.title,
        summary: rule.summary,
        status: rule.status,
        shockType: rule.shockType || null,
        triggered: rule.triggered ?? rule.status === 'FIRED',
        scoreMet: rule.scoreMet ?? rule.score >= rule.minScore,
        watchReason: rule.watchReason || '',
        contextReason: rule.contextReason || '',
        score: rule.score,
        maxScore: rule.maxScore,
        minScore: rule.minScore,
        minimalPath: rule.minimalPath || null,
        confidence: rule.confidence || null,
        scoreHistory: rule.scoreHistory || [],
        trend: rule.trend || null,
        gate: {
          required: rule.gateRequired ?? rule.gateDescription !== 'No separate gate.',
          description: rule.gateDescription || '',
          passed: (rule.gateRequired ?? rule.gateDescription !== 'No separate gate.') ? rule.gatePassed : null,
          checks: rule.gateChecks || [],
        },
        sources: (rule.requirements || []).map((requirement) => ({
          signal: requirement.label,
          weight: requirement.weight,
          passed: requirement.passed,
          dataStatus: requirement.dataStatus || (requirement.passed ? 'OBSERVED' : 'NOT_OBSERVED'),
          value: requirement.detail || '',
        })),
        effects: effectRows(rule.effects),
        marketConfirmation: rule.marketConfirmation || null,
      })),
      // The quotes the market signals read, so every "observed" move above can
      // be checked against a price rather than taken on trust.
      quoteChangeBasis: 'Percent change used for scoring is measured against the preceding completed daily bar from Yahoo Finance chart history; stale chartPreviousClose/previousClose metadata is not used when two or more daily bars exist. Metadata disagreements are flagged separately. Daily volatility is the population standard deviation of up to 20 daily close-to-close returns; moveThresholdPct is max(0.2%, half that volatility). Independent exchange settlement verification is unavailable.',
      quoteTimestampBasis: 'asof is Yahoo regularMarketTime when at least as recent as the latest daily bar timestamp; otherwise it is the latest daily bar timestamp. It is quote time, not API retrieval time.',
      quotes: state.deductionQuotes || [],
      quoteCoverage: {
        requiredByRules: requiredQuoteSymbols,
        returned: [...returnedQuoteSymbols],
        missing: requiredQuoteSymbols.filter((symbol) => !returnedQuoteSymbols.has(symbol)),
        stale: (state.deductionQuotes || []).filter((quote) => quote.stale === true).map((quote) => quote.symbol),
      },
      feedCounts: {
        news: state.news.length,
        conflictReports: state.warReports.length,
        worldMonitor: {
          armed: state.warWorldMonitor?.armed?.length || 0,
          ucdp: state.warWorldMonitor?.ucdp?.length || 0,
          acled: state.warWorldMonitor?.acled?.length || 0,
          sourceStatus: state.warWorldMonitor?.source_status || {},
          outages: state.warWorldMonitor?.outages?.length || 0,
          chokepoints: state.warWorldMonitor?.chokepoints?.length || 0,
        },
        diseaseOutbreaks: state.diseaseOutbreaks?.length || 0,
        marketInstruments: {
          currentGroup: state.marketGroup,
          returnedInCurrentGroup: state.market.length,
          expectedInCurrentGroup: state.marketGroupExpected?.[state.marketGroup] ?? null,
          quoteServiceCached: (state.deductionQuotes || []).length,
          note: 'Market group size changes when a different group is selected; the alert engine separately fetches its rule watchlist.',
        },
        vessels: state.ships.length,
        aircraft: state.aircraft.length,
      },
      conflictCoverage: state.warCoverage || null,
      feedTimestamps: state.timestamps,
      timestampUnits: {
        feedTimestamps: 'milliseconds since Unix epoch',
        quoteAsOf: 'seconds since Unix epoch',
      },
      errors: state.errors,
    },
  }, null, 2);
}

/** Put text on the clipboard, preferring the async API and falling back. */
async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy clipboard path.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  if (!document.execCommand('copy')) {
    textarea.remove();
    throw new Error('Clipboard access is unavailable');
  }
  textarea.remove();
}

/**
 * Copy JSON to the clipboard and acknowledge it on the button.
 *
 * Resolves either way: every caller here is a button with nothing to do but
 * report the outcome, so a refused clipboard (no permission, insecure context)
 * is flashed on the button rather than thrown at a caller that cannot use it.
 *
 * @param {string} text - payload to place on the clipboard
 * @param {HTMLElement} button - the control that asked for the copy
 */
async function copyJson(text, button) {
  const original = button.dataset.copyLabel || button.textContent;
  button.dataset.copyLabel = original;
  const flash = (label) => {
    button.textContent = label;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
  };
  try {
    await writeClipboard(text);
    flash('COPIED');
  } catch {
    flash('COPY FAILED');
  }
}

function copyCurrentData(button) {
  return copyJson(exportText(), button);
}

export { copyCurrentData, copyJson, exportAlertsText };
