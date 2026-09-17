import { readFile } from 'node:fs/promises';
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

  if (a.p12Path) {
    let certPem, keyPem;
    try {
      ({ certPem, keyPem } = await viaOpenssl(a.p12Path, a.p12Password));
    } catch (e) {
      console.warn('openssl p12 read failed, trying node-forge');
      ({ certPem, keyPem } = await viaForge(a.p12Path, a.p12Password));
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
