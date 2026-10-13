/** Preserve the AND/OR structure of activation gates for explanations. */
export function describeGatePath(gatePassed, gateChecks = []) {
  const groups = (gateChecks || []).map((check, index) => {
    const alternatives = Array.isArray(check.alternatives) && check.alternatives.length
      ? check.alternatives.map((item) => ({ label: item.label, passed: Boolean(item.passed), detail: item.detail || '' }))
      : [{ label: check.label || `Gate condition ${index + 1}`, passed: Boolean(check.passed), detail: check.detail || '' }];
    return { operator: check.operator || 'AND', passed: Boolean(check.passed), alternatives, detail: check.detail || '' };
  });
  const unmet = gatePassed ? [] : groups.filter((group) => !group.passed);
  const text = unmet.map((group) => `(${group.alternatives.map((item) => `${item.label}${item.passed ? ' ✓' : ''}`).join(` ${group.operator} `)})`).join(' AND ');
  return { groups, unmet, text };
}
