import { config } from './config.js';
import { pct, int, weekLabelLong, monthLabel, rateOf, kpiStatus, delta } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The page an RMO opens from a text or email. Shows this week's numbers, month to date,
 * store table, and the right "add" button for the phone in hand. Also the template the PDF prints from.
 */
export function landingPage({ rmo, settings, week, prevWeek, month, stores, storeMonths }, { print = false } = {}) {
  const status = kpiStatus(week, settings);
  const appleHref = `${config.publicBaseUrl}/apple/add/${encodeURIComponent(rmo.slug)}.pkpass`;
  const googleHref = rmo.google_object_id ? `${config.publicBaseUrl}/google/add/${encodeURIComponent(rmo.slug)}` : null;
  const book = rateOf(week, 'book_rate', settings);
  const wow = delta(book, rateOf(prevWeek, 'book_rate', settings));
  const mtd = new Map(storeMonths.map((m) => [m.store_id, m]));

  const kpi = (label, value, note, s) => `
    <div class="kpi${s === 'watch' ? ' watch' : ''}">
      <dt>${esc(label)}</dt><dd>${esc(value)}</dd>${note ? `<small>${esc(note)}</small>` : ''}
    </div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<title>${esc(rmo.name)} scorecard · Alpha Drive AI</title>
<style>
  :root{--ink:#111;--mute:#6b6b6b;--rule:#e6e6e6;--warn:#b45309;--bg:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,"SF Pro Text",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:${print ? '760px' : '560px'};margin:0 auto;padding:32px 20px 48px}
  .brand{display:flex;justify-content:space-between;align-items:baseline;font-weight:700;letter-spacing:-.01em;font-size:15px}
  .brand span{font-weight:500;color:var(--mute)}
  h1{font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:28px 0 4px;font-weight:700}
  .sub{color:var(--mute);margin:0 0 24px}
  .hero{border-top:2px solid var(--ink);padding-top:16px;margin:0}
  .hero dt{font-size:14px;color:var(--mute)}
  .hero dd{margin:2px 0 0;font-size:64px;line-height:1;font-weight:700;letter-spacing:-.03em}
  .hero small{display:block;color:var(--mute);margin-top:6px}
  dl.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin:16px 0 0}
  .kpi{border-top:1px solid var(--rule);padding:12px 0 14px}
  .kpi dt{font-size:13px;color:var(--mute)}
  .kpi dd{margin:2px 0 0;font-size:26px;font-weight:700;letter-spacing:-.02em}
  .kpi small{color:var(--mute);font-size:12px}
  .kpi.watch dd,.warn{color:var(--warn)}
  .mtd{margin:28px 0 0;padding:14px 16px;background:#f6f6f6;border-radius:12px;font-size:14px}
  .mtd b{display:block;margin-bottom:4px}
  .actions{margin:32px 0 0;display:flex;flex-direction:column;gap:12px}
  .btn{display:flex;align-items:center;justify-content:center;height:52px;border-radius:12px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:16px}
  .btn.soon{background:#f2f2f2;color:var(--mute);pointer-events:none}
  .hide{display:none}
  table{width:100%;border-collapse:collapse;margin-top:36px;font-size:14px}
  th{text-align:left;color:var(--mute);font-weight:500;padding:0 0 8px;border-bottom:1px solid var(--rule)}
  td{padding:10px 0;border-bottom:1px solid var(--rule);vertical-align:top}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .muted{color:var(--mute);font-size:12px}
  .foot{color:var(--mute);font-size:13px;margin-top:32px}
  @media print{.actions,.foot .noprint{display:none}main{padding:0}body{font-size:14px}}
</style></head>
<body><main>
  <div class="brand">Alpha Drive AI <span>Lithia RMO Scorecard</span></div>
  <h1>${esc(rmo.name)}</h1>
  <p class="sub">${esc(rmo.region_name || '')}${week ? ` · ${esc(weekLabelLong(week.period_start, week.period_end))}` : ''} · ${stores.length} store${stores.length === 1 ? '' : 's'}</p>

  ${week ? `
  <dl class="hero">
    <dt>Book rate, appointments on all calls</dt>
    <dd${status.book === 'watch' ? ' class="warn"' : ''}>${esc(pct(book))}</dd>
    <small>Target above ${esc(pct(settings.booking_rate_target, 0))}${wow ? ` · ${esc(wow)} vs prior week` : ''}</small>
  </dl>
  <dl class="grid">
    ${kpi('Containment', pct(rateOf(week, 'containment_rate', settings)), 'Resolved by AI without transfer')}
    ${kpi('Transfer rate', pct(rateOf(week, 'transfer_rate', settings)), `Keep below ${pct(settings.transfer_rate_max, 0)}`, status.transfer)}
    ${kpi('Total calls', int(week.calls))}
    ${kpi('Customers served', int(week.customers))}
  </dl>
  ${month ? `<div class="mtd"><b>${esc(monthLabel(month.month))} month to date · ${month.weeks} week${month.weeks === 1 ? '' : 's'}</b>
    Book ${esc(pct(rateOf(month, 'book_rate', settings)))} · Containment ${esc(pct(rateOf(month, 'containment_rate', settings), 0))} · Transfer ${esc(pct(rateOf(month, 'transfer_rate', settings), 0))} · ${esc(int(month.calls))} calls · ${esc(int(month.customers))} customers · ${esc(int(month.appointments))} appointments</div>` : ''}
  ` : `<p class="sub">No weekly report posted yet.</p>`}

  <div class="actions">
    <a id="apple" class="btn" href="${appleHref}">Add to Apple Wallet</a>
    ${googleHref ? `<a id="google" class="btn" href="${googleHref}">Add to Google Wallet</a>` : `<a id="google" class="btn soon" href="#">Google Wallet coming soon</a>`}
  </div>

  ${stores.length ? `
  <table>
    <thead><tr><th>Store</th><th class="n">Book</th><th class="n">Contain.</th><th class="n">Transfer</th><th class="n">Calls</th><th class="n">MTD book</th></tr></thead>
    <tbody>
      ${stores.map((s) => { const m = mtd.get(s.store_id); return `<tr>
        <td>${esc(s.store_name)}<br><span class="muted">${esc(s.state || '')}${s.status === 'canceled' ? ' · Canceled' : ''}</span></td>
        <td class="n${s.book_rate != null && Number(s.book_rate) < Number(settings.booking_rate_target) ? ' warn' : ''}">${esc(pct(s.book_rate))}</td>
        <td class="n">${esc(pct(s.containment_rate, 0))}</td>
        <td class="n">${esc(pct(s.transfer_rate, 0))}</td>
        <td class="n">${esc(int(s.calls))}</td>
        <td class="n">${m ? esc(pct(m.book_rate)) : '—'}</td>
      </tr>`; }).join('')}
    </tbody>
  </table>` : ''}

  <p class="foot"><span class="noprint">Once added, the card updates itself when the weekly report is posted. </span>Book rate = appointments ÷ total calls. Containment = calls resolved by AI without a transfer. Alpha Drive AI client support 239-221-5236.</p>
</main>
${print ? '' : `<script>
  var ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua);
  if (ios) document.getElementById('google').classList.add('hide');
  if (android) document.getElementById('apple').classList.add('hide');
</script>`}
</body></html>`;
}
