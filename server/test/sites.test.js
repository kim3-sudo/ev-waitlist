import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant } from '../src/tenancy/context.js';

const PASSWORD = 'Password123!';

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, 'login');
  return res.body.token;
}

let instanceAdmin;
let siteAdmin;
let instanceToken;
let siteToken;

beforeEach(async () => {
  await resetDb();
  instanceAdmin = await createAdmin({ password: PASSWORD });
  await rawPrisma.admin.update({ where: { id: instanceAdmin.id }, data: { instanceAdmin: true } });
  siteAdmin = await createAdmin({ password: PASSWORD });
  instanceToken = await login(instanceAdmin.email);
  siteToken = await login(siteAdmin.email);
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('sites', () => {
  it('only the installation administrator can list or create sites', async () => {
    assert.equal((await request(app).get('/api/admin/sites').set(bearer(siteToken))).status, 403);
    assert.equal((await request(app).get('/api/admin/sites').set(bearer(instanceToken))).status, 200);
    const denied = await request(app)
      .post('/api/admin/sites')
      .set(bearer(siteToken))
      .send({ name: 'Garage', slug: 'garage' });
    assert.equal(denied.status, 403);
  });

  it('creates a site, and refuses a bad, reserved or taken address', async () => {
    const created = await request(app)
      .post('/api/admin/sites')
      .set(bearer(instanceToken))
      .send({ name: 'Garage', slug: 'garage' });
    assert.equal(created.status, 201);
    assert.equal(created.body.slug, 'garage');

    assert.equal((await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'X', slug: 'Bad Slug!' })).status, 400);
    assert.equal((await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'X', slug: 'default' })).status, 400);
    assert.equal((await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'X', slug: 'garage' })).status, 409);
  });

  it('adds an administrator to a site, who can sign in to that site', async () => {
    const garage = await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'Garage', slug: 'garage' });
    const res = await request(app)
      .post(`/api/admin/sites/${garage.body.id}/admins`)
      .set(bearer(instanceToken))
      .send({ email: 'gary@example.test', password: 'Starter-passphrase1' });
    assert.equal(res.status, 201);

    const admin = await rawPrisma.admin.findUnique({ where: { email: 'gary@example.test' } });
    assert.equal(admin.tenantId, garage.body.id);
    assert.equal(admin.mustChangePassword, true);
  });

  it('the installation administrator can act on another site with X-Site, and a site admin cannot', async () => {
    const garage = await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'Garage', slug: 'garage' });
    await runWithTenant(garage.body.id, () => prisma.station.create({ data: { identity: 'G-1', name: 'Garage bay' } }));

    const viaHeader = await request(app).get('/api/admin/stations').set(bearer(instanceToken)).set('X-Site', 'garage');
    assert.deepEqual(viaHeader.body.data.map((s) => s.name), ['Garage bay']);

    const unknown = await request(app).get('/api/admin/stations').set(bearer(instanceToken)).set('X-Site', 'nowhere');
    assert.equal(unknown.status, 404);

    // A site admin's header is ignored: they see their own site only.
    const siteAdminView = await request(app).get('/api/admin/stations').set(bearer(siteToken)).set('X-Site', 'garage');
    assert.deepEqual(siteAdminView.body.data, []);
  });

  it('deletes an empty site, and refuses the first site or a site with contents', async () => {
    const garage = await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'Garage', slug: 'garage' });
    await runWithTenant(garage.body.id, () => prisma.station.create({ data: { identity: 'G-2', name: 'Busy bay' } }));

    const busy = await request(app).delete(`/api/admin/sites/${garage.body.id}`).set(bearer(instanceToken));
    assert.equal(busy.status, 400);

    const first = await request(app).delete('/api/admin/sites/default').set(bearer(instanceToken));
    assert.equal(first.status, 400);

    const empty = await request(app).post('/api/admin/sites').set(bearer(instanceToken)).send({ name: 'Empty', slug: 'empty' });
    assert.equal((await request(app).delete(`/api/admin/sites/${empty.body.id}`).set(bearer(instanceToken))).status, 204);
  });
});

describe('operator', () => {
  it('the installation administrator sets the operator; others cannot', async () => {
    const ok = await request(app)
      .put('/api/admin/operator')
      .set(bearer(instanceToken))
      .send({ name: 'Acme Parking', countryCode: 'gb', partyId: 'acm' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { name: 'Acme Parking', countryCode: 'GB', partyId: 'ACM' });

    assert.equal((await request(app).put('/api/admin/operator').set(bearer(siteToken)).send({ name: 'X' })).status, 403);
  });

  it('refuses a malformed country code or party ID', async () => {
    const badCountry = await request(app).put('/api/admin/operator').set(bearer(instanceToken)).send({ countryCode: 'GBR' });
    assert.equal(badCountry.status, 400);
    const badParty = await request(app).put('/api/admin/operator').set(bearer(instanceToken)).send({ partyId: 'AC' });
    assert.equal(badParty.status, 400);
  });
});
