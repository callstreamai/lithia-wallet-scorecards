import { supabase } from './db.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param parsed   output of parseReport()
 * @param opts     { weeks: 'latest' | 'all', filename, createdBy }
 * @returns        { batchId, weeks: [{start,end,rows}], unmatched: [dealer], createdStores: [name], rmoIds: [uuid] }
 */
export async function applyReport(parsed, opts = {}) {
  const weeksToApply = opts.weeks === 'all' ? parsed.weeks : parsed.weeks.slice(0, 1);
  if (!weeksToApply.length) throw new Error('No weekly sheets found in workbook');

  const [{ data: stores, error: e1 }, { data: rmos, error: e2 }] = await Promise.all([
    supabase.from('stores').select('id, rmo_id, name, aliases, status'),
    supabase.from('rmos').select('id, name, email'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const storeIndex = new Map();
  for (const s of stores) {
    storeIndex.set(norm(s.name), s);
    for (const a of s.aliases || []) storeIndex.set(norm(a), s);
  }
  const rmoIndex = new Map(rmos.map((r) => [norm(r.name), r]));

  const unmatched = new Set();
  const createdStores = [];
  const touchedRmos = new Set();
  let rowsImported = 0;

  async function resolveRmo(m) {
    if (!m?.rmo) return null;
    const hit = rmoIndex.get(norm(m.rmo));
    if (hit) return hit;
    // New RMO in the report: create it so the mapping is not lost
    const slug = norm(m.rmo).replace(/\s+/g, '-');
    const { data, error } = await supabase
      .from('rmos')
      .insert({ name: m.rmo, email: m.rmo_email, slug, region_name: m.state, manager_name: m.manager, manager_email: m.manager_email })
      .select('id, name, email').single();
    if (error) throw error;
    rmoIndex.set(norm(m.rmo), data);
    return data;
  }

  async function resolveStore(dealer) {
    const hit = storeIndex.get(norm(dealer));
    if (hit) return hit;
    const m = parsed.mapping?.[dealer];
    const rmo = await resolveRmo(m);
    const status = m?.flag?.toLowerCase().startsWith('cancel') ? 'canceled' : rmo ? 'active' : 'pending';
    const { data, error } = await supabase
      .from('stores')
      .insert({ name: dealer, rmo_id: rmo?.id || null, state: m?.state || null, status })
      .select('id, rmo_id, name, aliases, status').single();
    if (error) throw error;
    storeIndex.set(norm(dealer), data);
    createdStores.push(dealer);
    if (!rmo) unmatched.add(dealer);
    return data;
  }

  for (const week of weeksToApply) {
    const upserts = [];
    for (const r of week.rows) {
      const store = await resolveStore(r.dealer);
      if (store.rmo_id) touchedRmos.add(store.rmo_id);
      else unmatched.add(r.dealer);
      upserts.push({
        store_id: store.id, period_start: week.start, period_end: week.end,
        customers: r.customers, calls: r.calls, call_time_hours: r.call_time_hours,
        transfers: r.transfers, status_calls: r.status_calls, appointments: r.appointments, reschedules: r.reschedules,
        containment_rate: r.containment_rate, book_rate_prior: r.book_rate_prior,
        source: 'import', updated_by: opts.createdBy || 'import', updated_at: new Date().toISOString(),
      });
    }
    const { error } = await supabase.from('store_weeks').upsert(upserts, { onConflict: 'store_id,period_start' });
    if (error) throw error;
    rowsImported += upserts.length;
  }

  const { data: batch, error: e3 } = await supabase
    .from('import_batches')
    .insert({
      filename: opts.filename || null,
      period_start: weeksToApply[weeksToApply.length - 1].start,
      period_end: weeksToApply[0].end,
      rows_imported: rowsImported,
      unmatched: [...unmatched],
      created_by: opts.createdBy || null,
    })
    .select('id').single();
  if (e3) throw e3;

  return {
    batchId: batch.id,
    weeks: weeksToApply.map((w) => ({ start: w.start, end: w.end, rows: w.rows.length })),
    unmatched: [...unmatched],
    createdStores,
    rmoIds: [...touchedRmos],
  };
}
