import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import forge from 'node-forge';
import { config } from '../config.js';

const run = promisify(execFile);
const firstLine = (t) => String(t || '').split('\n').find((l) => l.trim()) || '';
const OID_UID = '0.9.2342.19200300.100.1.1'; // Apple puts the Pass Type ID here
const uidOf = (cert) => cert.subject.attributes.find((a) => a.type === OID_UID)?.value;

let cached;

/**
 * Returns { certPem, keyPem, keyPassword }.
 * Prefers the .p12 exported from Keychain Access, decrypted with the system OpenSSL
 * (handles the AES-256 / SHA-256 variants that pure-JS parsers reject). Falls back to PEM files.
 */
export async function loadSigningMaterial() {
  if (cached) return cached;
  try { const { stdout } = await run('openssl', ['version']); console.log('openssl:', stdout.trim()); } catch {}
  const a = config.apple;

  // Base64 env var wins: Render secret files can mangle binary uploads.
  let p12Path = a.p12Path;
  const p12Base64 = process.env.APPLE_PASS_P12_BASE64;
  if (p12Base64) {
    p12Path = path.join(os.tmpdir(), 'lithia-scorecard.p12');
    await writeFile(p12Path, Buffer.from(p12Base64.replace(/\s+/g, ''), 'base64'), { mode: 0o600 });
    console.log('p12 decoded from APPLE_PASS_P12_BASE64');
  }

  if (p12Path) {
    // Accept a base64 text file at the p12 path too (binary uploads get mangled by some dashboards)
    const raw = await readFile(p12Path);
    if (raw[0] !== 0x30 && /^[A-Za-z0-9+/=\r\n\s]+$/.test(raw.toString('latin1').slice(0, 4000))) {
      const decoded = Buffer.from(raw.toString('ascii').replace(/\s+/g, ''), 'base64');
      p12Path = path.join(os.tmpdir(), 'lithia-scorecard.decoded.p12');
      await writeFile(p12Path, decoded, { mode: 0o600 });
      console.log(`p12 file was base64 text; decoded ${decoded.length} bytes (first byte 0x${decoded[0]?.toString(16)})`);
    } else {
      console.log(`p12 file: ${raw.length} bytes (first byte 0x${raw[0]?.toString(16)})`);
    }
    let certPem, keyPem;
    try {
      ({ certPem, keyPem } = await viaOpenssl(p12Path, a.p12Password));
    } catch (e) {
      console.warn('openssl p12 read failed, trying node-forge');
      ({ certPem, keyPem } = await viaForge(p12Path, a.p12Password));
    }
    cached = { certPem, keyPem, keyPassword: undefined };
    return cached;
  }

  if (a.certPemPath && a.keyPemPath) {
    cached = {
      certPem: await readFile(a.certPemPath, 'utf8'),
      keyPem: await readFile(a.keyPemPath, 'utf8'),
      keyPassword: a.keyPemPassword || undefined,
    };
    return cached;
  }

  throw new Error('Set APPLE_PASS_P12_PATH (recommended) or APPLE_PASS_CERT_PEM_PATH + APPLE_PASS_KEY_PEM_PATH');
}

async function viaOpenssl(p12Path, password) {
  const env = { ...process.env, P12PW: password || '' };
  const common = ['pkcs12', '-in', p12Path, '-passin', 'env:P12PW'];
  // -legacy is needed on OpenSSL 3 for RC2/3DES exports; try without first, then with.
  const attempt = async (extra) => {
    const { stdout: certs } = await run('openssl', [...common, '-clcerts', '-nokeys', ...extra], { env, maxBuffer: 1 << 20 });
    const { stdout: key } = await run('openssl', [...common, '-nocerts', '-nodes', ...extra], { env, maxBuffer: 1 << 20 });
    return { certs, key };
  };
  let out;
  try { out = await attempt([]); }
  catch (e1) {
    console.warn('openssl (default):', firstLine(e1.stderr) || e1.message);
    try { out = await attempt(['-legacy']); }
    catch (e2) { console.warn('openssl (-legacy):', firstLine(e2.stderr) || e2.message); throw e2; }
  }

  const certPems = out.certs.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  const keyPem = (out.key.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/) || [])[0];
  if (!certPems.length || !keyPem) throw new Error('p12 did not yield both a certificate and a private key');
  const leaf = certPems.find((pem) => uidOf(forge.pki.certificateFromPem(pem)) === config.apple.passTypeId) || certPems[0];
  return { certPem: leaf, keyPem };
}

async function viaForge(p12Path, password) {
  const der = await readFile(p12Path);
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password || '');
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  if (!certBags.length || !keyBags.length) throw new Error('p12 did not contain both a certificate and a private key');
  const leaf = certBags.map((b) => b.cert).find((c) => uidOf(c) === config.apple.passTypeId) || certBags[0].cert;
  return { certPem: forge.pki.certificateToPem(leaf), keyPem: forge.pki.privateKeyToPem(keyBags[0].key) };
}

/** Sanity check used at startup and by /health: subject UID must equal the pass type id. */
export async function describeCertificate() {
  const { certPem } = await loadSigningMaterial();
  const cert = forge.pki.certificateFromPem(certPem);
  return {
    subject: cert.subject.attributes.map((x) => `${x.shortName || x.name || x.type}=${x.value}`).join(', '),
    passTypeId: uidOf(cert),
    teamId: cert.subject.getField('OU')?.value,
    notAfter: cert.validity.notAfter,
  };
}
