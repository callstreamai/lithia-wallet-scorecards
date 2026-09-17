import { readFile } from 'node:fs/promises';
import forge from 'node-forge';
import { config } from '../config.js';

const OID_UID = '0.9.2342.19200300.100.1.1'; // Apple puts the Pass Type ID here
const uidOf = (cert) => cert.subject.attributes.find((a) => a.type === OID_UID)?.value;

let cached;

/**
 * Returns { certPem, keyPem, keyPassword }.
 * Prefers the .p12 exported from Keychain Access; falls back to PEM files.
 */
export async function loadSigningMaterial() {
  if (cached) return cached;
  const a = config.apple;

  if (a.p12Path) {
    const der = await readFile(a.p12Path);
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, a.p12Password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const keyBags =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ||
      [];
    if (!certBags.length || !keyBags.length) throw new Error('p12 did not contain both a certificate and a private key');

    // Pick the leaf cert whose subject matches the Pass Type ID (skip WWDR/intermediates if bundled)
    const leaf =
      certBags.map((b) => b.cert).find((c) => uidOf(c) === a.passTypeId) || certBags[0].cert;

    cached = {
      certPem: forge.pki.certificateToPem(leaf),
      keyPem: forge.pki.privateKeyToPem(keyBags[0].key),
      keyPassword: undefined,
    };
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
