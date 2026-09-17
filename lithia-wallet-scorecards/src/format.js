export const pct = (v, digits = 1) => (v == null ? '—' : `${(Number(v) * 100).toFixed(digits)}%`);
export const int = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d = (iso) => { const [y, m, day] = iso.split('-').map(Number); return { y, m, day }; };

/** "Sep 10–16" or "Aug 27–Sep 2" */
export function weekLabel(start, end) {
  const a = d(start), b = d(end);
  return a.m === b.m ? `${MON[a.m - 1]} ${a.day}–${b.day}` : `${MON[a.m - 1]} ${a.day}–${MON[b.m - 1]} ${b.day}`;
}
export function weekLabelLong(start, end) {
  return `Week of ${weekLabel(start, end)}, ${d(end).y}`;
}
/** "Sep 2026" from a month key like 2026-09-01 */
export function monthLabel(month) {
  const a = d(month);
  return `${MON[a.m - 1]} ${a.y}`;
}
export function monthLabelLong(month) {
  const a = d(month);
  return new Date(Date.UTC(a.y, a.m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Sep 17" */
export function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

export function updatedLabel(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

/**
 * Pull the rate the account is configured to display (simple average of store rates, which
 * matches the weekly Excel report, or call-weighted).
 */
export function rateOf(row, key, settings) {
  if (!row) return null;
  const agg = settings?.rate_aggregation === 'weighted' ? 'weighted' : 'simple';
  const v = row[`${key}_${agg}`];
  return v == null ? (row[key] ?? null) : Number(v);
}

/** Status of each KPI against targets. 'good' | 'watch' | 'na' */
export function kpiStatus(row, settings) {
  const book = rateOf(row, 'book_rate', settings);
  const transfer = rateOf(row, 'transfer_rate', settings);
  const contain = rateOf(row, 'containment_rate', settings);
  return {
    book: book == null ? 'na' : book >= Number(settings.booking_rate_target) ? 'good' : 'watch',
    transfer: transfer == null ? 'na' : transfer <= Number(settings.transfer_rate_max) ? 'good' : 'watch',
    contain: contain == null || settings.containment_rate_target == null ? 'na' : contain >= Number(settings.containment_rate_target) ? 'good' : 'watch',
  };
}

/** Value with a compact status glyph for wallet fields (no colour support there). */
export function withGlyph(value, status) {
  if (status === 'good') return `${value} ✓`;
  if (status === 'watch') return `${value} ▲`;
  return value;
}

/** Signed percentage-point delta, e.g. "+2.1 pts" */
export function delta(curr, prev) {
  if (curr == null || prev == null) return null;
  const pts = (Number(curr) - Number(prev)) * 100;
  const sign = pts > 0 ? '+' : pts < 0 ? '−' : '±';
  return `${sign}${Math.abs(pts).toFixed(1)} pts`;
}

/** One-line summary for a store week, used in Apple back fields and Google detail rows. */
export function storeLine(s) {
  return [
    `Book ${pct(s.book_rate)}`,
    `Contain ${pct(s.containment_rate, 0)}`,
    `Transfer ${pct(s.transfer_rate, 0)}`,
    `${int(s.calls)} calls`,
    `${int(s.customers)} customers`,
  ].join(' · ');
}
