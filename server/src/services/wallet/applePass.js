import crypto from 'node:crypto';
import forge from 'node-forge';
import { buildZip } from './zip.js';
import { iconPng } from './png.js';
import { resolvedDesign, rgbText } from './design.js';

// Builds a signed Apple Wallet pass (.pkpass) for one driver's tag. The pass carries the tag
// as its NFC message, so a charge point's reader can read it when the driver taps the phone.
// `apple` is the resolved Apple settings (see walletSettings.js), already checked as ready.
export function buildPkpass(apple, { serial, design = {} }) {
  const look = resolvedDesign(design);
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: apple.passTypeIdentifier,
    teamIdentifier: apple.teamIdentifier,
    organizationName: apple.organizationName,
    description: `${apple.organizationName} charging pass`,
    logoText: apple.organizationName,
    serialNumber: serial,
    foregroundColor: rgbText(look.foregroundColor),
    labelColor: rgbText(look.labelColor),
    backgroundColor: rgbText(look.backgroundColor),
    nfc: { message: serial, requiresAuthentication: false },
    generic: {
      primaryFields: [{ key: 'charging', label: look.primaryLabel, value: look.primaryValue }],
      backFields: [{ key: 'how', label: 'How to use it', value: look.backText }],
    },
  };

  // The icon the operator uploaded, or the plain square. Apple wants a 29 pixel and a 58 pixel
  // version. An upload is 58 pixels, so it serves both.
  const icon = look.iconPng ?? iconPng(29);
  const icon2x = look.iconPng ?? iconPng(58);
  const files = {
    'pass.json': Buffer.from(JSON.stringify(pass)),
    'icon.png': icon,
    'icon@2x.png': icon2x,
  };

  // The manifest lists the SHA-1 of every other file, and the signature covers the manifest.
  const manifest = {};
  for (const [name, data] of Object.entries(files)) {
    manifest[name] = crypto.createHash('sha1').update(data).digest('hex');
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest));

  return buildZip({
    ...files,
    'manifest.json': manifestBuf,
    signature: signManifest(manifestBuf, apple),
  });
}

// A detached PKCS#7 (CMS) signature of the manifest, made with the pass certificate, with the
// Apple WWDR certificate included so the chain can be checked.
export function signManifest(manifest, apple) {
  const certificate = forge.pki.certificateFromPem(apple.signingCertificate);
  const key = forge.pki.privateKeyFromPem(apple.signingKey);
  const wwdr = forge.pki.certificateFromPem(apple.wwdrCertificate);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'), 'raw');
  p7.addCertificate(certificate);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}
