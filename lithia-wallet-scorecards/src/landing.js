import { config } from './config.js';
import { pct, int, periodLabelLong, kpiStatus } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Small page the RMO opens from a text or email. Shows the current numbers and
 * the right "add" button for the phone in hand. Google button is enabled in Phase 3.
 */
export function landingPage({ rmo, period, settings, totals, stores }) {
  const status = kpiStatus(totals, settings);
  const appleHref = `${config.publicBaseUrl}/apple/add/${encodeURIComponent(rmo.slug)}.pkpass`;
  const googleHref = rmo.google_object_id ? `${config.publicBaseUrl}/google/add/${encodeURIComponent(rmo.slug)}` : null;

  const kpi = (label, value, note, s) => `
    <div class="kpi${s === 'watch' ? ' watch' : ''}">
      <dt>${esc(label)}</dt>
      <dd>${esc(value)}</dd>
      ${note ? `<small>${esc(note)}</small>` : ''}
    </div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<title>${esc(rmo.region_name)} scorecard · Alpha Drive AI</title>
<style>
  :root{--ink:#111;--mute:#6b6b6b;--rule:#e6e6e6;--warn:#b45309;--bg:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,"SF Pro Text",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:520px;margin:0 auto;padding:32px 20px 48px}
  .brand{font-weight:700;letter-spacing:-.01em;font-size:15px}
  h1{font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:28px 0 4px;font-weight:700}
  .sub{color:var(--mute);margin:0 0 28px}
  .hero{border-top:2px solid var(--ink);padding-top:16px;margin-bottom:8px}
  .hero dt{font-size:14px;color:var(--mute)}
  .hero dd{margin:2px 0 0;font-size:64px;line-height:1;font-weight:700;letter-spacing:-.03em}
  .hero small{display:block;color:var(--mute);margin-top:6px}
  dl.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin:20px 0 0}
  .kpi{border-top:1px solid var(--rule);padding:12px 0 14px}
  .kpi dt{font-size:13px;color:var(--mute)}
  .kpi dd{margin:2px 0 0;font-size:26px;font-weight:700;letter-spacing:-.02em}
  .kpi small{color:var(--mute);font-size:12px}
  .kpi.watch dd{color:var(--warn)}
  .actions{margin:36px 0 0;display:flex;flex-direction:column;gap:12px}
  .btn{display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border-radius:12px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:16px}
  .btn.soon{background:#f2f2f2;color:var(--mute);pointer-events:none}
  .hide{display:none}
  table{width:100%;border-collapse:collapse;margin-top:40px;font-size:14px}
  th{text-align:left;color:var(--mute);font-weight:500;padding:0 0 8px;border-bottom:1px solid var(--rule)}
  td{padding:10px 0;border-bottom:1px solid var(--rule);vertical-align:top}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
  .foot{color:var(--mute);font-size:13px;margin-top:32px}
</style></head>
<body><main>
  <div class="brand">Alpha Drive AI</div>
  <h1>${esc(rmo.region_name)}</h1>
  <p class="sub">${esc(rmo.name)} · ${esc(periodLabelLong(period))} · ${stores.length} stores</p>

  ${totals ? `
  <dl class="hero">
    <dt>Booking rate, all inbound calls</dt>
    <dd${status.booking === 'watch' ? ' style="color:var(--warn)"' : ''}>${esc(pct(totals.booking_rate))}</dd>
    <small>Target above ${esc(pct(settings.booking_rate_target, 0))}</small>
  </dl>
  <dl class="grid">
    ${kpi('Containment', pct(totals.containment_rate), 'Appointments on scheduling calls')}
    ${kpi('Transfer rate', pct(totals.transfer_rate), `Keep below ${pct(settings.transfer_rate_max, 0)}`, status.transfer)}
    ${kpi('Total calls', int(totals.calls_total))}
    ${kpi('Customers served', int(totals.customers_served))}
  </dl>` : `<p class="sub">No numbers posted for this period yet.</p>`}

  <div class="actions">
    <a id="apple" class="btn" href="${appleHref}">Add to Apple Wallet</a>
    ${googleHref
      ? `<a id="google" class="btn" href="${googleHref}">Add to Google Wallet</a>`
      : `<a id="google" class="btn soon" href="#">Google Wallet coming soon</a>`}
  </div>

  ${stores.length ? `
  <table>
    <thead><tr><th>Store</th><th class="n">Booking</th><th class="n">Contain.</th><th class="n">Transfer</th><th class="n">Calls</th></tr></thead>
    <tbody>
      ${stores.map((s) => `<tr>
        <td>${esc(s.store_name)}${s.dealer_code ? `<br><span style="color:var(--mute);font-size:12px">${esc(s.dealer_code)}</span>` : ''}</td>
        <td class="n">${esc(pct(s.booking_rate))}</td>
        <td class="n">${esc(pct(s.containment_rate, 0))}</td>
        <td class="n">${esc(pct(s.transfer_rate, 0))}</td>
        <td class="n">${esc(int(s.calls_total))}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}

  <p class="foot">Once added, the card updates itself whenever numbers change. Questions: Alpha Drive AI client support, 239-221-5236.</p>
</main>
<script>
  // Show the button for the phone in hand; desktop sees both.
  var ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua);
  if (ios) document.getElementById('google').classList.add('hide');
  if (android) document.getElementById('apple').classList.add('hide');
</script>
</body></html>`;
}
