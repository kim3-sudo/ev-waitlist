import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { idpCertPem } from '../src/simulator/samlIdp.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

describe('/api/admin/saml', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/saml');
    assert.equal(res.status, 401);
  });

  it('returns a disabled config with SP metadata by default', async () => {
    const res = await request(app).get('/api/admin/saml').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
    assert.ok(res.body.sp.entityId);
    assert.ok(res.body.sp.acsUrl);
  });

  it('saves IdP configuration', async () => {
    const res = await request(app)
      .put('/api/admin/saml')
      .set('Authorization', `Bearer ${token}`)
      .send({
        enabled: true,
        idpEntityId: 'https://idp.example.com/metadata',
        idpSsoUrl: 'https://idp.example.com/sso',
        idpCertificate: idpCertPem,
        autoProvision: true,
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.autoProvision, true);

    const reread = await request(app).get('/api/admin/saml').set('Authorization', `Bearer ${token}`);
    assert.equal(reread.body.idpSsoUrl, 'https://idp.example.com/sso');
  });
});

describe('GET /api/auth/saml/status', () => {
  it('is false until SAML is enabled and configured', async () => {
    const res = await request(app).get('/api/auth/saml/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
  });
});
