import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Template } from '@walletpass/pass-js';
import { config } from '../config.js';
import { loadSigningMaterial } from './certs.js';
import {
  pct, int, weekLabel, monthLabel, shortDate, rateOf, kpiStatus, withGlyph, delta, storeLine,
} from '../format.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');

// Alpha Drive AI palette: dark card, white values, muted labels
// Alpha Drive AI brand: Ink Black surface, Paper text, Smoke labels (brand.alphadriveai.com)
const COLORS = {
  background: 'rgb(10, 10, 12)',
  foreground: 'rgb(255, 255, 255)',
  label: 'rgb(158, 158, 162)',
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
  const { rmo, settings, week, prevWeek, month, stores, storeMonths } = scorecard;
  const template = await getTemplate(settings.organization_name);
  const status = kpiStatus(week, settings);

  const pass = template.createPass({
    serialNumber: rmo.serial_number,
    description: `Lithia RMO Scorecard · ${rmo.name}`,
    webServiceURL: `${config.publicBaseUrl}/apple`,
    authenticationToken: rmo.auth_token,
  });

  const book = rateOf(week, 'book_rate', settings);
  const contain = rateOf(week, 'containment_rate', settings);
  const transfer = rateOf(week, 'transfer_rate', settings);
  const prevBook = rateOf(prevWeek, 'book_rate', settings);
  const mtdBook = rateOf(month, 'book_rate', settings);

  // Header (top right, next to logo): the reporting week
  pass.headerFields.add({ key: 'week', label: 'WEEK', value: week ? weekLabel(week.period_start, week.period_end) : '—' });

  // Primary: the number Alpha Drive is measured on
  const wow = delta(book, prevBook);
  pass.primaryFields.add({
    key: 'book',
    label: `BOOK RATE · TARGET ${pct(settings.booking_rate_target, 0)}${wow ? ` · ${wow} WoW` : ''}`,
    value: week ? withGlyph(pct(book), status.book) : 'No data yet',
    ...(config.notifyOnChange ? { changeMessage: 'Book rate is now %@' } : {}),
  });

  // Secondary: three KPIs so values never truncate
  pass.secondaryFields.add({ key: 'contain', label: 'CONTAINMENT', value: week ? pct(contain) : '—' });
  pass.secondaryFields.add({
    key: 'transfer',
    label: `TRANSFER · MAX ${pct(settings.transfer_rate_max, 0)}`,
    value: week ? withGlyph(pct(transfer), status.transfer) : '—',
  });
  pass.secondaryFields.add({ key: 'calls', label: 'CALLS', value: week ? int(week.calls) : '—' });

  // Auxiliary: who, customers, MTD, when
  pass.auxiliaryFields.add({ key: 'rmo', label: 'RMO', value: rmo.name });
  pass.auxiliaryFields.add({ key: 'customers', label: 'CUSTOMERS', value: week ? int(week.customers) : '—' });
  pass.auxiliaryFields.add({ key: 'mtd', label: 'MTD BOOK', value: month ? pct(mtdBook) : '—' });
  pass.auxiliaryFields.add({ key: 'updated', label: 'UPDATED', value: shortDate(week?.updated_at || rmo.pass_updated_at) });

  // Back: month-to-date, then store by store
  if (month) {
    pass.backFields.add({
      key: 'mtd_detail',
      label: `${monthLabel(month.month).toUpperCase()} MONTH TO DATE · ${month.weeks} WK`,
      value: [
        `Book ${pct(mtdBook)}`,
        `Contain ${pct(rateOf(month, 'containment_rate', settings), 0)}`,
        `Transfer ${pct(rateOf(month, 'transfer_rate', settings), 0)}`,
        `${int(month.calls)} calls`,
        `${int(month.customers)} customers`,
        `${int(month.appointments)} appointments`,
      ].join(' · '),
    });
  }

  pass.backFields.add({ key: 'stores_hdr', label: 'STORES', value: `${stores.length} store${stores.length === 1 ? '' : 's'} · ${rmo.region_name || ''}`.trim() });

  const mtdByStore = new Map(storeMonths.map((m) => [m.store_id, m]));
  stores.forEach((s, i) => {
    const m = mtdByStore.get(s.store_id);
    const flag = s.status === 'canceled' ? ' · CANCELED' : '';
    pass.backFields.add({
      key: `store_${i}`,
      label: `${s.store_name.toUpperCase()}${s.state ? ` · ${s.state.toUpperCase()}` : ''}${flag}`,
      value: `This week: ${storeLine(s)}` + (m ? `\nMTD: Book ${pct(m.book_rate)} · ${int(m.calls)} calls · ${int(m.appointments)} appts` : ''),
    });
  });
  if (!stores.length) pass.backFields.add({ key: 'nostores', label: 'STORES', value: 'No store data yet.' });

  pass.backFields.add({ key: 'about', label: 'ABOUT THIS CARD', value:
    `Weekly performance of your stores handled by Alpha Drive AI. Book rate = appointments ÷ customers served. ` +
    `Containment = calls resolved by AI without a transfer. ✓ on target · ▲ needs attention. ` +
    `Updates automatically when the weekly report is posted.` });
  pass.backFields.add({ key: 'targets', label: 'TARGETS', value:
    `Book rate above ${pct(settings.booking_rate_target, 0)} · Transfer rate below ${pct(settings.transfer_rate_max, 0)}` });
  pass.backFields.add({ key: 'support', label: 'ALPHA DRIVE AI CLIENT SUPPORT', value: '239-221-5236 · alphadriveai.com' });

  return pass.asBuffer();
}
