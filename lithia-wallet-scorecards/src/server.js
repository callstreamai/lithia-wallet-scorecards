import express from 'express';
import { config } from './config.js';
import * as db from './db.js';
import { appleRouter, pushRmo } from './apple/routes.js';
import { describeCertificate } from './apple/certs.js';
import { landingPage, lockedPage } from './landing.js';
import { rmoAccess, handleAccessRequest, magicLink } from './auth.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReport } from './import-report.js';
import { applyReport } from './import-apply.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/assets', express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets'), { maxAge: '7d', immutable: true }));

// Browser admin portal (Netlify) calls the /admin endpoints cross-origin
app.use('/admin', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, x-admin-key, x-filename, x-user',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (!config.adminApiKey || req.get('x-admin-key') !== config.adminApiKey) return res.sendStatus(401);
  next();
});

// ---- Health ----
app.get('/health', async (_req, res) => {
  try {
    const cert = await describeCertificate();
    const { error } = await db.supabase.from('settings').select('id').limit(1);
    res.json({
      ok: !error && cert.passTypeId === config.apple.passTypeId,
      apple: { passTypeId: cert.passTypeId, teamId: cert.teamId, certExpires: cert.notAfter },
      supabase: error ? error.message : 'ok',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Apple Wallet (PassKit web service lives under /apple) ----
app.use('/apple', appleRouter);

// ---- RMO landing page (magic-link protected) ----
app.get('/w/:slug', rmoAccess({ mode: 'page' }), async (req, res, next) => {
  try {
    if (res.locals.locked) return res.status(200).type('html').send(lockedPage(req.rmo, { sent: req.query.sent === '1' }));
    res.type('html').send(landingPage(await db.getScorecard(req.rmo, req.query.week)));
  } catch (e) { next(e); }
});

// Locked page form: email -> send personal link (if the address is on file)
app.post('/auth/request', async (req, res, next) => {
  try {
    const { slug, email } = req.body || {};
    if (!slug) return res.sendStatus(400);
    const result = await handleAccessRequest(slug, email);
    if ((req.get('accept') || '').includes('application/json') || req.is('application/json')) return res.json(result);
    res.redirect(302, `/w/${encodeURIComponent(slug)}?sent=1`);
  } catch (e) { next(e); }
});

// ---- Supabase database webhook: store_weeks insert/update/delete ----
app.post('/hooks/scorecard-updated', async (req, res, next) => {
  try {
    if (!config.webhookSecret || req.get('x-webhook-secret') !== config.webhookSecret) return res.sendStatus(401);
    const row = req.body?.record || req.body?.old_record;
    if (!row?.store_id) return res.status(400).json({ error: 'no store_id in payload' });
    const rmo = await db.getRmoForStore(row.store_id);
    if (!rmo) return res.json({ ok: true, skipped: 'store has no RMO' });
    res.json({ ok: true, rmo: rmo.slug });
    schedulePush(rmo);
  } catch (e) { next(e); }
});

// Imports touch many rows at once; coalesce pushes per RMO so each phone gets one notification
const pending = new Map();
function schedulePush(rmo, delayMs = 4000) {
  clearTimeout(pending.get(rmo.id));
  pending.set(rmo.id, setTimeout(() => {
    pending.delete(rmo.id);
    pushRmo(rmo).then((r) => console.log(`[push] ${rmo.slug}`, r)).catch((e) => console.error('[push] failed', rmo.slug, e.message));
  }, delayMs));
}

// ---- Admin API (portal) ----

// Upload the weekly Excel report. Body = raw .xlsx bytes. ?weeks=latest|all
app.post('/admin/import', express.raw({ type: () => true, limit: '25mb' }), async (req, res, next) => {
  try {
    if (!req.body?.length) return res.status(400).json({ error: 'empty upload' });
    const parsed = parseReport(req.body);
    if (!parsed.weeks.length) return res.status(422).json({ error: 'No sheet titled "Week of ..." found in this workbook' });
    const result = await applyReport(parsed, {
      weeks: req.query.weeks === 'all' ? 'all' : 'latest',
      filename: req.get('x-filename') || null,
      createdBy: req.get('x-user') || 'portal',
    });
    for (const id of result.rmoIds) {
      const rmo = await db.getRmoById(id);
      if (rmo) schedulePush(rmo, 1500);
    }
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// Preview what an upload contains without writing anything
app.post('/admin/import/preview', express.raw({ type: () => true, limit: '25mb' }), (req, res, next) => {
  try {
    const parsed = parseReport(req.body);
    res.json({
      weeks: parsed.weeks.map((w) => ({ start: w.start, end: w.end, sheet: w.sheet, dealers: w.rows.length })),
      hasMapping: !!parsed.mapping,
    });
  } catch (e) { next(e); }
});

// Personal access link for one RMO (portal shows a Copy button)
app.get('/admin/rmos/:id/link', async (req, res, next) => {
  try {
    const rmo = await db.getRmoById(req.params.id);
    if (!rmo) return res.sendStatus(404);
    res.json({ ok: true, url: magicLink(rmo) });
  } catch (e) { next(e); }
});

// Force a push for one RMO
app.post('/admin/rmos/:id/push', async (req, res, next) => {
  try {
    const rmo = await db.getRmoById(req.params.id);
    if (!rmo) return res.sendStatus(404);
    await db.supabase.from('rmos').update({ pass_updated_at: new Date().toISOString() }).eq('id', rmo.id);
    res.json({ ok: true, ...(await pushRmo(rmo)) });
  } catch (e) { next(e); }
});

// Force a push for everyone
app.post('/admin/push-all', async (_req, res, next) => {
  try {
    const rmos = await db.listActiveRmos();
    await db.supabase.from('rmos').update({ pass_updated_at: new Date().toISOString() }).eq('active', true);
    const results = {};
    for (const rmo of rmos) results[rmo.slug] = await pushRmo(rmo);
    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

app.get('/', (_req, res) => res.redirect('https://alphadriveai.com'));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(config.port, async () => {
  console.log(`Lithia Wallet Scorecards listening on :${config.port} (${config.publicBaseUrl})`);
  try {
    const c = await describeCertificate();
    console.log(`Apple cert OK for ${c.passTypeId} (team ${c.teamId}), expires ${c.notAfter.toISOString().slice(0, 10)}`);
    if (c.passTypeId !== config.apple.passTypeId) console.error('WARNING: certificate UID does not match APPLE_PASS_TYPE_ID');
  } catch (e) {
    console.error('Apple certificate not loaded:', e.message);
  }
});
