import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { buildSignedSamlResponse, idpCertPem } from '../src/simulator/samlIdp.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

async function configureSaml({ autoProvision = false } = {}) {
  await request(app)
    .put('/api/admin/saml')
    .set('Authorization', `Bearer ${token}`)
    .send({
      enabled: true,
      idpEntityId: 'https://ev-waitlist-test-idp.local/metadata',
      idpSsoUrl: 'http://localhost:7000/sso',
      idpCertificate: idpCertPem,
      autoProvision,
    });
}

describe('SAML SP, before configuration', () => {
  it('metadata, login, and status are unavailable', async () => {
    assert.equal((await request(app).get('/api/auth/saml/metadata')).status, 404);
    assert.equal((await request(app).get('/api/auth/saml/login')).status, 404);
    assert.equal((await request(app).get('/api/auth/saml/status')).status, 200);
    assert.equal((await request(app).get('/api/auth/saml/status')).body.enabled, false);
  });

  it('rejects an ACS POST even with a validly signed assertion', async () => {
    const samlResponse = buildSignedSamlResponse({ email: 'someone@example.com' });
    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });
    assert.equal(res.status, 404);
  });
});

describe('SAML SP, once configured', () => {
  it('serves SP metadata XML', async () => {
    await configureSaml();
    const res = await request(app).get('/api/auth/saml/metadata');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /xml/);
    assert.match(res.text, /EntityDescriptor/);
  });

  it('reports SAML as enabled on the status endpoint', async () => {
    await configureSaml();
    const res = await request(app).get('/api/auth/saml/status');
    assert.equal(res.body.enabled, true);
  });

  it('redirects to the configured IdP SSO URL on /login', async () => {
    await configureSaml();
    const res = await request(app).get('/api/auth/saml/login');
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^http:\/\/localhost:7000\/sso\?/);
  });

  it('logs an existing account in via a validly signed assertion', async () => {
    await configureSaml();
    const existing = await createAdmin({ password: null, email: 'sso-user@example.com' });

    const samlResponse = buildSignedSamlResponse({ email: existing.email });
    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });

    assert.equal(res.status, 302);
    const redirect = new URL(res.headers.location);
    assert.equal(redirect.origin + redirect.pathname, `${config.corsOrigin}/sso/callback`);
    assert.equal(redirect.searchParams.get('email'), existing.email);
    assert.ok(redirect.searchParams.get('token'));
  });

  it('auto-provisions a new SSO-only account when autoProvision is on', async () => {
    await configureSaml({ autoProvision: true });
    const samlResponse = buildSignedSamlResponse({ email: 'brand-new@example.com' });

    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });
    assert.equal(res.status, 302);

    const created = await prisma.admin.findUnique({ where: { email: 'brand-new@example.com' } });
    assert.ok(created);
    assert.equal(created.passwordHash, null);
  });

  it('rejects an unmatched email when autoProvision is off', async () => {
    await configureSaml({ autoProvision: false });
    const samlResponse = buildSignedSamlResponse({ email: 'nope@example.com' });

    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });
    assert.equal(res.status, 401);
    assert.equal(await prisma.admin.findUnique({ where: { email: 'nope@example.com' } }), null);
  });

  it('rejects an unsigned assertion', async () => {
    await configureSaml();
    const samlResponse = buildSignedSamlResponse({ email: 'someone@example.com', signed: false });

    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });
    assert.equal(res.status, 401);
  });

  it('rejects a tampered assertion (signature no longer matches)', async () => {
    await configureSaml();
    const samlResponse = buildSignedSamlResponse({ email: 'someone@example.com' });
    const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
    const tampered = xml.replace('someone@example.com', 'attacker@example.com');
    const tamperedResponse = Buffer.from(tampered, 'utf8').toString('base64');

    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: tamperedResponse });
    assert.equal(res.status, 401);
  });

  it('rejects an assertion signed for a different audience', async () => {
    await configureSaml();
    const samlResponse = buildSignedSamlResponse({
      email: 'someone@example.com',
      spEntityId: 'https://a-completely-different-sp.example.com/metadata',
    });

    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });
    assert.equal(res.status, 401);
  });

  it('rejects an assertion signed by a key the SP was never told to trust', async () => {
    await configureSaml();
    const { privateKey: untrustedKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const samlResponse = buildSignedSamlResponse({ email: 'someone@example.com', signingKeyPem: untrustedKey });

    const res = await request(app).post('/api/auth/saml/acs').type('form').send({ SAMLResponse: samlResponse });
    assert.equal(res.status, 401);
  });
});
