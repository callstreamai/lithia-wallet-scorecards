import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Template } from '@walletpass/pass-js';
import { config } from '../config.js';
import { loadSigningMaterial } from './certs.js';
import { pct, int, periodLabel, updatedLabel, kpiStatus, withGlyph, storeLine } from '../format.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');

// Alpha Drive AI palette: dark card, white values, muted labels
const COLORS = {
  background: 'rgb(17, 17, 17)',
  foreground: 'rgb(255, 255, 255)',
  label: 'rgb(163, 163, 163)',
};

let templatePromise;

async function getTemplate(organizationName) {
  if (!templatePromise) {
    templatePromise = (async () => {
      const t = new Template('generic', {
        passTypeIdentifier: config.apple.passTypeId,
        teamIdentifier: config.apple.teamId,
        organizationName,
        description: 'Lithia RMO Scorecard',
        logoText: 'Alpha Drive AI',
        backgroundColor: COLORS.background,
        foregroundColor: COLORS.foreground,
        labelColor: COLORS.label,
        sharingProhibited: true,
      });
      await t.images.load(ASSETS);
      const { certPem, keyPem, keyPassword } = await loadSigningMaterial();
      t.setCertificate(certPem);
      t.setPrivateKey(keyPem, keyPassword);
      return t;
    })();
  }
  return templatePromise;
}

/**
 * @param scorecard  result of db.getScorecard()
 * @returns Buffer   signed .pkpass
 */
export async function buildPass(scorecard) {
  const { rmo, period, settings, totals, stores } = scorecard;
  const template = await getTemplate(settings.organization_name);
  const status = kpiStatus(totals, settings);

  const pass = template.createPass({
    serialNumber: rmo.serial_number,
    description: `Lithia RMO Scorecard · ${rmo.region_name}`,
    webServiceURL: `${config.publicBaseUrl}/apple`,
    authenticationToken: rmo.auth_token,
  });

  // Header (top right, next to logo)
  pass.headerFields.add({ key: 'period', label: 'PERIOD', value: periodLabel(period) });

  // Primary: the one number Alpha Drive is measured on
  pass.primaryFields.add({
    key: 'booking',
    label: `BOOKING RATE · TARGET ${pct(settings.booking_rate_target, 0)}`,
    value: totals ? withGlyph(pct(totals.booking_rate), status.booking) : 'No data yet',
    ...(config.notifyOnChange ? { changeMessage: 'Booking rate is now %@' } : {}),
  });

  // Secondary: the other four KPIs
  pass.secondaryFields.add({ key: 'containment', label: 'CONTAINMENT', value: totals ? pct(totals.containment_rate) : '—' });
  pass.secondaryFields.add({
    key: 'transfer',
    label: `TRANSFER · MAX ${pct(settings.transfer_rate_max, 0)}`,
    value: totals ? withGlyph(pct(totals.transfer_rate), status.transfer) : '—',
  });
  pass.secondaryFields.add({ key: 'calls', label: 'TOTAL CALLS', value: totals ? int(totals.calls_total) : '—' });
  pass.secondaryFields.add({ key: 'customers', label: 'CUSTOMERS SERVED', value: totals ? int(totals.customers_served) : '—' });

  // Auxiliary: who and when
  pass.auxiliaryFields.add({ key: 'rmo', label: 'RMO', value: rmo.name });
  pass.auxiliaryFields.add({ key: 'region', label: 'REGION', value: rmo.region_name });
  pass.auxiliaryFields.add({ key: 'stores', label: 'STORES', value: String(totals?.store_count ?? stores.length) });
  pass.auxiliaryFields.add({ key: 'updated', label: 'UPDATED', value: updatedLabel(totals?.updated_at || rmo.pass_updated_at) });

  // Back: store-by-store breakdown
  pass.backFields.add({ key: 'about', label: 'ABOUT THIS CARD', value:
    `Live performance for ${rmo.region_name} stores handled by Alpha Drive AI. ` +
    `Booking rate counts appointments on all inbound calls. Containment counts appointments on scheduling calls only. ` +
    `✓ on target · ▲ needs attention. Updates automatically.` });

  stores.forEach((s, i) => {
    pass.backFields.add({
      key: `store_${i}`,
      label: s.dealer_code ? `${s.store_name.toUpperCase()} · ${s.dealer_code}` : s.store_name.toUpperCase(),
      value: storeLine(s),
    });
  });
  if (!stores.length) pass.backFields.add({ key: 'nostores', label: 'STORES', value: 'No store data for this period yet.' });

  pass.backFields.add({ key: 'targets', label: 'TARGETS', value:
    `Booking rate above ${pct(settings.booking_rate_target, 0)} · Transfer rate below ${pct(settings.transfer_rate_max, 0)}` });
  pass.backFields.add({ key: 'support', label: 'ALPHA DRIVE AI CLIENT SUPPORT', value: '239-221-5236 · alphadriveai.com' });

  return pass.asBuffer();
}
