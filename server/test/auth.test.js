import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin, totpCode } from './support/factories.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { updateSettings } from '../src/services/settingsService.js';

beforeEach(resetDb);

// A valid session token for an SSO-only account, which (by design) can never
// get one through /login -- needed to test that /password rejects it anyway.
function signSessionToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email }, config.jwtSecret, { expiresIn: '12h' });
}

describe('POST /api/auth/login', () => {
  it('rejects missing credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@example.com' });
    assert.equal(res.status, 400);
  });

  it('rejects an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'x' });
    assert.equal(res.status, 401);
  });

  it('rejects a wrong password', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'wrong' });
    assert.equal(res.status, 401);
  });

  it('rejects password login for an SSO-only account', async () => {
    const admin = await createAdmin({ password: null });
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'anything' });
    assert.equal(res.status, 401);
  });

  it('logs in directly when MFA is not enabled or required', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
    assert.equal(res.status, 200);
    assert.equal(res.body.email, admin.email);
    assert.ok(res.body.token);
  });

  it('returns a pre-auth token requiring an MFA code when MFA is enabled', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!', mfa: true });
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaRequired, true);
    assert.ok(res.body.preAuthToken);
    assert.equal(res.body.token, undefined);
  });

  it('forces MFA setup on login when org-wide mfaRequired is on and the account has no MFA yet', async () => {
    await updateSettings({ mfaRequired: true });
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaSetupRequired, true);
    assert.ok(res.body.preAuthToken);
  });
});

describe('MFA verify + setup', () => {
  it('completes login with a valid TOTP code', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!', mfa: true });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });

    const res = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ preAuthToken: loginBody.preAuthToken, code: totpCode(admin.mfaSecret) });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  it('rejects an invalid TOTP code', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!', mfa: true });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });

    const res = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ preAuthToken: loginBody.preAuthToken, code: '000000' });
    assert.equal(res.status, 401);
  });

  it('rejects a normal session token used as a pre-auth token', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });

    const res = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ preAuthToken: loginBody.token, code: '000000' });
    assert.equal(res.status, 401);
  });

  it('self-service: an authenticated admin can enroll MFA end to end', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });
    const token = loginBody.token;

    const start = await request(app)
      .post('/api/auth/mfa/setup/start')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(start.status, 200);
    assert.ok(start.body.secret);
    assert.match(start.body.qrCode, /^data:image\/png;base64,/);

    const confirm = await request(app)
      .post('/api/auth/mfa/setup/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: start.body.secret, code: totpCode(start.body.secret) });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.ok, true);
    assert.equal(confirm.body.token, undefined);

    const updated = await prisma.admin.findUnique({ where: { id: admin.id } });
    assert.equal(updated.mfaEnabled, true);
  });

  it('forced enrollment: setup/confirm with only a preAuthToken also completes login', async () => {
    await updateSettings({ mfaRequired: true });
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });
    assert.equal(loginBody.mfaSetupRequired, true);

    const start = await request(app)
      .post('/api/auth/mfa/setup/start')
      .send({ preAuthToken: loginBody.preAuthToken });
    assert.equal(start.status, 200);

    const confirm = await request(app)
      .post('/api/auth/mfa/setup/confirm')
      .send({ preAuthToken: loginBody.preAuthToken, secret: start.body.secret, code: totpCode(start.body.secret) });
    assert.equal(confirm.status, 200);
    assert.ok(confirm.body.token);
  });

  it('rejects setup/confirm with a bad code', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });

    const start = await request(app)
      .post('/api/auth/mfa/setup/start')
      .set('Authorization', `Bearer ${loginBody.token}`)
      .send({});

    const confirm = await request(app)
      .post('/api/auth/mfa/setup/confirm')
      .set('Authorization', `Bearer ${loginBody.token}`)
      .send({ secret: start.body.secret, code: '000000' });
    assert.equal(confirm.status, 400);
  });

  it('disables MFA when given the correct password', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!', mfa: true });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });
    const { body: verifyBody } = await request(app)
      .post('/api/auth/mfa/verify')
      .send({ preAuthToken: loginBody.preAuthToken, code: totpCode(admin.mfaSecret) });

    const res = await request(app)
      .post('/api/auth/mfa/disable')
      .set('Authorization', `Bearer ${verifyBody.token}`)
      .send({ password: 'CorrectHorse1!' });
    assert.equal(res.status, 200);

    const updated = await prisma.admin.findUnique({ where: { id: admin.id } });
    assert.equal(updated.mfaEnabled, false);
    assert.equal(updated.mfaSecret, null);
  });
});

describe('PUT /api/auth/password', () => {
  it('changes the password and the new one works on next login', async () => {
    const admin = await createAdmin({ password: 'OldPassword1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'OldPassword1!' });

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${loginBody.token}`)
      .send({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword1!' });
    assert.equal(res.status, 200);

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'NewPassword1!' });
    assert.equal(relogin.status, 200);

    const oldStillWorks = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'OldPassword1!' });
    assert.equal(oldStillWorks.status, 401);
  });

  it('rejects a wrong current password', async () => {
    const admin = await createAdmin({ password: 'OldPassword1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'OldPassword1!' });

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${loginBody.token}`)
      .send({ currentPassword: 'wrong', newPassword: 'NewPassword1!' });
    assert.equal(res.status, 401);
  });

  it('rejects a change for an SSO-only account', async () => {
    const admin = await createAdmin({ password: null });
    const token = signSessionToken(admin);

    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'anything', newPassword: 'NewPassword1!' });
    assert.equal(res.status, 400);
  });
});

describe('GET /api/auth/me', () => {
  it('reports hasPassword and mfaEnabled', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body: loginBody } = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'CorrectHorse1!' });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loginBody.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, admin.email);
    assert.equal(res.body.hasPassword, true);
    assert.equal(res.body.mfaEnabled, false);
  });

  it('rejects with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });
});

