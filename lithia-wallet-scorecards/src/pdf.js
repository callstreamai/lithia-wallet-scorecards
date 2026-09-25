import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from './config.js';
import { pct, int, weekLabelLong, monthLabel, rateOf, kpiStatus, delta } from './format.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const RED = '#E30613', INK = '#0A0A0C', MUTE = '#6B6B70', LINE = '#E6E6E4', SMOKE = '#F2F2F0';

/**
 * Print-friendly one-pager: white paper, Ink text, one red accent, brand wordmark.
 * @param scorecard  db.getScorecard() result
 * @param opts       { walletLink?: string }  when present, a QR code to add the card is printed
 * @returns Promise<Buffer>
 */
export function buildPdf(scorecard, opts = {}) {
  const { rmo, settings, week, prevWeek, month, stores, storeMonths } = scorecard;
  const status = kpiStatus(week, settings);
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 48, left: 48, right: 48, bottom: 48 }, info: { Title: `${rmo.name} · Lithia RMO Scorecard`, Author: settings.organization_name } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 96; // content width
  const L = 48;

  // ---- Header
  doc.image(path.join(ASSETS, 'wordmark@2x.png'), L, 44, { height: 14 });
  doc.font('Courier-Bold').fontSize(7).fillColor(MUTE).text('LITHIA RMO SCORECARD', L, 47, { width: W, align: 'right', characterSpacing: 1.6 });
  doc.moveTo(L, 72).lineTo(L + W, 72).lineWidth(0.5).strokeColor(LINE).stroke();

  doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(rmo.name, L, 90);
  doc.font('Helvetica').fontSize(10).fillColor(MUTE)
    .text(`${rmo.region_name || ''}${week ? `  ·  ${weekLabelLong(week.period_start, week.period_end)}` : ''}  ·  ${stores.length} store${stores.length === 1 ? '' : 's'}`, L, 122);

  let y = 150;
  if (!week) {
    doc.font('Helvetica').fontSize(12).fillColor(MUTE).text('No weekly report posted yet.', L, y);
    doc.end(); return done;
  }

  // ---- Hero KPI
  const book = rateOf(week, 'book_rate', settings);
  const wow = delta(book, rateOf(prevWeek, 'book_rate', settings));
  doc.rect(L, y, W, 96).fillColor(SMOKE).fill();
  doc.rect(L, y, 4, 96).fillColor(RED).fill();
  doc.font('Courier-Bold').fontSize(7).fillColor(MUTE).text('BOOK RATE · APPOINTMENTS ÷ CUSTOMERS SERVED', L + 20, y + 16, { characterSpacing: 1.4 });
  doc.font('Helvetica-Bold').fontSize(44).fillColor(status.book === 'watch' ? RED : INK).text(pct(book), L + 20, y + 30);
  doc.font('Helvetica').fontSize(9).fillColor(MUTE).text(`Target above ${pct(settings.booking_rate_target, 0)}${wow ? `   ·   ${wow} vs prior week` : ''}`, L + 20, y + 78);
  // right side: status word
  doc.font('Helvetica-Bold').fontSize(10).fillColor(status.book === 'watch' ? RED : '#1E9E5A')
    .text(status.book === 'watch' ? 'BELOW TARGET' : 'ON TARGET', L, y + 40, { width: W - 20, align: 'right' });
  y += 112;

  // ---- Four tiles
  const tiles = [
    ['CONTAINMENT', pct(rateOf(week, 'containment_rate', settings)), 'Resolved by AI, no transfer', false],
    [`TRANSFER RATE`, pct(rateOf(week, 'transfer_rate', settings)), `Keep below ${pct(settings.transfer_rate_max, 0)}`, status.transfer === 'watch'],
    ['TOTAL CALLS', int(week.calls), 'This week', false],
    ['CUSTOMERS SERVED', int(week.customers), 'This week', false],
  ];
  const tw = (W - 3 * 12) / 4;
  tiles.forEach(([label, value, note, warn], i) => {
    const x = L + i * (tw + 12);
    doc.rect(x, y, tw, 74).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Courier-Bold').fontSize(6.5).fillColor(MUTE).text(label, x + 12, y + 12, { characterSpacing: 1.2 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(warn ? RED : INK).text(value, x + 12, y + 28);
    doc.font('Helvetica').fontSize(8).fillColor(MUTE).text(note, x + 12, y + 56);
  });
  y += 90;

  // ---- MTD strip
  if (month) {
    doc.rect(L, y, W, 40).fillColor(SMOKE).fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`${monthLabel(month.month)} month to date · ${month.weeks} week${month.weeks === 1 ? '' : 's'}`, L + 14, y + 9);
    doc.font('Helvetica').fontSize(9).fillColor(MUTE).text(
      `Book ${pct(rateOf(month, 'book_rate', settings))}   ·   Containment ${pct(rateOf(month, 'containment_rate', settings), 0)}   ·   Transfer ${pct(rateOf(month, 'transfer_rate', settings), 0)}   ·   ${int(month.calls)} calls   ·   ${int(month.customers)} customers   ·   ${int(month.appointments)} appointments`,
      L + 14, y + 23);
    y += 56;
  }

  // ---- Store table
  const cols = [
    { k: 'store', w: W - 5 * 62, label: 'STORE', align: 'left' },
    { k: 'book', w: 62, label: 'BOOK', align: 'right' },
    { k: 'contain', w: 62, label: 'CONTAIN', align: 'right' },
    { k: 'transfer', w: 62, label: 'TRANSFER', align: 'right' },
    { k: 'calls', w: 62, label: 'CALLS', align: 'right' },
    { k: 'mtd', w: 62, label: 'MTD BOOK', align: 'right' },
  ];
  const mtdBy = new Map(storeMonths.map((m) => [m.store_id, m]));
  const header = () => {
    let x = L;
    doc.font('Courier-Bold').fontSize(6.5).fillColor(MUTE);
    for (const c of cols) { doc.text(c.label, x, y, { width: c.w, align: c.align, characterSpacing: 1.2 }); x += c.w; }
    y += 14; doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke(); y += 8;
  };
  header();
  for (const s of stores) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 48; header(); }
    const m = mtdBy.get(s.store_id);
    const low = s.book_rate != null && Number(s.book_rate) < Number(settings.booking_rate_target);
    const vals = { book: pct(s.book_rate), contain: pct(s.containment_rate, 0), transfer: pct(s.transfer_rate, 0), calls: int(s.calls), mtd: m ? pct(m.book_rate) : '—' };
    let x = L;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(s.store_name, x, y, { width: cols[0].w - 8, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTE).text(`${s.state || ''}${s.status === 'canceled' ? '  ·  Canceled' : ''}`, x, y + 12);
    x += cols[0].w;
    for (const c of cols.slice(1)) {
      doc.font('Helvetica').fontSize(9.5).fillColor(c.k === 'book' && low ? RED : INK).text(vals[c.k], x, y + 3, { width: c.w, align: 'right' });
      x += c.w;
    }
    y += 26; doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke(); y += 6;
  }

  // ---- Footer: definitions, generated stamp, optional QR
  const fy = doc.page.height - 92;
  doc.moveTo(L, fy).lineTo(L + W, fy).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTE).text(
    `Book rate = appointments ÷ customers served. Containment = calls resolved by AI without a transfer. Rates roll up as ${settings.rate_aggregation === 'weighted' ? 'call-weighted averages' : 'simple averages of store rates'}.\n` +
    `Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} ET  ·  ${settings.organization_name} client support 239-221-5236  ·  alphadriveai.com`,
    L, fy + 10, { width: W - (opts.walletLink ? 80 : 0), lineGap: 2 });

  const finish = async () => {
    if (opts.walletLink) {
      const png = await QRCode.toBuffer(opts.walletLink, { margin: 0, width: 160, color: { dark: INK, light: '#FFFFFF' } });
      doc.image(png, L + W - 56, fy + 8, { width: 56 });
      doc.font('Courier-Bold').fontSize(5.5).fillColor(MUTE).text('ADD TO WALLET', L + W - 60, fy + 68, { width: 64, align: 'center', characterSpacing: 1 });
    }
    doc.end();
  };
  return finish().then(() => done);
}
