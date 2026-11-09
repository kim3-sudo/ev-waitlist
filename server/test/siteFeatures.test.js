import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { DEFAULT_TENANT_ID, runWithTenant } from '../src/tenancy/context.js';

const PASSWORD = 'CorrectHorse1!';
let token;

const GOOD_AC = { connectorId: 1, standard: 'IEC_62196_T2', format: 'SOCKET', powerType: 'AC_3_PHASE', maxVoltage: 400, maxAmperage: 32 };
const GOOD_DC = { connectorId: 1, standard: 'IEC_62196_T1_COMBO', format: 'CABLE', powerType: 'DC', maxVoltage: 400, maxAmperage: 125 };

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: PASSWORD });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD });
  token = body.token;
});

function authed(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

async function makeStation({ identity, name, connector = GOOD_AC, parkingKeys = null, tenantId = DEFAULT_TENANT_ID }) {
  const create = () =>
    prisma.station.create({
      data: {
        identity,
        name,
        latitude: 51.5,
        longitude: -0.12,
        tenantId,
        parkingKeys,
        connectors: { create: [connector] },
      },
    });
  return runWithTenant(tenantId, create);
}

async function siteSettings(fields) {
  await prisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: fields });
}

describe('site amenities, parking and access control (admin)', () => {
  it('saves the site amenities, parking and access control, and returns them', async () => {
    const put = await authed(request(app).put('/api/admin/locator/site')).send({
      amenityKeys: ['RESTROOMS', 'WIFI'],
      parkingKeys: ['COVERED', 'ILLUMINATED'],
      accessControlled: true,
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.amenityKeys, ['RESTROOMS', 'WIFI']);
    assert.deepEqual(put.body.parkingKeys, ['COVERED', 'ILLUMINATED']);
    assert.equal(put.body.accessControlled, true);

    const get = await authed(request(app).get('/api/admin/locator/site'));
    assert.deepEqual(get.body.parkingKeys, ['COVERED', 'ILLUMINATED']);
  });

  it('refuses an amenity or parking option that is not in the list', async () => {
    const res = await authed(request(app).put('/api/admin/locator/site')).send({ amenityKeys: ['SAUNA'] });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not recognised/);
  });

  it('leaves the features alone when the site is saved without them', async () => {
    await authed(request(app).put('/api/admin/locator/site')).send({ parkingKeys: ['GARAGE'], accessControlled: true });
    await authed(request(app).put('/api/admin/locator/site')).send({ city: 'Leeds' });
    const get = await authed(request(app).get('/api/admin/locator/site'));
    assert.deepEqual(get.body.parkingKeys, ['GARAGE']);
    assert.equal(get.body.accessControlled, true);
  });

  it('saves parking on a charge point, and leaves it alone when not sent', async () => {
    const created = await authed(request(app).post('/api/admin/stations')).send({
      identity: 'CP-P',
      name: 'Bay P',
      connectorCount: 1,
      parkingKeys: ['TRAILER_FRIENDLY', 'PULL_THROUGH'],
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.parkingKeys, ['TRAILER_FRIENDLY', 'PULL_THROUGH']);

    const renamed = await authed(request(app).put(`/api/admin/stations/${created.body.id}`)).send({ name: 'Bay Q' });
    assert.deepEqual(renamed.body.parkingKeys, ['TRAILER_FRIENDLY', 'PULL_THROUGH']);
  });
});

describe('locator: site details and filters for drivers', () => {
  it('shows the site features and the charge point parking to drivers', async () => {
    await siteSettings({ amenityKeys: JSON.stringify(['DINING']), parkingKeys: JSON.stringify(['ACCESSIBLE']), accessControlled: true });
    await makeStation({ identity: 'P1', name: 'Covered bay', parkingKeys: JSON.stringify(['COVERED']) });

    const res = await request(app).get('/api/locator/stations');
    const station = res.body.stations[0];
    assert.deepEqual(station.parking, ['COVERED']);
    assert.deepEqual(station.site.features, { amenities: ['DINING'], parking: ['ACCESSIBLE'], accessControlled: true });
  });

  it('filters by charger type, either AC or DC', async () => {
    await makeStation({ identity: 'A1', name: 'Wall box' });
    await makeStation({ identity: 'D1', name: 'Rapid', connector: GOOD_DC });

    const dc = await request(app).get('/api/locator/stations?type=DC');
    assert.deepEqual(dc.body.stations.map((s) => s.name), ['Rapid']);
    const both = await request(app).get('/api/locator/stations?type=AC,DC');
    assert.equal(both.body.stations.length, 2);
  });

  it('filters by the minimum number of charge points at the site', async () => {
    await rawPrisma.tenant.create({ data: { id: 'site-b', slug: 'site-b', name: 'Site B' } });
    await makeStation({ identity: 'S1', name: 'Alone', tenantId: 'site-b' });
    await makeStation({ identity: 'S2', name: 'Pair one' });
    await makeStation({ identity: 'S3', name: 'Pair two' });

    const res = await request(app).get('/api/locator/stations?minChargers=2');
    assert.deepEqual(res.body.stations.map((s) => s.name).sort(), ['Pair one', 'Pair two']);
  });

  it('amenities must all be offered by the site', async () => {
    await siteSettings({ amenityKeys: JSON.stringify(['RESTROOMS', 'WIFI']) });
    await makeStation({ identity: 'AM1', name: 'Charger' });

    assert.equal((await request(app).get('/api/locator/stations?amenities=RESTROOMS,WIFI')).body.stations.length, 1);
    assert.equal((await request(app).get('/api/locator/stations?amenities=RESTROOMS,CAMPING')).body.stations.length, 0);
  });

  it('parking matches on the charge point or the site, and all chosen options must be there', async () => {
    await siteSettings({ parkingKeys: JSON.stringify(['COVERED']) });
    await makeStation({ identity: 'PK1', name: 'Covered at site', parkingKeys: JSON.stringify(['ACCESSIBLE']) });

    const both = await request(app).get('/api/locator/stations?parking=COVERED,ACCESSIBLE');
    assert.deepEqual(both.body.stations.map((s) => s.name), ['Covered at site']);
    const missing = await request(app).get('/api/locator/stations?parking=COVERED,GARAGE');
    assert.equal(missing.body.stations.length, 0);
  });
});
