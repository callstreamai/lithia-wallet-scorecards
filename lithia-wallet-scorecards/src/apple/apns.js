import http2 from 'node:http2';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const APNS_HOST = 'https://api.push.apple.com'; // Wallet always uses production
let keyPem;
let token = { value: null, issued: 0 };
let session;

async function bearer() {
  if (!config.apple.apnsKeyId) throw new Error('APPLE_APNS_KEY_ID not configured');
  // Key text may come from an env var (APPLE_APNS_KEY, PEM contents) or a file path
  if (!keyPem) {
    const fromEnv = process.env.APPLE_APNS_KEY;
    if (fromEnv && fromEnv.trim()) keyPem = fromEnv.replace(/\\n/g, '\n').trim() + '\n';
    else if (config.apple.apnsKeyPath) keyPem = await readFile(config.apple.apnsKeyPath, 'utf8');
    else throw new Error('Set APPLE_APNS_KEY (PEM text) or APPLE_APNS_KEY_PATH');
  }
  // Apple wants tokens refreshed between 20 and 60 minutes
  if (!token.value || Date.now() - token.issued > 45 * 60 * 1000) {
    token = {
      value: jwt.sign({ iss: config.apple.teamId, iat: Math.floor(Date.now() / 1000) }, keyPem, {
        algorithm: 'ES256',
        header: { alg: 'ES256', kid: config.apple.apnsKeyId },
      }),
      issued: Date.now(),
    };
  }
  return token.value;
}

function getSession() {
  if (!session || session.closed || session.destroyed) {
    session = http2.connect(APNS_HOST);
    session.on('error', () => { try { session.destroy(); } catch {} session = null; });
    session.on('goaway', () => { try { session.destroy(); } catch {} session = null; });
    session.unref();
  }
  return session;
}

/**
 * Sends the empty-payload push that tells Wallet to re-fetch a pass.
 * @returns {Promise<{status:number, body:string}>}
 */
export async function pushPassUpdate(pushToken) {
  const auth = await bearer();
  const s = getSession();
  return new Promise((resolve, reject) => {
    const req = s.request({
      ':method': 'POST',
      ':path': `/3/device/${encodeURIComponent(pushToken)}`,
      authorization: `bearer ${auth}`,
      'apns-topic': config.apple.passTypeId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '0',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.setTimeout(8000, () => req.close(http2.constants.NGHTTP2_CANCEL, () => reject(new Error('APNs timeout'))));
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve({ status, body }));
    req.on('error', reject);
    req.end('{}');
  });
}
