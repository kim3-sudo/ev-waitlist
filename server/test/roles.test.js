import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';

let adminToken;
let adminId;
let viewerToken;
let viewerId;

async function login(email) {
  const { body } = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return body.token;
}

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin();
  adminId = admin.id;
  adminToken = await login(admin.email);

  const viewer = await prisma.admin.create({
    data: {
      email: 'viewer@example.com',
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: 'VIEWER',
    },
  });
  viewerId = viewer.id;
  viewerToken = await login(viewer.email);
});

const as = (token) => (req) => req.set('Authorization', `Bearer ${token}`);

describe('viewer role', () => {
  it('reports the role on /me and at login', async () => {
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(me.body.role, 'VIEWER');
    const adminMe = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
    assert.equal(adminMe.body.role, 'ADMIN');
  });

  it('can read charge points, zones, and reports', async () => {
    const v = as(viewerToken);
    assert.equal((await v(request(app).get('/api/admin/stations'))).status, 200);
    assert.equal((await v(request(app).get('/api/admin/zones'))).status, 200);
    assert.equal((await v(request(app).get('/api/admin/reports/idle'))).status, 200);
    assert.equal((await v(request(app).get('/api/admin/reports/complaints-summary'))).status, 200);
    assert.equal((await v(request(app).get('/api/admin/complaints'))).status, 200);
  });

  it('cannot change charge points, zones, or complaints', async () => {
    const v = as(viewerToken);
    assert.equal((await v(request(app).post('/api/admin/stations')).send({ identity: 'X', name: 'X' })).status, 403);
    assert.equal((await v(request(app).post('/api/admin/zones')).send({ name: 'Z' })).status, 403);
    assert.equal((await v(request(app).patch('/api/admin/complaints/nope')).send({ status: 'RESOLVED' })).status, 403);
  });

  it('cannot reach users, branding, or SSO administration', async () => {
    const v = as(viewerToken);
    assert.equal((await v(request(app).get('/api/admin/users'))).status, 403);
    assert.equal((await v(request(app).post('/api/admin/users')).send({ email: 'x@example.com' })).status, 403);
    assert.equal((await v(request(app).get('/api/admin/settings'))).status, 403);
    assert.equal((await v(request(app).get('/api/admin/saml'))).status, 403);
  });

  it('still lets a viewer sign out-of-band actions like changing their own password', async () => {
    const res = await as(viewerToken)(request(app).put('/api/auth/password')).send({
      currentPassword: 'Password123!',
      newPassword: 'NewPassword456!',
    });
    assert.equal(res.status, 200);
  });
});

describe('admin role management', () => {
  it('creates users as viewers by default and can create an admin explicitly', async () => {
    const a = as(adminToken);
    const viewer = await a(request(app).post('/api/admin/users')).send({ email: 'new@example.com', password: 'Password123!' });
    assert.equal(viewer.body.role, 'VIEWER');
    const admin = await a(request(app).post('/api/admin/users')).send({
      email: 'other-admin@example.com',
      password: 'Password123!',
      role: 'ADMIN',
    });
    assert.equal(admin.body.role, 'ADMIN');
  });

  it('rejects an unknown role', async () => {
    const res = await as(adminToken)(request(app).post('/api/admin/users')).send({ email: 'a@example.com', role: 'ROOT' });
    assert.equal(res.status, 400);
  });

  it('promotes a viewer to admin, and the change takes effect immediately', async () => {
    const res = await as(adminToken)(request(app).patch(`/api/admin/users/${viewerId}`)).send({ role: 'ADMIN' });
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'ADMIN');
    assert.equal((await as(viewerToken)(request(app).get('/api/admin/users'))).status, 200);
  });

  it("refuses to change your own role", async () => {
    const res = await as(adminToken)(request(app).patch(`/api/admin/users/${adminId}`)).send({ role: 'VIEWER' });
    assert.equal(res.status, 400);
  });

  it("demotes another admin while at least one other admin remains", async () => {
    await prisma.admin.update({ where: { id: viewerId }, data: { role: 'ADMIN' } });
    const token = await login('viewer@example.com');
    const res = await as(token)(request(app).patch(`/api/admin/users/${adminId}`)).send({ role: 'VIEWER' });
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'VIEWER');
  });
});

describe('complaints summary', () => {
  it('counts complaints per station and averages time to resolve', async () => {
    const station = await prisma.station.create({ data: { identity: 'SUM-1', name: 'Bay Sum' } });
    const entry = await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Dana', contact: 'd@example.com', idTag: 'T', position: 1 },
    });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const hourAgo = new Date(Date.now() - 3_600_000);
    await prisma.lineCuttingComplaint.create({
      data: { stationId: station.id, queueEntryId: entry.id, status: 'RESOLVED', createdAt: twoHoursAgo, resolvedAt: hourAgo },
    });
    await prisma.lineCuttingComplaint.create({
      data: { stationId: station.id, queueEntryId: entry.id, status: 'OPEN', createdAt: hourAgo },
    });

    const res = await as(adminToken)(request(app).get('/api/admin/reports/complaints-summary'));
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.total, 2);
    assert.equal(res.body.totals.open, 1);
    assert.equal(res.body.totals.resolved, 1);
    assert.equal(res.body.totals.averageHoursToResolve, 1);
    assert.equal(res.body.rows.length, 1);
    assert.equal(res.body.rows[0].station.name, 'Bay Sum');
    assert.equal(res.body.rows[0].averageHoursToResolve, 1);
    assert.ok(res.body.rows[0].oldestOpenHours >= 0.9);
  });
});
