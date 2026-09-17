// Builds a .pkpass from fixture data so the layout can be checked without a database.
// Usage: APPLE_PASS_P12_PATH=... APPLE_PASS_P12_PASSWORD=... node scripts/preview-pass.js out.pkpass
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'preview';
process.env.APPLE_TEAM_ID ??= 'A63L38TNCC';
process.env.APPLE_PASS_TYPE_ID ??= 'pass.com.alphadriveai.lithia.scorecard';
process.env.PUBLIC_BASE_URL ??= 'https://lithia-wallet-scorecards.onrender.com';
const { buildPass } = await import('../src/apple/pass.js');
const { writeFile } = await import('node:fs/promises');

const fixture = {
  rmo: { id: '1', name: 'Demo RMO', region_name: 'Demo Region', slug: 'demo',
    serial_number: 'd7c8caea03ea4480a14063604d269610', auth_token: 'preview-token-0123456789abcdef', pass_updated_at: new Date().toISOString() },
  period: '2026-09-01',
  settings: { organization_name: 'Alpha Drive AI', booking_rate_target: 0.14, transfer_rate_max: 0.20 },
  totals: { store_count: 3, calls_total: 2980, customers_served: 2656, booking_rate: 0.1534, containment_rate: 0.6452, transfer_rate: 0.1799, updated_at: new Date().toISOString() },
  stores: [
    { store_name: 'Lithia Toyota of Demo City', dealer_code: 'LTD01', booking_rate: 0.170, containment_rate: 0.659, transfer_rate: 0.15, calls_total: 1240, customers_served: 1102 },
    { store_name: 'Lithia Honda of Demo City', dealer_code: 'LHD02', booking_rate: 0.131, containment_rate: 0.615, transfer_rate: 0.226, calls_total: 980, customers_served: 870 },
    { store_name: 'Lithia Ford of Demo City', dealer_code: 'LFD03', booking_rate: 0.155, containment_rate: 0.661, transfer_rate: 0.17, calls_total: 760, customers_served: 684 },
  ],
};
const out = process.argv[2] || 'preview.pkpass';
await writeFile(out, await buildPass(fixture));
console.log('wrote', out);
