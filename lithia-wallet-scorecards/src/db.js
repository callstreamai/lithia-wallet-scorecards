import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
  return data?.rmo_id ? getRmoById(data.rmo_id) : null;
}

export async function listActiveRmos() {
  const { data, error } = await supabase.from('rmos').select('*').eq('active', true).order('name');
  if (error) throw error;
  return data;
}

/**
 * Everything needed to render one RMO's scorecard on any surface:
 * latest week, prior week, month-to-date, per-store rows for both, and KPI targets.
 */
export async function getScorecard(rmo, periodStart) {
  const settings = await getSettings();

  // All weeks this RMO has data for (newest first), for the week switcher
  const { data: allWeeks } = await supabase.from('v_rmo_weeks').select('period_start, period_end').eq('rmo_id', rmo.id).order('period_start', { ascending: false });

  let weeksQ = supabase.from('v_rmo_weeks').select('*').eq('rmo_id', rmo.id).order('period_start', { ascending: false }).limit(2);
  if (periodStart) weeksQ = weeksQ.lte('period_start', periodStart);
  const { data: weeks, error: eW } = await weeksQ;
  if (eW) throw eW;
  const week = weeks?.[0] || null;
  const prevWeek = weeks?.[1] || null;
  if (!week) return { rmo, settings, week: null, prevWeek: null, month: null, stores: [], storeMonths: [], allWeeks: allWeeks || [] };

  const monthKey = week.period_start.slice(0, 7) + '-01';
  const [monthRes, storesRes, storeMonthsRes] = await Promise.all([
    supabase.from('v_rmo_months').select('*').eq('rmo_id', rmo.id).eq('month', monthKey).maybeSingle(),
    supabase.from('v_store_weeks').select('*').eq('rmo_id', rmo.id).eq('period_start', week.period_start).order('calls', { ascending: false }),
    supabase.from('v_store_months').select('*').eq('rmo_id', rmo.id).eq('month', monthKey),
  ]);
  for (const r of [monthRes, storesRes, storeMonthsRes]) if (r.error) throw r.error;

  return {
    rmo, settings, week, prevWeek,
    month: monthRes.data,
    stores: storesRes.data || [],
    storeMonths: storeMonthsRes.data || [],
    allWeeks: allWeeks || [],
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
