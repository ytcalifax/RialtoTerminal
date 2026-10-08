import { state } from './state.js';

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

async function copyCurrentData(button) {
  const text = exportText();
  let copied = false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Fall through to the legacy clipboard path.
    }
  }
  if (!copied) {
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
  const original = button.dataset.copyLabel || button.textContent;
  button.dataset.copyLabel = original;
  button.textContent = 'COPIED';
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1600);
}

export { copyCurrentData };
