import * as XLSX from 'xlsx';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const mon = (s) => MONTHS[s.trim().slice(0, 3).toLowerCase()];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "Week of Sep 10–16, 2026" | "Week of Aug 27–Sept 2, 2026" -> {start, end} or null */
export function parseWeekTitle(title) {
  const m = /Week of ([A-Za-z]+)\s+(\d+)\s*[–-]\s*(?:([A-Za-z]+)\s+)?(\d+),\s*(\d{4})/.exec(title || '');
  if (!m) return null;
  const [, m1, d1, m2, d2, y] = m;
  return { start: iso(y, mon(m1), d1), end: iso(y, mon(m2 || m1), d2) };
}

const num = (v) => (typeof v === 'number' ? Math.round(v) : 0);
const rate = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : null);
const hours = (v) => (typeof v === 'number' ? Math.round(v * 24 * 1000) / 1000 : null); // Excel day fraction

function* dealerRows(rows) {
  let inTable = false;
  for (const row of rows) {
    const a = row[0];
    if (a === 'Dealer') { inTable = true; continue; }
    if (!inTable || a == null) continue;
    const label = String(a).trim();
    if (/^(Source:|Subtotal|REGION TOTAL|RMO:|UNASSIGNED)/.test(label) || /^[A-Z ,.]+\s+—\s+\d+ Dealer/.test(label)) {
      yield { meta: label }; continue;
    }
    if (typeof row[2] !== 'number') continue;
    const flag = row.slice(13, 16).find((c) => typeof c === 'string' && c.trim());
    yield {
      dealer: label, customers: num(row[1]), calls: num(row[2]), call_time_hours: hours(row[3]),
      transfers: num(row[5]), status_calls: num(row[6]), appointments: num(row[7]), reschedules: num(row[8]),
      containment_rate: rate(row[9]), book_rate_reported: rate(row[10]), book_rate_prior: rate(row[11]), flag: flag ? String(flag).trim() : null,
    };
  }
}

/**
 * Parse the workbook. Returns:
 *  weeks:   [{ start, end, sheet, rows: [dealerRow] }]
 *  mapping: { [dealer]: { rmo, rmo_email, manager, manager_email, state, flag } }  (from the "by RMO" sheet, if present)
 */
export function parseReport(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const weeks = [];
  let mapping = null;

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const title = rows[1]?.[0] ? String(rows[1][0]) : '';
    if (/by Region & RMO/i.test(title)) { mapping = parseMapping(rows); continue; }
    const range = parseWeekTitle(title);
    if (!range) continue;
    weeks.push({ ...range, sheet: name, rows: [...dealerRows(rows)].filter((r) => !r.meta) });
  }
  weeks.sort((a, b) => (a.start < b.start ? 1 : -1)); // newest first
  return { weeks, mapping };
}

function parseMapping(rows) {
  const mapping = {};
  let state = null, rmo = null;
  for (const r of dealerRows(rows)) {
    if (r.meta) {
      const region = /^([A-Z ,.]+?)\s+—\s+\d+ Dealer/.exec(r.meta);
      if (region) { state = titleCase(region[1]); rmo = null; continue; }
      if (r.meta.startsWith('UNASSIGNED')) { state = null; rmo = null; continue; }
      const m = /RMO:\s*(.+?)\s+\((.+?)\)\s+Senior RMO:\s*(.+?)\s+\((.+?)\)/.exec(r.meta);
      if (m) rmo = { name: m[1].trim(), email: m[2].includes('@') ? m[2].trim() : null, manager: m[3].trim(), manager_email: m[4].includes('@') ? m[4].trim() : null };
      continue;
    }
    mapping[r.dealer] = { rmo: rmo?.name || null, rmo_email: rmo?.email || null, manager: rmo?.manager || null, manager_email: rmo?.manager_email || null, state, flag: r.flag };
  }
  return mapping;
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/, Cn$/, ', CN');
