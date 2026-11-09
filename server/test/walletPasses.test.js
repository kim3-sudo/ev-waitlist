import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';
import { DRIVER_ROLE } from '../src/auth/permissions.js';
import { driverSession } from '../src/services/driverAccounts.js';
import { buildZip } from '../src/services/wallet/zip.js';
import { buildPkpass } from '../src/services/wallet/applePass.js';
import { iconPng } from '../src/services/wallet/png.js';
import { appleCheck, googleCheck } from '../src/services/wallet/walletSettings.js';
import { designCheck } from '../src/services/wallet/design.js';

const PASSWORD = 'Password123!';
const TYPE_ID = 'pass.test.charging';
const TEAM_ID = 'ABCDE12345';
const inSite = (fn) => runWithTenant(DEFAULT_TENANT_ID, fn);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// Test certificates, made once. A real pass needs Apple's certificates; these have the same
// shape (a pass type certificate and a WWDR certificate) so the signing code runs end to end.
function makeCertificates() {
  const attrs = (cn) => [
    { name: 'commonName', value: cn },
    { name: 'organizationalUnitName', value: TEAM_ID },
    { name: 'countryName', value: 'US' },
  ];
  const selfSigned = (keys, cn) => {
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = `0${crypto.randomBytes(8).toString('hex')}`;
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    cert.setSubject(attrs(cn));
    cert.setIssuer(attrs(cn));
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return forge.pki.certificateToPem(cert);
  };
  const passKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const wwdrKeys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  return {
    passCertPem: selfSigned(passKeys, `Pass Type ID: ${TYPE_ID}`),
    passKeyPem: forge.pki.privateKeyToPem(passKeys.privateKey),
    otherKeyPem: forge.pki.privateKeyToPem(wwdrKeys.privateKey),
    wwdrPem: selfSigned(wwdrKeys, 'Apple Worldwide Developer Relations Certification Authority'),
  };
}

const CERTS = makeCertificates();
const GOOGLE_KEYS = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const GOOGLE_EMAIL = 'plugs@example-project.iam.gserviceaccount.com';

// The Apple settings as the checks read them (plain field names), and as the admin page saves them.
const APPLE = {
  passTypeIdentifier: TYPE_ID,
  teamIdentifier: TEAM_ID,
  organizationName: 'Test Charging',
  signingCertificate: CERTS.passCertPem,
  signingKey: CERTS.passKeyPem,
  wwdrCertificate: CERTS.wwdrPem,
};
const APPLE_VALUES = {
  'wallet.apple.passTypeIdentifier': TYPE_ID,
  'wallet.apple.teamIdentifier': TEAM_ID,
  'wallet.apple.organizationName': 'Test Charging',
  'wallet.apple.signingCertificate': CERTS.passCertPem,
  'wallet.apple.signingKey': CERTS.passKeyPem,
  'wallet.apple.wwdrCertificate': CERTS.wwdrPem,
};
const GOOGLE_VALUES = {
  'wallet.google.issuerId': '3388000000012345678',
  'wallet.google.classId': 'charging_pass',
  'wallet.google.serviceAccountKey': JSON.stringify({
    client_email: GOOGLE_EMAIL,
    private_key: GOOGLE_KEYS.privateKey,
  }),
};

// Reads the entries of a stored (uncompressed) ZIP archive, by walking its local headers.
function readZip(buf) {
  const files = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const extraLength = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extraLength;
    files[name] = buf.subarray(start, start + size);
    at = start + size;
  }
  return files;
}

async function driverToken(email = 'dana@example.test') {
  return inSite(async () => {
    const account = await prisma.admin.create({ data: { email, role: DRIVER_ROLE, name: 'Dana' } });
    return { token: (await driverSession(account)).token, accountId: account.id };
  });
}

async function adminToken() {
  const admin = await createAdmin({ password: PASSWORD });
  const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD });
  return res.body.token;
}

describe('zip archives', () => {
  it('stores each file and reads them back unchanged', () => {
    const zip = buildZip({ 'a.txt': Buffer.from('hello'), 'b.json': Buffer.from('{"x":1}') });
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const files = readZip(zip);
    assert.deepEqual(Object.keys(files), ['a.txt', 'b.json']);
    assert.equal(files['a.txt'].toString(), 'hello');
    assert.equal(files['b.json'].toString(), '{"x":1}');
  });

  it('writes a PNG icon at the size asked for', () => {
    const png = iconPng(29);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 29); // IHDR width
    assert.equal(png.readUInt32BE(20), 29); // IHDR height
  });
});

describe('Apple pass file', () => {
  const apple = APPLE;

  it('holds the pass, icons, manifest and signature, with the tag as the serial and NFC message', () => {
    const files = readZip(buildPkpass(apple, { serial: 'ABCDEF012345' }));
    assert.deepEqual(Object.keys(files).sort(), ['icon.png', 'icon@2x.png', 'manifest.json', 'pass.json', 'signature']);
    const pass = JSON.parse(files['pass.json']);
    assert.equal(pass.serialNumber, 'ABCDEF012345');
    assert.equal(pass.nfc.message, 'ABCDEF012345');
    assert.equal(pass.passTypeIdentifier, TYPE_ID);
    assert.equal(pass.teamIdentifier, TEAM_ID);
  });

  it('lists the SHA-1 of every file in the manifest', () => {
    const files = readZip(buildPkpass(apple, { serial: 'ABCDEF012345' }));
    const manifest = JSON.parse(files['manifest.json']);
    for (const name of ['pass.json', 'icon.png', 'icon@2x.png']) {
      assert.equal(manifest[name], crypto.createHash('sha1').update(files[name]).digest('hex'), name);
    }
  });

  it('signs the manifest so the signature verifies against the pass certificate', () => {
    const files = readZip(buildPkpass(apple, { serial: 'ABCDEF012345' }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkpass-test-'));
    try {
      const manifestPath = path.join(dir, 'manifest.json');
      const signaturePath = path.join(dir, 'signature');
      fs.writeFileSync(manifestPath, files['manifest.json']);
      fs.writeFileSync(signaturePath, files.signature);
      // Throws when the signature does not match the manifest. -noverify skips the chain to
      // Apple's root, which a test certificate does not have.
      execFileSync('openssl', ['smime', '-verify', '-noverify', '-binary', '-inform', 'DER', '-in', signaturePath, '-content', manifestPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('settings checks', () => {
  it('reports nothing set up as not configured', () => {
    assert.deepEqual(appleCheck({}).configured, false);
    assert.equal(googleCheck({}).ready, false);
  });

  it('refuses a private key that belongs to another certificate', () => {
    const check = appleCheck({ ...APPLE, signingKey: CERTS.otherKeyPem });
    assert.equal(check.ready, false);
    assert.ok(check.invalid.some((m) => m.includes("doesn't match")));
  });

  it('refuses a certificate for a different pass type', () => {
    const check = appleCheck({ ...APPLE, passTypeIdentifier: 'pass.someone.else' });
    assert.ok(check.invalid.some((m) => m.includes('different pass type')));
  });

  it('is ready once every Apple field is valid', () => {
    const check = appleCheck(APPLE);
    assert.deepEqual(check.missing, []);
    assert.deepEqual(check.invalid, []);
    assert.equal(check.ready, true);
  });

  it('refuses a Google service account key that is not JSON', () => {
    const check = googleCheck({ serviceAccountKey: 'not json', issuerId: '1', classId: 'c' });
    assert.equal(check.ready, false);
    assert.ok(check.invalid.some((m) => m.includes('service account key')));
  });
});

describe('wallet settings and pass issuing', () => {
  beforeEach(async () => {
    await resetDb();
  });
  // The suite shares one database, so leave it empty for the files that run after this one.
  after(async () => {
    await resetDb();
  });

  it('refuses a wrong certificate on save, and saves nothing', async () => {
    const token = await adminToken();
    const res = await request(app)
      .put('/api/admin/wallet')
      .set(bearer(token))
      .send({ ...APPLE_VALUES, 'wallet.apple.signingKey': CERTS.otherKeyPem });
    assert.equal(res.status, 400);
    const after = await request(app).get('/api/admin/wallet').set(bearer(token));
    assert.equal(after.body.secretsSet['wallet.apple.signingKey'], false);
  });

  it('saves the settings, never returns a secret, and reports both platforms ready', async () => {
    const token = await adminToken();
    const res = await request(app)
      .put('/api/admin/wallet')
      .set(bearer(token))
      .send({ ...APPLE_VALUES, ...GOOGLE_VALUES });
    assert.equal(res.status, 200);
    assert.equal(res.body.status.apple.ready, true);
    assert.equal(res.body.status.google.ready, true);
    assert.equal(res.body.secretsSet['wallet.apple.signingKey'], true);
    assert.equal(res.body.secretsSet['wallet.google.serviceAccountKey'], true);
    assert.ok(!JSON.stringify(res.body).includes('PRIVATE KEY'), 'no key appears in the reply');
  });

  it('tests both platforms once they are filled in', async () => {
    const token = await adminToken();
    await request(app).put('/api/admin/wallet').set(bearer(token)).send({ ...APPLE_VALUES, ...GOOGLE_VALUES });
    const res = await request(app).post('/api/admin/wallet/test').set(bearer(token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => [r.platform, r.ok]), [['apple', true], ['google', true]]);
  });

  it('keeps viewers out of wallet settings', async () => {
    const viewer = await createAdmin({ password: PASSWORD });
    await rawPrisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
    const login = await request(app).post('/api/auth/login').send({ email: viewer.email, password: PASSWORD });
    const res = await request(app).get('/api/admin/wallet').set(bearer(login.body.token));
    assert.equal(res.status, 403);
  });

  it('offers no pass until the site has set one up', async () => {
    const { token } = await driverToken();
    const offered = await request(app).get('/api/driver/wallet').set(bearer(token));
    assert.deepEqual(offered.body, { apple: false, google: false });
    const apple = await request(app).get('/api/driver/wallet/apple').set(bearer(token));
    assert.equal(apple.status, 404);
  });

  it('issues a signed Apple pass whose serial is the driver tag, the same each time', async () => {
    const admin = await adminToken();
    await request(app).put('/api/admin/wallet').set(bearer(admin)).send(APPLE_VALUES);
    const { token, accountId } = await driverToken();

    const first = await request(app).get('/api/driver/wallet/apple').set(bearer(token)).buffer(true).parse(binaryParser);
    assert.equal(first.status, 200);
    assert.match(first.headers['content-type'], /application\/vnd\.apple\.pkpass/);
    const credential = await inSite(() => prisma.walletCredential.findFirst({ where: { accountId, revokedAt: null } }));
    const serial = JSON.parse(readZip(first.body)['pass.json']).serialNumber;
    assert.equal(serial, credential.idTag);
    assert.match(serial, /^[0-9A-F]{12}$/);

    const second = await request(app).get('/api/driver/wallet/apple').set(bearer(token)).buffer(true).parse(binaryParser);
    assert.equal(JSON.parse(readZip(second.body)['pass.json']).serialNumber, serial);
  });

  it('issues a Google Wallet save link signed for this driver tag', async () => {
    const admin = await adminToken();
    await request(app).put('/api/admin/wallet').set(bearer(admin)).send(GOOGLE_VALUES);
    const { token, accountId } = await driverToken();

    const res = await request(app).get('/api/driver/wallet/google').set(bearer(token));
    assert.equal(res.status, 200);
    assert.ok(res.body.url.startsWith('https://pay.google.com/gp/v/save/'));
    const claims = jwt.verify(res.body.url.slice('https://pay.google.com/gp/v/save/'.length), GOOGLE_KEYS.publicKey, {
      algorithms: ['RS256'],
    });
    assert.equal(claims.iss, GOOGLE_EMAIL);
    assert.equal(claims.typ, 'savetowallet');
    const [object] = claims.payload.genericObjects;
    assert.equal(object.classId, '3388000000012345678.charging_pass');
    const credential = await inSite(() => prisma.walletCredential.findFirst({ where: { accountId, revokedAt: null } }));
    assert.equal(object.smartTapRedemptionValue, credential.idTag);
  });
});

describe('pass design', () => {
  const ICON = iconPng(58);
  const ICON_BASE64 = ICON.toString('base64');

  it('accepts a 58 by 58 PNG and blank values, and refuses a bad colour or icon', () => {
    assert.deepEqual(designCheck({ backgroundColor: '#1F7A4F', iconPng: ICON_BASE64 }).invalid, []);
    assert.deepEqual(designCheck({}).invalid, []);
    assert.ok(designCheck({ backgroundColor: 'green' }).invalid.some((m) => m.includes('colour')));
    const small = iconPng(30).toString('base64');
    assert.ok(designCheck({ iconPng: small }).invalid.some((m) => m.includes('58 by 58')));
    assert.ok(designCheck({ iconPng: Buffer.from('not a picture').toString('base64') }).invalid.some((m) => m.includes('PNG')));
  });

  it('puts the chosen colours, labels and icon into the pass', () => {
    const design = { backgroundColor: '#1F7A4F', foregroundColor: '#FFFFFF', labelColor: '#A7F3D0', primaryLabel: 'PLUG IN', primaryValue: 'Charge now', backText: 'Back text here', iconPng: ICON_BASE64 };
    const files = readZip(buildPkpass(APPLE, { serial: 'ABCDEF012345', design }));
    const pass = JSON.parse(files['pass.json']);
    assert.equal(pass.backgroundColor, 'rgb(31, 122, 79)');
    assert.equal(pass.labelColor, 'rgb(167, 243, 208)');
    assert.equal(pass.generic.primaryFields[0].label, 'PLUG IN');
    assert.equal(pass.generic.primaryFields[0].value, 'Charge now');
    assert.equal(pass.generic.backFields[0].value, 'Back text here');
    assert.ok(files['icon.png'].equals(ICON));
    assert.ok(files['icon@2x.png'].equals(ICON));
  });

  it('uses the defaults when no design is saved', () => {
    const pass = JSON.parse(readZip(buildPkpass(APPLE, { serial: 'ABCDEF012345' }))['pass.json']);
    assert.equal(pass.backgroundColor, 'rgb(22, 101, 52)');
    assert.equal(pass.generic.primaryFields[0].label, 'CHARGING PASS');
  });

  describe('saving the design', () => {
    beforeEach(async () => {
      await resetDb();
    });
    after(async () => {
      await resetDb();
    });

    it('refuses a bad colour and saves nothing', async () => {
      const token = await adminToken();
      const res = await request(app).put('/api/admin/wallet').set(bearer(token)).send({ 'wallet.design.backgroundColor': 'purple' });
      assert.equal(res.status, 400);
      const after = await request(app).get('/api/admin/wallet').set(bearer(token));
      assert.equal(after.body.values['wallet.design.backgroundColor'], '#166534');
    });

    it('saves a colour, text and icon, and the driver pass uses them', async () => {
      const token = await adminToken();
      const saved = await request(app).put('/api/admin/wallet').set(bearer(token)).send({
        ...APPLE_VALUES,
        ...GOOGLE_VALUES,
        'wallet.design.backgroundColor': '#1F7A4F',
        'wallet.design.primaryValue': 'Plug in and go',
        'wallet.design.iconPng': ICON_BASE64,
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.values['wallet.design.backgroundColor'], '#1F7A4F');
      assert.equal(saved.body.values['wallet.design.iconPng'], ICON_BASE64);

      const { token: driver } = await driverToken();
      const pkpass = await request(app).get('/api/driver/wallet/apple').set(bearer(driver)).buffer(true).parse(binaryParser);
      const files = readZip(pkpass.body);
      assert.equal(JSON.parse(files['pass.json']).generic.primaryFields[0].value, 'Plug in and go');
      assert.ok(files['icon.png'].equals(ICON));
    });
  });
});

// The pass is binary. Supertest would read it as text unless asked for the raw bytes.
function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}
