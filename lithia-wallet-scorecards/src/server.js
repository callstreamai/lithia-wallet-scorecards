import express from 'express';
import { config } from './config.js';
import * as db from './db.js';
import { appleRouter, pushRmo } from './apple/routes.js';
import { describeCertificate } from './apple/certs.js';
import { landingPage } from './landing.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

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

// ---- RMO landing page: detects device, offers the right button ----
app.get('/w/:slug', async (req, res, next) => {
  try {
    const rmo = await db.getRmoBySlug(req.params.slug);
    if (!rmo) return res.status(404).send('Scorecard not found');
    const scorecard = await db.getScorecard(rmo);
    res.type('html').send(landingPage(scorecard));
  } catch (e) { next(e); }
});

// ---- Supabase database webhook: store_scorecards insert/update/delete ----
app.post('/hooks/scorecard-updated', async (req, res, next) => {
  try {
    if (!config.webhookSecret || req.get('x-webhook-secret') !== config.webhookSecret) return res.sendStatus(401);
    const row = req.body?.record || req.body?.old_record;
    const storeId = row?.store_id;
    if (!storeId) return res.status(400).json({ error: 'no store_id in payload' });
    const rmo = await db.getRmoForStore(storeId);
    if (!rmo) return res.status(404).json({ error: 'rmo not found' });
    // Respond fast; push in the background so Supabase does not time out
    res.json({ ok: true, rmo: rmo.slug });
    pushRmo(rmo).then((r) => console.log(`[push] ${rmo.slug}`, r)).catch((e) => console.error('[push] failed', e));
  } catch (e) { next(e); }
});

// ---- Admin: force a push for one RMO (used by the admin app's "Push now" button) ----
app.post('/admin/rmos/:id/push', async (req, res, next) => {
  try {
    if (!config.adminApiKey || req.get('x-admin-key') !== config.adminApiKey) return res.sendStatus(401);
    const rmo = await db.getRmoById(req.params.id);
    if (!rmo) return res.sendStatus(404);
    await db.supabase.from('rmos').update({ pass_updated_at: new Date().toISOString() }).eq('id', rmo.id);
    const result = await pushRmo({ ...rmo, pass_updated_at: new Date().toISOString() });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

app.get('/', (_req, res) => res.redirect('https://alphadriveai.com'));

// ---- Errors ----
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
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
