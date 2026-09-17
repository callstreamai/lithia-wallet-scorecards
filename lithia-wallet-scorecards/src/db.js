import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function firstOfCurrentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Latest period that has data for this RMO, falling back to the current month. */
async function latestPeriodForRmo(rmoId) {
  const { data } = await supabase
    .from('v_rmo_scorecards')
    .select('period')
    .eq('rmo_id', rmoId)
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.period || firstOfCurrentMonth();
}

export async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}

export async function getRmoBySlug(slug) {
  const { data, error } = await supabase.from('rmos').select('*').eq('slug', slug).eq('active', true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRmoBySerial(serialNumber) {
  const { data, error } = await supabase.from('rmos').select('*').eq('serial_number', serialNumber).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRmoById(id) {
  const { data, error } = await supabase.from('rmos').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRmoForStore(storeId) {
  const { data, error } = await supabase.from('stores').select('rmo_id').eq('id', storeId).maybeSingle();
  if (error) throw error;
  return data ? getRmoById(data.rmo_id) : null;
}

/**
 * Everything needed to render one RMO's scorecard (any platform):
 * region rollup + per-store rows + KPI targets.
 */
export async function getScorecard(rmo, period) {
  const p = period || (await latestPeriodForRmo(rmo.id));
  const [settings, rollupRes, storesRes] = await Promise.all([
    getSettings(),
    supabase.from('v_rmo_scorecards').select('*').eq('rmo_id', rmo.id).eq('period', p).maybeSingle(),
    supabase.from('v_store_scorecards').select('*').eq('rmo_id', rmo.id).eq('period', p).order('sort_order'),
  ]);
  if (rollupRes.error) throw rollupRes.error;
  if (storesRes.error) throw storesRes.error;
  return {
    rmo,
    period: p,
    settings,
    totals: rollupRes.data, // null when no data yet for the period
    stores: storesRes.data || [],
  };
}

// ---- Apple PassKit web service persistence ----

export async function registerDevice({ deviceLibraryId, pushToken, serialNumber, passTypeId }) {
  const { error: e1 } = await supabase
    .from('apple_devices')
    .upsert({ device_library_id: deviceLibraryId, push_token: pushToken, updated_at: new Date().toISOString() });
  if (e1) throw e1;
  const { data: existing } = await supabase
    .from('apple_registrations')
    .select('device_library_id')
    .eq('device_library_id', deviceLibraryId)
    .eq('serial_number', serialNumber)
    .maybeSingle();
  if (existing) return false; // already registered
  const { error: e2 } = await supabase
    .from('apple_registrations')
    .insert({ device_library_id: deviceLibraryId, serial_number: serialNumber, pass_type_id: passTypeId });
  if (e2) throw e2;
  return true;
}

export async function unregisterDevice({ deviceLibraryId, serialNumber }) {
  const { error } = await supabase
    .from('apple_registrations')
    .delete()
    .eq('device_library_id', deviceLibraryId)
    .eq('serial_number', serialNumber);
  if (error) throw error;
  // Drop the device row when it has no registrations left
  const { count } = await supabase
    .from('apple_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('device_library_id', deviceLibraryId);
  if (count === 0) await supabase.from('apple_devices').delete().eq('device_library_id', deviceLibraryId);
}

export async function deleteDevice(deviceLibraryId) {
  await supabase.from('apple_devices').delete().eq('device_library_id', deviceLibraryId);
}

/** Serial numbers registered to a device that changed after `since` (ISO string or undefined). */
export async function serialsUpdatedForDevice(deviceLibraryId, since) {
  const { data, error } = await supabase
    .from('apple_registrations')
    .select('serial_number, rmos!inner(pass_updated_at)')
    .eq('device_library_id', deviceLibraryId);
  if (error) throw error;
  const rows = (data || []).map((r) => ({ serial: r.serial_number, updated: new Date(r.rmos.pass_updated_at) }));
  const filtered = since ? rows.filter((r) => r.updated > new Date(since)) : rows;
  const lastUpdated = rows.reduce((m, r) => (r.updated > m ? r.updated : m), new Date(0));
  return { serials: filtered.map((r) => r.serial), lastUpdated };
}

export async function pushTokensForSerial(serialNumber) {
  const { data, error } = await supabase
    .from('apple_registrations')
    .select('device_library_id, apple_devices!inner(push_token)')
    .eq('serial_number', serialNumber);
  if (error) throw error;
  return (data || []).map((r) => ({ deviceLibraryId: r.device_library_id, pushToken: r.apple_devices.push_token }));
}

export async function logEvent(rmoId, platform, event, detail) {
  await supabase.from('pass_events').insert({ rmo_id: rmoId, platform, event, detail });
}
