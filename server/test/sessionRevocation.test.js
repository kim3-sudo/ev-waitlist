import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { config } from '../src/config.js';
import { DRIVER_ROLE } from '../src/auth/permissions.js';
import { signSessionToken } from '../src/auth/sessionToken.js';

const PASSWORD = 'CorrectHorse1!';
beforeEach(resetDb);

async function signIn(email, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}
const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

describe('session token checks', () => {
  it('carries the account version and accepts the current one', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const token = await signIn(admin.email);
    assert.equal(jwt.decode(token).sv, 0);
    assert.equal((await me(token)).status, 200);
  });

  it('refuses a token made with an old version', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const token = await signIn(admin.email);
    await rawPrisma.admin.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal((await me(token)).status, 401);
  });

  it('refuses tokens signed with another algorithm, or with none', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const claims = { sub: admin.id, email: admin.email, tenantId: admin.tenantId, sv: 0 };
    const hs512 = jwt.sign(claims, config.jwtSecret, { algorithm: 'HS512', expiresIn: '1h' });
    assert.equal((await me(hs512)).status, 401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    assert.equal((await me(none)).status, 401);
    assert.equal((await me(signSessionToken(admin))).status, 200);
  });

  it('still accepts a token from before versions existed, until the first revocation', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const old = jwt.sign({ sub: admin.id, email: admin.email, tenantId: admin.tenantId }, config.jwtSecret, { expiresIn: '1h' });
    assert.equal((await me(old)).status, 200);
    await rawPrisma.admin.update({ where: { id: admin.id }, data: { sessionVersion: 1 } });
    assert.equal((await me(old)).status, 401);
  });
});

describe('revoking sessions', () => {
  it('"sign out everywhere" ends every token, including the one used', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const laptop = await signIn(admin.email);
    const phone = await signIn(admin.email);
    const res = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${laptop}`);
    assert.equal(res.status, 200);
    assert.equal((await me(laptop)).status, 401);
    assert.equal((await me(phone)).status, 401);
    // Signing in again works.
    assert.equal((await me(await signIn(admin.email))).status, 200);
  });

  it('needs a valid session', async () => {
    assert.equal((await request(app).post('/api/auth/logout-all')).status, 401);
  });

  it('changing the password ends other sessions and returns a fresh token for this one', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const stolen = await signIn(admin.email);
    const mine = await signIn(admin.email);
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${mine}`)
      .send({ currentPassword: PASSWORD, newPassword: 'AnotherHorse2!' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal((await me(stolen)).status, 401);
    assert.equal((await me(mine)).status, 401);
    assert.equal((await me(res.body.token)).status, 200);
  });

  it('turning off two-factor ends other sessions', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    await rawPrisma.admin.update({ where: { id: admin.id }, data: { mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' } });
    const mine = signSessionToken(await rawPrisma.admin.findUnique({ where: { id: admin.id } }));
    const other = signSessionToken(await rawPrisma.admin.findUnique({ where: { id: admin.id } }));
    const res = await request(app).post('/api/auth/mfa/disable').set('Authorization', `Bearer ${mine}`).send({ password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal((await me(other)).status, 401);
    assert.equal((await me(res.body.token)).status, 200);
  });

  it('a driver changing their password ends their other sessions too', async () => {
    const driver = await prisma.admin.create({
      data: { email: 'dana@example.test', role: DRIVER_ROLE, passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
    const other = signSessionToken(driver, '30d');
    const mine = signSessionToken(driver, '30d');
    const driverMe = (token) => request(app).get('/api/driver/me').set('Authorization', `Bearer ${token}`);
    assert.equal((await driverMe(other)).status, 200);

    const res = await request(app).put('/api/driver/password').set('Authorization', `Bearer ${mine}`).send({ currentPassword: PASSWORD, newPassword: 'ABrandNew1!' });
    assert.equal(res.status, 200);
    assert.equal((await driverMe(other)).status, 401);
    assert.equal((await driverMe(res.body.token)).status, 200);
  });
});

describe('an administrator revoking a user\'s sessions', () => {
  it('signs the user out and leaves the administrator signed in', async () => {
    const boss = await createAdmin({ password: PASSWORD });
    const bossToken = await signIn(boss.email);
    const user = await createAdmin({ password: PASSWORD });
    const userToken = await signIn(user.email);

    const res = await request(app).post(`/api/admin/users/${user.id}/revoke-sessions`).set('Authorization', `Bearer ${bossToken}`);
    assert.equal(res.status, 200);
    assert.equal((await me(userToken)).status, 401);
    assert.equal((await me(bossToken)).status, 200);
  });

  it('needs the user-management permission', async () => {
    const viewer = await createAdmin({ password: PASSWORD });
    await rawPrisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
    const target = await createAdmin({ password: PASSWORD });
    const res = await request(app).post(`/api/admin/users/${target.id}/revoke-sessions`).set('Authorization', `Bearer ${await signIn(viewer.email)}`);
    assert.equal(res.status, 403);
  });

  it('answers 404 for an unknown user', async () => {
    const boss = await createAdmin({ password: PASSWORD });
    const res = await request(app).post('/api/admin/users/nope/revoke-sessions').set('Authorization', `Bearer ${await signIn(boss.email)}`);
    assert.equal(res.status, 404);
  });

  it('resetting a user\'s two-factor also signs them out', async () => {
    const boss = await createAdmin({ password: PASSWORD });
    const bossToken = await signIn(boss.email);
    const user = await createAdmin({ password: PASSWORD });
    const userToken = await signIn(user.email);
    const res = await request(app).patch(`/api/admin/users/${user.id}`).set('Authorization', `Bearer ${bossToken}`).send({ resetMfa: true });
    assert.equal(res.status, 200);
    assert.equal((await me(userToken)).status, 401);
  });
});
