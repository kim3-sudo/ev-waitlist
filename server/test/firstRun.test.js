import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { ensureFirstRunAdmin } from '../src/services/firstRunService.js';
import { generateEmail, generatePassphrase } from '../src/utils/passphrase.js';

beforeEach(resetDb);

async function login(email, password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

describe('first-run admin', () => {
  it('creates one random admin with a forced passphrase change on an empty database', async () => {
    const creds = await ensureFirstRunAdmin();
    assert.match(creds.email, /^admin-[a-z0-9]{8}@plugyard\.local$/);
    assert.equal(creds.password.split('-').length, 6);

    const admin = await prisma.admin.findUnique({ where: { email: creds.email } });
    assert.equal(admin.mustChangePassword, true);
  });

  it('does nothing when an admin already exists', async () => {
    await createAdmin({ email: 'existing@example.com' });
    assert.equal(await ensureFirstRunAdmin(), null);
    assert.equal(await prisma.admin.count(), 1);
  });

  it('generates different credentials each time', () => {
    assert.notEqual(generateEmail(), generateEmail());
    assert.notEqual(generatePassphrase(), generatePassphrase());
  });
});

describe('forced passphrase change', () => {
  it('returns mustChangePassword at login and blocks admin endpoints', async () => {
    const creds = await ensureFirstRunAdmin();
    const { body, status } = await login(creds.email, creds.password);
    assert.equal(status, 200);
    assert.equal(body.mustChangePassword, true);

    const blocked = await request(app)
      .get('/api/admin/stations')
      .set('Authorization', `Bearer ${body.token}`);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.mustChangePassword, true);
  });

  it('allows changing the passphrase, then unlocks admin endpoints', async () => {
    const creds = await ensureFirstRunAdmin();
    const { body } = await login(creds.email, creds.password);
    const headers = { Authorization: `Bearer ${body.token}` };

    const sameAsCurrent = await request(app)
      .put('/api/auth/password')
      .set(headers)
      .send({ currentPassword: creds.password, newPassword: creds.password });
    assert.equal(sameAsCurrent.status, 400);

    const changed = await request(app)
      .put('/api/auth/password')
      .set(headers)
      .send({ currentPassword: creds.password, newPassword: 'Brand-New-Passphrase-42' });
    assert.equal(changed.status, 200);

    // The change ends the old token (it could be a stolen one) and returns a fresh one.
    assert.ok(changed.body.token);
    const oldToken = await request(app).get('/api/admin/stations').set(headers);
    assert.equal(oldToken.status, 401);
    const unlocked = await request(app).get('/api/admin/stations').set({ Authorization: `Bearer ${changed.body.token}` });
    assert.equal(unlocked.status, 200);

    const relogin = await login(creds.email, 'Brand-New-Passphrase-42');
    assert.equal(relogin.body.mustChangePassword, false);
  });

  it('does not force the change on ordinary accounts', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body } = await login(admin.email, 'CorrectHorse1!');
    assert.equal(body.mustChangePassword, false);
    const res = await request(app).get('/api/admin/stations').set('Authorization', `Bearer ${body.token}`);
    assert.equal(res.status, 200);
  });
});

describe('POST /api/admin/setup/complete', () => {
  it('marks first-run setup as completed', async () => {
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    const { body } = await login(admin.email, 'CorrectHorse1!');
    const headers = { Authorization: `Bearer ${body.token}` };

    const before = await request(app).get('/api/settings');
    assert.equal(before.body.setupCompleted, false);

    const res = await request(app).post('/api/admin/setup/complete').set(headers);
    assert.equal(res.status, 200);

    const after = await request(app).get('/api/settings');
    assert.equal(after.body.setupCompleted, true);
  });
});
