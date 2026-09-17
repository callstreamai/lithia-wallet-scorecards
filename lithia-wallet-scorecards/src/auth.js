import jwt from 'jsonwebtoken';
import { config } from './config.js';
import * as db from './db.js';
import { accessEmailHtml } from './landing.js';

const SECRET = process.env.SESSION_SECRET || config.adminApiKey;
const DAYS = Number(process.env.ACCESS_LINK_DAYS || 180);
const REQUIRE = String(process.env.REQUIRE_ACCESS_LINK || 'true').toLowerCase() !== 'false';

const cookieName = (slug) => `adai_${slug.replace(/[^a-z0-9]/gi, '_')}`;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

/** Long-lived signed link for one RMO: /w/<slug>?t=<token> */
export function magicLink(rmo) {
  const token = jwt.sign({ sub: rmo.id, slug: rmo.slug, v: 1 }, SECRET, { expiresIn: `${DAYS}d` });
  return `${config.publicBaseUrl}/w/${encodeURIComponent(rmo.slug)}?t=${token}`;
}

export function verifyToken(token, rmo) {
  try {
    const p = jwt.verify(token, SECRET);
    return p.sub === rmo.id && p.slug === rmo.slug;
  } catch { return false; }
}

/**
 * Express middleware factory. Resolves the RMO from :slug, then:
 *  ?t=token  -> verify, set cookie, redirect to the clean URL
 *  cookie    -> verify, continue
 *  neither   -> res.locals.locked = true (page renders the request-access view) or 401 for downloads
 */
export function rmoAccess({ mode = 'page' } = {}) {
  return async (req, res, next) => {
    try {
      const rmo = await db.getRmoBySlug(req.params.slug);
      if (!rmo) return res.status(404).send('Scorecard not found');
      req.rmo = rmo;
      if (!REQUIRE) return next();

      const name = cookieName(rmo.slug);
      const t = req.query.t;
      if (t && verifyToken(String(t), rmo)) {
        res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(String(t))}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
        await db.logEvent(rmo.id, 'apple', 'access_link_used', { ua: req.get('user-agent') });
        if (mode === 'page') return res.redirect(302, req.path); // drop the token from the address bar
        return next();
      }
      const cookies = parseCookies(req.get('cookie'));
      if (cookies[name] && verifyToken(cookies[name], rmo)) return next();

      if (mode === 'page') { res.locals.locked = true; return next(); }
      return res.status(401).send('Open your scorecard link first, then tap Add to Wallet.');
    } catch (e) { next(e); }
  };
}

/**
 * Someone typed an email on the locked page. If it matches the RMO (or their Senior RMO),
 * send the link when an email provider is configured; always log the request.
 */
export async function handleAccessRequest(slug, email) {
  const rmo = await db.getRmoBySlug(slug);
  if (!rmo) return { ok: false, reason: 'not_found' };
  const e = String(email || '').trim().toLowerCase();
  const allowed = [rmo.email, rmo.manager_email].filter(Boolean).map((x) => x.toLowerCase());
  const match = allowed.includes(e);
  await db.logEvent(rmo.id, 'apple', match ? 'access_requested' : 'access_denied', { email: e });
  if (!match) return { ok: true, sent: false }; // same response either way; do not leak who is on file

  if (process.env.RESEND_API_KEY) {
    const link = magicLink(rmo);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Alpha Drive AI <scorecards@alphadriveai.com>',
        to: [e],
        subject: `Your Lithia scorecard link`,
        html: accessEmailHtml(rmo, link, DAYS),
        text: `Hi ${rmo.name.split(' ')[0]},\n\nHere is your Alpha Drive AI scorecard. Open it on your phone and tap Add to Wallet:\n${link}\n\nThis link is personal to you and stays valid for ${DAYS} days.\n\nAlpha Drive AI client support · 239-221-5236`,
      }),
    });
    await db.logEvent(rmo.id, 'apple', r.ok ? 'access_link_emailed' : 'access_link_email_failed', { status: r.status });
    return { ok: true, sent: r.ok };
  }
  return { ok: true, sent: false, queued: true };
}
