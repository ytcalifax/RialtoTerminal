const fmtTime = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(+date)
    ? String(d).slice(0, 14)
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Unix timestamp for a feed date string (RSS, Atom, compact ISO).
 * Returns 0 when unparseable so sorting stays deterministic.
 */
function newsTimestamp(raw) {
  if (!raw) return 0;
  let d = new Date(raw);
  if (!Number.isNaN(+d)) return +d;
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}
function timeAgo(raw) {
  if (!raw) return 'TIME N/A';
  let d = new Date(raw);
  if (Number.isNaN(+d)) {
    const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (m) d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  }
  if (Number.isNaN(+d)) return 'TIME N/A';
  const min = Math.max(0, Math.floor((Date.now() - d) / 60000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
}
function ageLabel(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const s = Math.max(0, Number(sec));
  return s < 3600 ? `${Math.floor(s / 60)}m`
    : s < 86400 ? `${Math.floor(s / 3600)}h`
    : `${Math.floor(s / 86400)}d`;
}

export { fmtTime, newsTimestamp, timeAgo, ageLabel };
