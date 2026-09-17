import { Router } from 'express';
import { config } from '../config.js';
import * as db from '../db.js';
import { buildPass } from './pass.js';
import { pushPassUpdate } from './apns.js';
import { rmoAccess } from '../auth.js';

export const appleRouter = Router();

// Apple sends: Authorization: ApplePass <authenticationToken>
async function authenticatedRmo(req, res, serialNumber) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('ApplePass ') ? header.slice('ApplePass '.length).trim() : null;
  if (!token) { res.sendStatus(401); return null; }
  const rmo = await db.getRmoBySerial(serialNumber);
  if (!rmo || rmo.auth_token !== token) { res.sendStatus(401); return null; }
  return rmo;
}

function checkPassType(req, res) {
  if (req.params.passTypeId !== config.apple.passTypeId) { res.sendStatus(404); return false; }
  return true;
}

// ---- PassKit Web Service (https://developer.apple.com/documentation/walletpasses) ----

// Register a device for push updates on a pass
appleRouter.post('/v1/devices/:deviceId/registrations/:passTypeId/:serial', async (req, res, next) => {
  try {
    if (!checkPassType(req, res)) return;
    const rmo = await authenticatedRmo(req, res, req.params.serial);
    if (!rmo) return;
    const pushToken = req.body?.pushToken;
    if (!pushToken) return res.sendStatus(400);
    const created = await db.registerDevice({
      deviceLibraryId: req.params.deviceId, pushToken, serialNumber: req.params.serial, passTypeId: req.params.passTypeId,
    });
    await db.logEvent(rmo.id, 'apple', created ? 'device_registered' : 'device_reregistered', { device: req.params.deviceId });
    res.sendStatus(created ? 201 : 200);
  } catch (e) { next(e); }
});

// Unregister a device
appleRouter.delete('/v1/devices/:deviceId/registrations/:passTypeId/:serial', async (req, res, next) => {
  try {
    if (!checkPassType(req, res)) return;
    const rmo = await authenticatedRmo(req, res, req.params.serial);
    if (!rmo) return;
    await db.unregisterDevice({ deviceLibraryId: req.params.deviceId, serialNumber: req.params.serial });
    await db.logEvent(rmo.id, 'apple', 'device_unregistered', { device: req.params.deviceId });
    res.sendStatus(200);
  } catch (e) { next(e); }
});

// Which of this device's passes changed since X?
appleRouter.get('/v1/devices/:deviceId/registrations/:passTypeId', async (req, res, next) => {
  try {
    if (!checkPassType(req, res)) return;
    const since = req.query.passesUpdatedSince ? new Date(Number(req.query.passesUpdatedSince) * 1000).toISOString() : undefined;
    const { serials, lastUpdated } = await db.serialsUpdatedForDevice(req.params.deviceId, since);
    if (!serials.length) return res.sendStatus(204);
    res.json({ lastUpdated: String(Math.floor(lastUpdated.getTime() / 1000)), serialNumbers: serials });
  } catch (e) { next(e); }
});

// Latest version of a pass
appleRouter.get('/v1/passes/:passTypeId/:serial', async (req, res, next) => {
  try {
    if (!checkPassType(req, res)) return;
    const rmo = await authenticatedRmo(req, res, req.params.serial);
    if (!rmo) return;
    const lastModified = new Date(rmo.pass_updated_at);
    const ims = req.get('if-modified-since');
    if (ims && new Date(ims) >= new Date(Math.floor(lastModified.getTime() / 1000) * 1000)) return res.sendStatus(304);
    const buf = await buildPass(await db.getScorecard(rmo));
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': lastModified.toUTCString(),
      'Cache-Control': 'no-store',
    });
    res.send(buf);
  } catch (e) { next(e); }
});

// Wallet posts diagnostic logs here when something goes wrong with a pass
appleRouter.post('/v1/log', (req, res) => {
  for (const line of req.body?.logs || []) console.warn('[wallet-log]', line);
  res.sendStatus(200);
});

// ---- Distribution: one tap add from the RMO's link ----

appleRouter.get('/add/:slug.pkpass', rmoAccess({ mode: 'download' }), async (req, res, next) => {
  try {
    const rmo = req.rmo;
    const buf = await buildPass(await db.getScorecard(rmo));
    await db.logEvent(rmo.id, 'apple', 'pass_downloaded', { ua: req.get('user-agent') });
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `inline; filename="alpha-drive-scorecard-${rmo.slug}.pkpass"`,
      'Cache-Control': 'no-store',
    });
    res.send(buf);
  } catch (e) { next(e); }
});

// ---- Push: tell every registered iPhone that this RMO's pass changed ----

export async function pushRmo(rmo) {
  const targets = await db.pushTokensForSerial(rmo.serial_number);
  const results = { sent: 0, failed: 0, removed: 0 };
  for (const t of targets) {
    try {
      const r = await pushPassUpdate(t.pushToken);
      if (r.status === 200) results.sent++;
      else if (r.status === 410 || /BadDeviceToken|Unregistered/.test(r.body)) {
        await db.deleteDevice(t.deviceLibraryId);
        results.removed++;
      } else { results.failed++; console.error('APNs', r.status, r.body); }
    } catch (e) { results.failed++; console.error('APNs error', e.message); }
  }
  await db.logEvent(rmo.id, 'apple', 'push', { devices: targets.length, ...results });
  return results;
}
