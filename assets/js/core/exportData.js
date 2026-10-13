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
    changeReference: quote?.changeReference || 'UNSPECIFIED',
    changeReferencePrice: quote?.changeReferencePrice == null || !Number.isFinite(Number(quote.changeReferencePrice)) ? null : Number(quote.changeReferencePrice),
    latestQuoteAsOf: Number.isFinite(asof) && asof > 0 ? new Date(asof * 1000).toISOString() : null,
    marketState: quote?.marketState || 'UNKNOWN',
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
      ...(rule.gateChecks || []).filter((check) => !check.passed).map((check) => `Gate: ${check.detail}`),
      ...(rule.requirements || []).filter((requirement) => !requirement.passed)
        .map((requirement) => `Signal not observed or not evaluable: ${requirement.label} (weight ${requirement.weight})`),
    ],
  }));
  const marketDivergences = rules.flatMap((rule) => (rule.effects || [])
    .filter((effect) => /^OPPOSITE\b/.test(effect.quoteStatus || ''))
    .map((effect) => ({
      rule: rule.id,
      title: rule.title,
      symbol: effect.symbol,
      name: effect.name,
      expectedDirection: effect.dir,
      observed: effect.quoteStatus,
      interpretation: 'Observed move contradicts this rule effect; this is a divergence flag, not evidence of causation.',
    })));
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
    sources: {
      evaluatedAt: Number.isFinite(evaluatedAt) && evaluatedAt > 0 ? new Date(evaluatedAt).toISOString() : null,
      inputCoverage: diagnostics.inputs || {},
      // Every rule the engine looked at, not only the ones that fired: a rule
      // that fell short is the more interesting half of the record, and its
      // checklist shows exactly which signal was missing.
      rules: rules.map((rule) => ({
        id: rule.id,
        title: rule.title,
        summary: rule.summary,
        status: rule.status,
        triggered: rule.triggered ?? rule.status === 'FIRED',
        scoreMet: rule.scoreMet ?? rule.score >= rule.minScore,
        watchReason: rule.watchReason || '',
        contextReason: rule.contextReason || '',
        score: rule.score,
        maxScore: rule.maxScore,
        minScore: rule.minScore,
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
          value: requirement.detail || '',
        })),
        effects: effectRows(rule.effects),
      })),
      // The quotes the market signals read, so every "observed" move above can
      // be checked against a price rather than taken on trust.
      quoteChangeBasis: 'Percent change and change are measured against Yahoo Finance chartPreviousClose when supplied, otherwise Yahoo Finance previousClose. This is provider metadata; the app does not independently verify the reference against an exchange settlement feed.',
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
          outages: state.warWorldMonitor?.outages?.length || 0,
          chokepoints: state.warWorldMonitor?.chokepoints?.length || 0,
        },
        diseaseOutbreaks: state.diseaseOutbreaks?.length || 0,
        marketInstruments: state.market.length,
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
