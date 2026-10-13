function publisherDomain(report) {
  const properties = report?.properties || report || {};
  const raw = properties.domain || properties.sourceUrl || properties.url || properties.source || properties.provider || '';
  try {
    return new URL(String(raw).startsWith('http') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(raw).toLowerCase().trim();
  }
}

export function adjustConflictEvidence(reports, weightOf) {
  const sourceFamilies = new Set((reports || []).map(publisherDomain).filter(Boolean));
  const rawWeight = (reports || []).reduce((sum, report) => sum + weightOf(report), 0);
  return {
    rawWeight,
    sourceCount: sourceFamilies.size,
    sourceFamilies: [...sourceFamilies].slice(0, 5),
    weight: sourceFamilies.size < 2 ? Math.min(2, rawWeight) : rawWeight,
  };
}
