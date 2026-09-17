// Builds a .pkpass from fixture data so the layout can be checked without a database.
// Usage: APPLE_PASS_P12_PATH=... APPLE_PASS_P12_PASSWORD=... node scripts/preview-pass.js out.pkpass
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'preview';
process.env.APPLE_TEAM_ID ??= 'A63L38TNCC';
process.env.APPLE_PASS_TYPE_ID ??= 'pass.com.alphadriveai.lithia.scorecard';
process.env.PUBLIC_BASE_URL ??= 'https://lithia-wallet-scorecards.onrender.com';
const { buildPass } = await import('../src/apple/pass.js');
const { landingPage } = await import('../src/landing.js');
const { writeFile } = await import('node:fs/promises');

const now = new Date().toISOString();
const fixture = {
  rmo: { id: '1', name: 'Shaun Gallegos', region_name: 'California', slug: 'shaun-gallegos',
    serial_number: 'd7c8caea03ea4480a14063604d269610', auth_token: 'preview-token-0123456789abcdef', pass_updated_at: now, google_object_id: null },
  settings: { organization_name: 'Alpha Drive AI', booking_rate_target: 0.14, transfer_rate_max: 0.20, rate_aggregation: 'simple' },
  week: { period_start: '2026-09-10', period_end: '2026-09-16', store_count: 4, calls: 726, customers: 539, appointments: 245,
    book_rate_simple: 0.3256, book_rate_weighted: 0.3375, containment_rate_simple: 0.65125, transfer_rate_simple: 0.142, transfer_rate_weighted: 0.1419, updated_at: now },
  prevWeek: { period_start: '2026-09-03', period_end: '2026-09-09', book_rate_simple: 0.3075 },
  month: { month: '2026-09-01', weeks: 2, calls: 1434, customers: 1055, appointments: 470, book_rate_simple: 0.3167, containment_rate_simple: 0.6329, transfer_rate_simple: 0.16 },
  stores: [
    { store_id: 'a', store_name: 'Lithia Nissan of Clovis', state: 'California', status: 'active', book_rate: 0.4453, containment_rate: 0.716, transfer_rate: 0.062, calls: 274, customers: 226 },
    { store_id: 'b', store_name: 'Keyes Lexus of Valencia', state: 'California', status: 'canceled', book_rate: 0.3457, containment_rate: 0.644, transfer_rate: 0.148, calls: 162, customers: 123 },
    { store_id: 'c', store_name: 'Huntington Beach Hyundai', state: 'California', status: 'active', book_rate: 0.3196, containment_rate: 0.596, transfer_rate: 0.072, calls: 97, customers: 84 },
    { store_id: 'd', store_name: 'Acura Sherman Oaks', state: 'California', status: 'active', book_rate: 0.1917, containment_rate: 0.649, transfer_rate: 0.285, calls: 193, customers: 106 },
  ],
  storeMonths: [
    { store_id: 'a', book_rate: 0.4426, calls: 540, appointments: 239 },
    { store_id: 'b', book_rate: 0.3333, calls: 303, appointments: 101 },
    { store_id: 'c', book_rate: 0.3116, calls: 215, appointments: 67 },
    { store_id: 'd', book_rate: 0.1702, calls: 376, appointments: 64 },
  ],
};
const out = process.argv[2] || 'preview.pkpass';
await writeFile(out, await buildPass(fixture));
await writeFile(out.replace(/\.pkpass$/, '.html'), landingPage(fixture));
console.log('wrote', out, 'and matching .html');
