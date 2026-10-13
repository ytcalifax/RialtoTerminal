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

/** Per-effect market evidence: the instrument, what was seen and how the quote checked out. */
const effectRows = (effects = []) => effects.map((effect) => ({
  symbol: effect.symbol,
  name: effect.name,
  direction: effect.dir,
  observed: effect.observed || '',
  quote: effect.quoteStatus || '',
}));

function exportAlertsText() {
  const diagnostics = state.deductionDiagnostics || { at: null, rules: [] };
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    workspace: state.page,
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
    deductions: state.deductions.map((deduction) => ({
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
    sources: {
      evaluatedAt: diagnostics.at || null,
      // Every rule the engine looked at, not only the ones that fired: a rule
      // that fell short is the more interesting half of the record, and its
      // checklist shows exactly which signal was missing.
      rules: (diagnostics.rules || []).map((rule) => ({
        id: rule.id,
        title: rule.title,
        summary: rule.summary,
        status: rule.status,
        watchReason: rule.watchReason || '',
        score: rule.score,
        maxScore: rule.maxScore,
        minScore: rule.minScore,
        gate: {
          description: rule.gateDescription || '',
          passed: rule.gatePassed,
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
      quotes: state.deductionQuotes || [],
      feedCounts: {
        news: state.news.length,
        conflictReports: state.warReports.length,
        worldMonitor: state.warWorldMonitor?.features?.length || 0,
        diseaseOutbreaks: state.diseaseOutbreaks?.length || 0,
        marketInstruments: state.market.length,
        vessels: state.ships.length,
        aircraft: state.aircraft.length,
      },
      feedTimestamps: state.timestamps,
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
