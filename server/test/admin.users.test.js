import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';

let admin;
let token;

beforeEach(async () => {
  await resetDb();
  admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

function authed(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

describe('/api/admin/users', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/users');
    assert.equal(res.status, 401);
  });

  it('lists users without exposing password hashes', async () => {
    const res = await authed(request(app).get('/api/admin/users'));
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].email, admin.email);
    assert.equal(res.body[0].passwordHash, undefined);
    assert.equal(res.body[0].hasPassword, true);
  });

  it('creates a user with a password', async () => {
    const res = await authed(request(app).post('/api/admin/users')).send({ email: 'new@example.com', password: 'Password123!' });
    assert.equal(res.status, 201);
    assert.equal(res.body.hasPassword, true);
  });

  it('creates an SSO-only user with no password', async () => {
    const res = await authed(request(app).post('/api/admin/users')).send({ email: 'sso@example.com' });
    assert.equal(res.status, 201);
    assert.equal(res.body.hasPassword, false);

    const login = await request(app).post('/api/auth/login').send({ email: 'sso@example.com', password: 'anything' });
    assert.equal(login.status, 401);
  });

  it('rejects a short password on create', async () => {
    const res = await authed(request(app).post('/api/admin/users')).send({ email: 'short@example.com', password: 'short' });
    assert.equal(res.status, 400);
  });

  it('rejects a duplicate email', async () => {
    const res = await authed(request(app).post('/api/admin/users')).send({ email: admin.email, password: 'Password123!' });
    assert.equal(res.status, 409);
  });

  it('resets a user\'s MFA', async () => {
    const withMfa = await createAdmin({ password: 'Password123!', mfa: true });
    const res = await authed(request(app).patch(`/api/admin/users/${withMfa.id}`)).send({ resetMfa: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaEnabled, false);

    const updated = await prisma.admin.findUnique({ where: { id: withMfa.id } });
    assert.equal(updated.mfaSecret, null);
  });

  it('deletes another user', async () => {
    const other = await createAdmin();
    const res = await authed(request(app).delete(`/api/admin/users/${other.id}`));
    assert.equal(res.status, 204);
    assert.equal(await prisma.admin.findUnique({ where: { id: other.id } }), null);
  });

  it('refuses to delete your own account, even as the only user', async () => {
    const res = await authed(request(app).delete(`/api/admin/users/${admin.id}`));
    assert.equal(res.status, 400);
  });
});
