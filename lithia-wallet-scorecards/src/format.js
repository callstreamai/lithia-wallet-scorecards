export const pct = (v, digits = 1) => (v == null ? '—' : `${(Number(v) * 100).toFixed(digits)}%`);
export const int = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function periodLabelLong(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function updatedLabel(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

/** Status of each KPI against targets. 'good' | 'watch' | 'na' */
export function kpiStatus(totals, settings) {
  if (!totals) return { booking: 'na', transfer: 'na' };
  return {
    booking: totals.booking_rate == null ? 'na' : Number(totals.booking_rate) >= Number(settings.booking_rate_target) ? 'good' : 'watch',
    transfer: totals.transfer_rate == null ? 'na' : Number(totals.transfer_rate) <= Number(settings.transfer_rate_max) ? 'good' : 'watch',
  };
}

/** Value with a compact status glyph for wallet fields (no colour support there). */
export function withGlyph(value, status) {
  if (status === 'good') return `${value} ✓`;
  if (status === 'watch') return `${value} ▲`;
  return value;
}

/** One-line summary for a store, used in Apple back fields and Google detail rows. */
export function storeLine(s) {
  return [
    `Booking ${pct(s.booking_rate)}`,
    `Contain ${pct(s.containment_rate, 0)}`,
    `Transfer ${pct(s.transfer_rate, 0)}`,
    `${int(s.calls_total)} calls`,
    `${int(s.customers_served)} customers`,
  ].join(' · ');
}
