import { config } from './config.js';
import { pct, int, weekLabelLong, monthLabel, rateOf, kpiStatus, delta } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Alpha Drive AI web look: Ink Black canvas, Inter body, Space Grotesk display, one red, mono uppercase labels. */
const SHELL_CSS = `
  :root{--ink:#050505;--panel:rgba(255,255,255,.03);--line:rgba(255,255,255,.08);--paper:#fff;--smoke:#f2f2f0;--mute:rgba(255,255,255,.62);--dim:rgba(255,255,255,.4);--red:#E30613;--deep:#AA0310;--good:#2ecc71}
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--ink);color:var(--paper);font:16px/1.5 Inter,-apple-system,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;
    background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;background-attachment:fixed}
  main{max-width:600px;margin:0 auto;padding:28px 20px 64px}
  .top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:22px;border-bottom:1px solid var(--line)}
  .top img{height:18px;display:block}
  .eyebrow{font:500 11px/1 "Courier New",ui-monospace,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--mute)}
  .eyebrow .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:8px;vertical-align:middle;box-shadow:0 0 12px var(--red)}
  .pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:8px 14px}
  h1{font-family:"Space Grotesk",Inter,sans-serif;font-weight:700;font-size:38px;line-height:1.05;letter-spacing:-.03em;margin:28px 0 8px}
  h1 em{color:var(--red);font-style:normal}
  .sub{color:var(--mute);margin:0 0 26px;font-size:15px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px 20px}
  .hero .label{font-size:13px;color:var(--mute)}
  .hero .big{font-family:"Space Grotesk",Inter,sans-serif;font-size:76px;line-height:.95;font-weight:700;letter-spacing:-.045em;margin:8px 0 10px}
  .hero .big.warn{color:var(--red)}
  .hero .note{font-size:13px;color:var(--dim)}
  .hero .note b{color:var(--smoke);font-weight:600}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .kpi .label{font:500 10.5px/1 "Courier New",ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
  .kpi .val{font-family:"Space Grotesk",Inter,sans-serif;font-size:28px;font-weight:700;letter-spacing:-.03em;margin:8px 0 2px}
  .kpi .val.warn{color:var(--red)}
  .kpi small{color:var(--dim);font-size:12px}
  .mtd{margin-top:12px;border-left:2px solid var(--red)}
  .mtd .label{color:var(--smoke);font-weight:600;font-size:13px;margin-bottom:4px}
  .mtd .row{color:var(--mute);font-size:14px}
  .actions{margin:26px 0 0;display:flex;flex-direction:column;gap:10px}
  .btn{display:flex;align-items:center;justify-content:center;gap:10px;height:54px;border-radius:999px;background:var(--red);color:#fff;text-decoration:none;font-weight:600;font-size:16px;border:0;cursor:pointer;font-family:inherit}
  .btn:active{background:var(--deep)}
  .btn.ghost{background:var(--panel);border:1px solid var(--line);color:var(--mute)}
  .btn.soon{pointer-events:none;color:var(--dim)}
  .hide{display:none}
  table{width:100%;border-collapse:collapse;margin-top:30px;font-size:14px}
  th{text-align:left;padding:0 0 10px;border-bottom:1px solid var(--line);font:500 10.5px/1 "Courier New",ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
  td{padding:12px 0;border-bottom:1px solid var(--line);vertical-align:top}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td .muted{color:var(--dim);font-size:12px;display:block;margin-top:2px}
  td.n.warn{color:var(--red)}
  .foot{color:var(--dim);font-size:12.5px;margin-top:30px;line-height:1.6}
  .foot a{color:var(--mute)}
  input[type=email]{width:100%;height:54px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:#fff;padding:0 20px;font:inherit;font-size:16px;outline:none}
  input[type=email]:focus{border-color:rgba(227,6,19,.6);box-shadow:0 0 0 3px rgba(227,6,19,.15)}
  .msg{margin-top:14px;color:var(--mute);font-size:14px;min-height:20px}
  @media (min-width:600px){h1{font-size:44px}.hero .big{font-size:88px}}
  @media print{body{background:#fff;color:#111}.actions,.noprint{display:none}}
`;

const head = (title) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#050505"><meta name="robots" content="noindex">
<link rel="icon" href="${config.publicBaseUrl}/assets/icon@3x.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<title>${esc(title)}</title><style>${SHELL_CSS}</style></head><body><main>
<div class="top"><img src="${config.publicBaseUrl}/assets/wordmark@2x.png" alt="Alpha Drive AI"><span class="eyebrow"><span class="dot"></span>Lithia RMO Scorecard</span></div>`;

const foot = `</main></body></html>`;

/** Scorecard page (after the personal link has been opened once). */
export function landingPage({ rmo, settings, week, prevWeek, month, stores, storeMonths }) {
  const status = kpiStatus(week, settings);
  const appleHref = `${config.publicBaseUrl}/apple/add/${encodeURIComponent(rmo.slug)}.pkpass`;
  const googleHref = rmo.google_object_id ? `${config.publicBaseUrl}/google/add/${encodeURIComponent(rmo.slug)}` : null;
  const book = rateOf(week, 'book_rate', settings);
  const wow = delta(book, rateOf(prevWeek, 'book_rate', settings));
  const mtd = new Map(storeMonths.map((m) => [m.store_id, m]));
  const kpi = (label, value, note, warn) => `<div class="kpi"><div class="label">${esc(label)}</div><div class="val${warn ? ' warn' : ''}">${esc(value)}</div>${note ? `<small>${esc(note)}</small>` : ''}</div>`;

  return head(`${rmo.name} · Lithia scorecard · Alpha Drive AI`) + `
  <h1>${esc(rmo.name)}</h1>
  <p class="sub">${esc(rmo.region_name || '')}${week ? ` · ${esc(weekLabelLong(week.period_start, week.period_end))}` : ''} · ${stores.length} store${stores.length === 1 ? '' : 's'}</p>

  ${week ? `
  <section class="card hero">
    <div class="label">Book rate · appointments on all calls</div>
    <div class="big${status.book === 'watch' ? ' warn' : ''}">${esc(pct(book))}</div>
    <div class="note">Target above <b>${esc(pct(settings.booking_rate_target, 0))}</b>${wow ? ` · <b>${esc(wow)}</b> vs prior week` : ''}</div>
  </section>
  <div class="grid">
    ${kpi('Containment', pct(rateOf(week, 'containment_rate', settings)), 'Resolved by AI, no transfer')}
    ${kpi('Transfer rate', pct(rateOf(week, 'transfer_rate', settings)), `Keep below ${pct(settings.transfer_rate_max, 0)}`, status.transfer === 'watch')}
    ${kpi('Total calls', int(week.calls))}
    ${kpi('Customers served', int(week.customers))}
  </div>
  ${month ? `<section class="card mtd"><div class="label">${esc(monthLabel(month.month))} month to date · ${month.weeks} week${month.weeks === 1 ? '' : 's'}</div>
    <div class="row">Book ${esc(pct(rateOf(month, 'book_rate', settings)))} · Containment ${esc(pct(rateOf(month, 'containment_rate', settings), 0))} · Transfer ${esc(pct(rateOf(month, 'transfer_rate', settings), 0))} · ${esc(int(month.calls))} calls · ${esc(int(month.customers))} customers · ${esc(int(month.appointments))} appointments</div></section>` : ''}
  ` : `<section class="card"><div class="label">No weekly report posted yet.</div></section>`}

  <div class="actions">
    <a id="apple" class="btn" href="${appleHref}">Add to Apple Wallet</a>
    ${googleHref ? `<a id="google" class="btn" href="${googleHref}">Add to Google Wallet</a>` : `<a id="google" class="btn ghost soon" href="#">Google Wallet coming soon</a>`}
  </div>

  ${stores.length ? `<table>
    <thead><tr><th>Store</th><th class="n">Book</th><th class="n">Contain</th><th class="n">Transfer</th><th class="n">Calls</th><th class="n">MTD book</th></tr></thead>
    <tbody>${stores.map((s) => { const m = mtd.get(s.store_id); const low = s.book_rate != null && Number(s.book_rate) < Number(settings.booking_rate_target); return `<tr>
      <td>${esc(s.store_name)}<span class="muted">${esc(s.state || '')}${s.status === 'canceled' ? ' · Canceled' : ''}</span></td>
      <td class="n${low ? ' warn' : ''}">${esc(pct(s.book_rate))}</td><td class="n">${esc(pct(s.containment_rate, 0))}</td><td class="n">${esc(pct(s.transfer_rate, 0))}</td><td class="n">${esc(int(s.calls))}</td><td class="n">${m ? esc(pct(m.book_rate)) : '—'}</td></tr>`; }).join('')}</tbody></table>` : ''}

  <p class="foot"><span class="noprint">Once added, the card updates itself when the weekly report is posted. </span>Book rate = appointments ÷ total calls. Containment = calls resolved by AI without a transfer. Alpha Drive AI client support <a href="tel:2392215236">239-221-5236</a>.</p>
  <script>var ua=navigator.userAgent;if(/iPhone|iPad|iPod/.test(ua))document.getElementById('google').classList.add('hide');if(/Android/.test(ua))document.getElementById('apple').classList.add('hide');</script>
  ` + foot;
}

/** Locked view: no valid personal link on this device yet. */
export function lockedPage(rmo, { sent = false } = {}) {
  return head(`Lithia scorecard · Alpha Drive AI`) + `
  <h1>Your scorecard is <em>one tap</em> away.</h1>
  <p class="sub">This page is private to ${esc(rmo.name)}. Enter the email Lithia has on file and we will send your personal link. Open it on your phone and the card lands in your Wallet.</p>
  <section class="card">
    <form id="f" method="post" action="${config.publicBaseUrl}/auth/request">
      <input type="hidden" name="slug" value="${esc(rmo.slug)}">
      <div class="eyebrow" style="margin-bottom:12px">Work email</div>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@lithia.com" required>
      <div class="actions" style="margin-top:12px"><button id="go" class="btn" type="submit">Send my link</button></div>
      <div id="msg" class="msg">${sent ? "If that email is on file, your link is on its way. Check your inbox." : ""}</div>
    </form>
  </section>
  <p class="foot">Already have your link? Open it from the text or email we sent; it stays valid for months and only needs to be opened once per phone. Questions: Alpha Drive AI client support <a href="tel:2392215236">239-221-5236</a>.</p>
  <script>
    document.getElementById('f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = document.getElementById('go'), msg = document.getElementById('msg');
      btn.disabled = true; btn.textContent = 'Sending…'; msg.textContent = '';
      try {
        const r = await fetch('${config.publicBaseUrl}/auth/request', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ slug: ${JSON.stringify(rmo.slug)}, email: document.getElementById('email').value }) });
        const j = await r.json();
        msg.textContent = j.queued ? 'Request received. Your Alpha Drive AI contact will text or email your link shortly.' : 'If that email is on file, your link is on its way. Check your inbox.';
        btn.textContent = 'Sent';
      } catch (e) { msg.textContent = 'Something went wrong. Please try again or call support.'; btn.disabled = false; btn.textContent = 'Send my link'; }
    });
  </script>` + foot;
}

/** Branded HTML email carrying the personal link (table layout for mail clients). */
export function accessEmailHtml(rmo, link, days) {
  const first = esc(rmo.name.split(' ')[0]);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#050505;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0a0a0c;border:1px solid #1e1e22;border-radius:18px;padding:32px 28px;font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#ffffff;">
<tr><td style="padding-bottom:22px;border-bottom:1px solid #1e1e22;"><img src="${config.publicBaseUrl}/assets/wordmark@2x.png" alt="Alpha Drive AI" height="18" style="height:18px;display:block;"></td></tr>
<tr><td style="padding-top:26px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#9e9ea2;font-family:'Courier New',monospace;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#E30613;margin-right:8px;"></span>Lithia RMO Scorecard</td></tr>
<tr><td style="padding-top:14px;font-size:28px;line-height:1.1;font-weight:700;letter-spacing:-.02em;">Hi ${first}, your scorecard is <span style="color:#E30613;">one tap</span> away.</td></tr>
<tr><td style="padding-top:14px;font-size:15px;line-height:1.55;color:rgba(255,255,255,.72);">Open the button below on your phone, then tap <b style="color:#fff;">Add to Wallet</b>. The card updates itself every time the weekly report is posted.</td></tr>
<tr><td style="padding-top:26px;" align="left"><a href="${link}" style="display:inline-block;background:#E30613;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:16px 28px;border-radius:999px;">Open my scorecard</a></td></tr>
<tr><td style="padding-top:22px;font-size:12.5px;line-height:1.6;color:rgba(255,255,255,.45);">This link is personal to you and stays valid for ${days} days. If the button does not work, copy this address into Safari:<br><span style="word-break:break-all;color:rgba(255,255,255,.6);">${esc(link)}</span></td></tr>
<tr><td style="padding-top:26px;border-top:1px solid #1e1e22;margin-top:26px;font-size:12px;color:rgba(255,255,255,.45);">Alpha Drive AI client support · 239-221-5236 · alphadriveai.com</td></tr>
</table></td></tr></table></body></html>`;
}
