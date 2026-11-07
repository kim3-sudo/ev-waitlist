import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { rawPrisma, prisma } from '../src/db.js';
import { hashToken } from '../src/ocpi/tokens.js';

const PASSWORD = 'Password123!';

async function tokenFor(admin) {
  const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

// An admin whose role holds exactly `permissions`, via a custom role.
async function adminWithPermissions(permissions) {
  const roleName = `Role ${Math.random().toString(36).slice(2, 8)}`;
  await prisma.customRole.create({ data: { name: roleName, permissions: JSON.stringify(permissions) } });
  const admin = await createAdmin({ password: PASSWORD });
  await prisma.admin.update({ where: { id: admin.id }, data: { role: roleName } });
  return tokenFor(admin);
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

let adminToken;

beforeEach(async () => {
  await resetDb();
  adminToken = await tokenFor(await createAdmin({ password: PASSWORD }));
});

async function createAccount(name = 'Billing sync', permissions = ['api.stations.read']) {
  const res = await request(app)
    .post('/api/admin/service-accounts')
    .set(bearer(adminToken))
    .send({ name, description: 'Test account', permissions });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe('service accounts (admin)', () => {
  it('requires a signed-in admin', async () => {
    assert.equal((await request(app).get('/api/admin/service-accounts')).status, 401);
  });

  it('creates an account that holds only API permissions', async () => {
    const account = await createAccount();
    assert.equal(account.name, 'Billing sync');
    assert.deepEqual(account.permissions, ['api.stations.read']);
    assert.equal(account.disabled, false);
    assert.deepEqual(account.keys, []);

    const refused = await request(app)
      .post('/api/admin/service-accounts')
      .set(bearer(adminToken))
      .send({ name: 'Sneaky', permissions: ['stations.manage'] });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /not an API permission/);
  });

  it('refuses a duplicate name and an invalid name', async () => {
    await createAccount('Dup');
    const dup = await request(app).post('/api/admin/service-accounts').set(bearer(adminToken)).send({ name: 'Dup', permissions: [] });
    assert.equal(dup.status, 409);
    const bad = await request(app).post('/api/admin/service-accounts').set(bearer(adminToken)).send({ name: '  ', permissions: [] });
    assert.equal(bad.status, 400);
  });

  it('shows a key once, stores only its hash, and the key works', async () => {
    const account = await createAccount();
    const issued = await request(app)
      .post(`/api/admin/service-accounts/${account.id}/keys`)
      .set(bearer(adminToken))
      .send({ name: 'Production' });
    assert.equal(issued.status, 201);
    const { plainKey, key } = issued.body;
    assert.match(plainKey, /^pgk_[0-9a-f]{8}_/);
    assert.equal(key.prefix, plainKey.slice(4, 12));
    assert.equal(key.status, 'ACTIVE');

    // Later reads never show the key again.
    const listed = await request(app).get('/api/admin/service-accounts').set(bearer(adminToken));
    assert.equal(listed.status, 200);
    assert.ok(!JSON.stringify(listed.body).includes(plainKey));

    // Only the hash is in the database.
    const row = await rawPrisma.apiKey.findUnique({ where: { id: key.id } });
    assert.equal(row.keyHash, hashToken(plainKey));
    assert.ok(!JSON.stringify(row).includes(plainKey));

    const me = await request(app).get('/api/v1/me').set(bearer(plainKey));
    assert.equal(me.status, 200);
    assert.equal(me.body.serviceAccount.name, 'Billing sync');
  });

  it('revokes a key, after which it is refused', async () => {
    const account = await createAccount();
    const { body } = await request(app)
      .post(`/api/admin/service-accounts/${account.id}/keys`)
      .set(bearer(adminToken))
      .send({ name: 'Old' });
    const revoked = await request(app)
      .delete(`/api/admin/service-accounts/${account.id}/keys/${body.key.id}`)
      .set(bearer(adminToken));
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.keys[0].status, 'REVOKED');
    assert.equal((await request(app).get('/api/v1/me').set(bearer(body.plainKey))).status, 401);
  });

  it('refuses a key that expires in the past', async () => {
    const account = await createAccount();
    const res = await request(app)
      .post(`/api/admin/service-accounts/${account.id}/keys`)
      .set(bearer(adminToken))
      .send({ name: 'Expired', expiresAt: '2001-01-01T00:00:00Z' });
    assert.equal(res.status, 400);
  });

  it('disabling an account stops its keys; deleting it removes them', async () => {
    const account = await createAccount();
    const { body } = await request(app)
      .post(`/api/admin/service-accounts/${account.id}/keys`)
      .set(bearer(adminToken))
      .send({ name: 'Main' });

    const disabled = await request(app)
      .put(`/api/admin/service-accounts/${account.id}`)
      .set(bearer(adminToken))
      .send({ disabled: true });
    assert.equal(disabled.status, 200);
    assert.equal((await request(app).get('/api/v1/me').set(bearer(body.plainKey))).status, 401);

    const deleted = await request(app).delete(`/api/admin/service-accounts/${account.id}`).set(bearer(adminToken));
    assert.equal(deleted.status, 204);
    assert.equal(await rawPrisma.apiKey.count({ where: { serviceAccountId: account.id } }), 0);
  });

  it('a person cannot grant an account a permission they do not hold', async () => {
    const token = await adminWithPermissions(['serviceAccounts.view', 'serviceAccounts.manage', 'api.stations.read']);
    const res = await request(app)
      .post('/api/admin/service-accounts')
      .set(bearer(token))
      .send({ name: 'Too much', permissions: ['api.stations.read', 'api.stations.write'] });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body.missing, ['api.stations.write']);

    const account = await createAccount('Reader', ['api.stations.read']);
    const widen = await request(app)
      .put(`/api/admin/service-accounts/${account.id}`)
      .set(bearer(token))
      .send({ permissions: ['api.stations.read', 'api.zones.write'] });
    assert.equal(widen.status, 403);
    assert.deepEqual(widen.body.missing, ['api.zones.write']);

    // Narrowing is always allowed.
    const narrow = await request(app)
      .put(`/api/admin/service-accounts/${account.id}`)
      .set(bearer(token))
      .send({ permissions: [] });
    assert.equal(narrow.status, 200);
  });

  it('a viewer can read nothing about service accounts and change nothing', async () => {
    const account = await createAccount();
    const viewerToken = await adminWithPermissions(['stations.view']);
    assert.equal((await request(app).get('/api/admin/service-accounts').set(bearer(viewerToken))).status, 403);
    assert.equal(
      (await request(app).post('/api/admin/service-accounts').set(bearer(viewerToken)).send({ name: 'X', permissions: [] })).status,
      403,
    );
    assert.equal(
      (await request(app).post(`/api/admin/service-accounts/${account.id}/keys`).set(bearer(viewerToken)).send({ name: 'K' })).status,
      403,
    );
  });

  it('a read-only account view can list but not change', async () => {
    const account = await createAccount();
    const token = await adminWithPermissions(['serviceAccounts.view']);
    assert.equal((await request(app).get('/api/admin/service-accounts').set(bearer(token))).status, 200);
    assert.equal(
      (await request(app).put(`/api/admin/service-accounts/${account.id}`).set(bearer(token)).send({ disabled: true })).status,
      403,
    );
  });
});

describe('API developer role', () => {
  it('manages service accounts and grants API permissions, but changes nothing else', async () => {
    const admin = await createAdmin({ password: PASSWORD });
    await prisma.admin.update({ where: { id: admin.id }, data: { role: 'API_DEVELOPER' } });
    const token = await tokenFor(admin);

    const created = await request(app)
      .post('/api/admin/service-accounts')
      .set(bearer(token))
      .send({ name: 'Dev account', permissions: ['api.stations.write', 'api.priceRules.write'] });
    assert.equal(created.status, 201);

    assert.equal((await request(app).get('/api/admin/stations').set(bearer(token))).status, 200);
    assert.equal((await request(app).get('/api/admin/payments/settings').set(bearer(token))).status, 200);
    assert.equal(
      (await request(app).post('/api/admin/stations').set(bearer(token)).send({ identity: 'CP-X', name: 'X' })).status,
      403,
    );
    assert.equal((await request(app).put('/api/admin/settings').set(bearer(token)).send({})).status, 403);
  });
});
