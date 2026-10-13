const STATUS_ORDER = { FIRED: 0, BUILDING: 1, 'GATE CLOSED': 2, 'BELOW THRESHOLD': 3 };

export function decisionWatchRules(rules = []) {
  return [...rules].sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4));
}
