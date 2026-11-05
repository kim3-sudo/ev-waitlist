import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';

async function login(email, password = 'Password123!') {
  const { body } = await request(app).post('/api/auth/login').send({ email, password });
  return body.token;
}
const as = (token) => (req) => req.set('Authorization', `Bearer ${token}`);

let adminToken;
let adminEmail;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ email: 'boss@example.com' });
  adminEmail = admin.email;
  adminToken = await login(adminEmail);
});

async function makeUser(email, role) {
  const user = await createAdmin({ email });
  await prisma.admin.update({ where: { id: user.id }, data: { role } });
  return login(email);
}

describe('custom roles', () => {
  it('an admin creates an electrician role and assigns it', async () => {
    const created = await as(adminToken)(request(app).post('/api/admin/roles')).send({
      name: 'Electrician',
      description: 'Can add and edit charge points',
      permissions: ['stations.view', 'stations.manage'],
    });
    assert.equal(created.status, 201);

    const user = await as(adminToken)(request(app).post('/api/admin/users')).send({
      email: 'sparky@example.com',
      password: 'Password123!',
      role: 'Electrician',
    });
    assert.equal(user.status, 201);
    assert.equal(user.body.role, 'Electrician');

    const token = await login('sparky@example.com');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.deepEqual(me.body.permissions.sort(), ['stations.manage', 'stations.view']);
    // Can add charge points, but not change zones, users, or payments.
    assert.equal((await as(token)(request(app).get('/api/admin/stations'))).status, 200);
    assert.equal((await as(token)(request(app).post('/api/admin/stations')).send({ identity: 'X', name: 'X' })).status, 201);
    assert.equal((await as(token)(request(app).post('/api/admin/zones')).send({ name: 'Z' })).status, 403);
    assert.equal((await as(token)(request(app).get('/api/admin/users'))).status, 403);
    assert.equal((await as(token)(request(app).get('/api/admin/payments/settings'))).status, 403);
  });

  it('a read-only custom role can view but not change', async () => {
    await as(adminToken)(request(app).post('/api/admin/roles')).send({
      name: 'Read only',
      permissions: ['stations.view', 'zones.view', 'reports.view'],
    });
    const token = await makeUser('ro@example.com', 'Read only');
    assert.equal((await as(token)(request(app).get('/api/admin/zones'))).status, 200);
    assert.equal((await as(token)(request(app).get('/api/admin/reports/idle'))).status, 200);
    assert.equal((await as(token)(request(app).post('/api/admin/zones')).send({ name: 'Z' })).status, 403);
  });

  it('a manager cannot grant permissions they do not hold', async () => {
    await as(adminToken)(request(app).post('/api/admin/roles')).send({ name: 'Manager', permissions: ['users.manage', 'stations.view'] });
    const managerToken = await makeUser('mgr@example.com', 'Manager');

    const escalate = await as(managerToken)(request(app).post('/api/admin/roles')).send({
      name: 'Super',
      permissions: ['payments.manage'],
    });
    assert.equal(escalate.status, 403);

    const assign = await as(managerToken)(request(app).post('/api/admin/users')).send({ email: 'x@example.com', role: 'ADMIN' });
    assert.equal(assign.status, 403);
  });

  it('a manager cannot act on an admin account', async () => {
    await as(adminToken)(request(app).post('/api/admin/roles')).send({ name: 'Manager', permissions: ['users.manage'] });
    const managerToken = await makeUser('mgr2@example.com', 'Manager');
    const boss = await prisma.admin.findUnique({ where: { email: adminEmail } });
    const res = await as(managerToken)(request(app).patch(`/api/admin/users/${boss.id}`)).send({ resetMfa: true });
    assert.equal(res.status, 403);
  });

  it('refuses unknown permissions and built-in role names', async () => {
    const unknown = await as(adminToken)(request(app).post('/api/admin/roles')).send({ name: 'Bad', permissions: ['root.everything'] });
    assert.equal(unknown.status, 400);
    const builtIn = await as(adminToken)(request(app).post('/api/admin/roles')).send({ name: 'ADMIN', permissions: [] });
    assert.equal(builtIn.status, 400);
  });

  it('will not delete a role that users still hold', async () => {
    await as(adminToken)(request(app).post('/api/admin/roles')).send({ name: 'Temp', permissions: ['reports.view'] });
    await makeUser('temp@example.com', 'Temp');
    const res = await as(adminToken)(request(app).delete('/api/admin/roles/Temp'));
    assert.equal(res.status, 400);
  });

  it('keeps at least one user manager in place', async () => {
    const boss = await prisma.admin.findUnique({ where: { email: adminEmail } });
    // Only the admin manages users; demoting them via a custom role is blocked.
    await as(adminToken)(request(app).post('/api/admin/roles')).send({ name: 'Plain', permissions: ['reports.view'] });
    const res = await as(adminToken)(request(app).patch(`/api/admin/users/${boss.id}`)).send({ role: 'Plain' });
    assert.equal(res.status, 400);
  });

  it('built-in roles cannot be edited', async () => {
    const res = await as(adminToken)(request(app).patch('/api/admin/roles/ADMIN')).send({ permissions: [] });
    assert.equal(res.status, 404);
  });
});
