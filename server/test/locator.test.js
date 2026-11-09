import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';
import { connectorKw, haversineKm } from '../src/services/locator.js';

const SITE_B = 'site-b';
const PASSWORD = 'CorrectHorse1!';

// A complete, publishable connector: standard, format, power type, voltage and amperage.
const GOOD_CONNECTOR = {
  connectorId: 1,
  standard: 'IEC_62196_T2',
  format: 'SOCKET',
  powerType: 'AC_3_PHASE',
  maxVoltage: 400,
  maxAmperage: 32,
};

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

// Creates a station with coordinates and the given connectors, in the given site (default if none).
async function makeStation({ identity, name, latitude = 51.5, longitude = -0.12, connectors = [GOOD_CONNECTOR], site = null, zoneId = null, ...extra }) {
  const create = () =>
    prisma.station.create({
      data: { identity, name, latitude, longitude, zoneId, ...extra, connectors: { create: connectors } },
    });
  return site ? runWithTenant(site, create) : create();
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });
  await createAdmin({ password: PASSWORD });
});

describe('power from connector ratings', () => {
  it('single-phase power is volts times amps, in kW', () => {
    assert.equal(connectorKw({ powerType: 'AC_1_PHASE', maxVoltage: 230, maxAmperage: 32 }), 7.4);
  });

  it('three-phase power uses the square root of three', () => {
    assert.equal(connectorKw({ powerType: 'AC_3_PHASE', maxVoltage: 400, maxAmperage: 32 }), 22.2);
  });

  it('a connector with no rating has no power', () => {
    assert.equal(connectorKw({ powerType: 'DC', maxVoltage: null, maxAmperage: null }), null);
  });
});

describe('distance', () => {
  it('measures great-circle distance in kilometres', () => {
    // London to Paris is about 344 km.
    const km = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    assert.ok(km > 340 && km < 348, `got ${km}`);
  });
});

describe('public locator', () => {
  it('lists only stations that are publishable (coordinates and complete connectors)', async () => {
    await makeStation({ identity: 'OK-1', name: 'Published bay' });
    await makeStation({ identity: 'NOPOS-1', name: 'No coordinates', latitude: null, longitude: null });
    await makeStation({
      identity: 'PARTIAL-1',
      name: 'Incomplete connector',
      connectors: [{ connectorId: 1, standard: 'IEC_62196_T2' }],
    });

    const res = await request(app).get('/api/locator/stations');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.stations.map((s) => s.name), ['Published bay']);
  });

  it('reports each charge point with its power and connectors', async () => {
    await makeStation({ identity: 'OK-1', name: 'Published bay' });
    const res = await request(app).get('/api/locator/stations');
    const [station] = res.body.stations;
    assert.equal(station.maxKw, 22.2);
    assert.equal(station.connectors[0].standard, 'IEC_62196_T2');
    assert.equal(station.connectors[0].kw, 22.2);
    assert.equal(station.site.slug, 'default');
  });

  it('a station that is not connected reports as offline, not available', async () => {
    await makeStation({ identity: 'OK-1', name: 'Published bay' });
    const res = await request(app).get('/api/locator/stations?available=1');
    assert.equal(res.body.count, 0);
    const all = await request(app).get('/api/locator/stations');
    assert.equal(all.body.stations[0].state, 'OFFLINE');
  });

  it('filters by connector standard and by minimum power', async () => {
    await makeStation({ identity: 'T2', name: 'Type 2 fast' });
    await makeStation({
      identity: 'CHA',
      name: 'CHAdeMO slow',
      connectors: [{ ...GOOD_CONNECTOR, connectorId: 1, standard: 'CHADEMO', powerType: 'DC', maxVoltage: 400, maxAmperage: 20 }],
    });

    const byStandard = await request(app).get('/api/locator/stations?standard=CHADEMO');
    assert.deepEqual(byStandard.body.stations.map((s) => s.name), ['CHAdeMO slow']);

    const byPower = await request(app).get('/api/locator/stations?minKw=20');
    assert.deepEqual(byPower.body.stations.map((s) => s.name), ['Type 2 fast']);
  });

  it('filters by a bounding box around the map view', async () => {
    await makeStation({ identity: 'LON', name: 'London', latitude: 51.5, longitude: -0.12 });
    await makeStation({ identity: 'PAR', name: 'Paris', latitude: 48.85, longitude: 2.35 });

    // west,south,east,north around London only.
    const res = await request(app).get('/api/locator/stations?bbox=-1,51,0,52');
    assert.deepEqual(res.body.stations.map((s) => s.name), ['London']);
  });

  it('searches by name, and sorts by distance from a point', async () => {
    await makeStation({ identity: 'A', name: 'Far away', latitude: 48.85, longitude: 2.35 });
    await makeStation({ identity: 'B', name: 'Near by', latitude: 51.51, longitude: -0.13 });

    const search = await request(app).get('/api/locator/stations?q=near');
    assert.deepEqual(search.body.stations.map((s) => s.name), ['Near by']);

    const sorted = await request(app).get('/api/locator/stations?lat=51.5&lng=-0.12&sort=distance');
    assert.deepEqual(sorted.body.stations.map((s) => s.name), ['Near by', 'Far away']);
    // About 1.2 km away from the search point.
    assert.ok(sorted.body.stations[0].distanceKm > 1 && sorted.body.stations[0].distanceKm < 2);
  });

  it('a site-scoped route shows only that site', async () => {
    await makeStation({ identity: 'DEF-1', name: 'Default bay' });
    await makeStation({ identity: 'B-1', name: 'Site B bay', site: SITE_B });

    const everywhere = await request(app).get('/api/locator/stations');
    assert.equal(everywhere.body.count, 2);

    const siteB = await request(app).get(`/api/t/${SITE_B}/locator/stations`);
    assert.deepEqual(siteB.body.stations.map((s) => s.name), ['Site B bay']);
  });

  it('a detail request for a station that is not publishable is not found', async () => {
    const hidden = await makeStation({ identity: 'NOPOS-1', name: 'Hidden', latitude: null, longitude: null });
    const res = await request(app).get(`/api/locator/stations/${hidden.id}`);
    assert.equal(res.status, 404);
  });

  it('a detail request returns the charge point with its site pricing', async () => {
    const station = await makeStation({ identity: 'OK-1', name: 'Published bay' });
    const res = await request(app).get(`/api/locator/stations/${station.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Published bay');
    assert.equal(res.body.pricing.model, 'FREE');
  });
});

describe('by-site view', () => {
  it('groups charge points by site, then by zone', async () => {
    const zone = await prisma.zone.create({ data: { name: 'Bay row' } });
    await makeStation({ identity: 'Z-1', name: 'In zone', zoneId: zone.id });
    await makeStation({ identity: 'S-1', name: 'Standalone' });
    await makeStation({ identity: 'B-1', name: 'Site B bay', site: SITE_B });

    const res = await request(app).get('/api/locator/sites');
    assert.equal(res.status, 200);
    const defaultSite = res.body.sites.find((s) => s.slug === 'default');
    assert.equal(defaultSite.chargerCount, 2);
    const zoneNames = defaultSite.zones.map((z) => z.name).sort();
    assert.deepEqual(zoneNames, ['Bay row', 'Standalone']);
    assert.ok(res.body.sites.find((s) => s.slug === SITE_B));
  });

  it('a site with only hidden stations is left out', async () => {
    await makeStation({ identity: 'NOPOS-1', name: 'Hidden', latitude: null, longitude: null, site: SITE_B });
    const res = await request(app).get('/api/locator/sites');
    assert.equal(res.body.sites.find((s) => s.slug === SITE_B), undefined);
  });
});

describe('admin location tools', () => {
  it('the site location endpoints require sign-in', async () => {
    const res = await request(app).get('/api/admin/locator/site');
    assert.equal(res.status, 401);
    const geo = await request(app).get('/api/admin/locator/geocode?q=london');
    assert.equal(geo.status, 401);
  });

  it('saves the site address and pin, and rejects bad coordinates', async () => {
    const token = await login((await rawPrisma.admin.findFirst()).email);

    const bad = await request(app)
      .put('/api/admin/locator/site')
      .set(bearer(token))
      .send({ latitude: 200, longitude: 0 });
    assert.equal(bad.status, 400);

    const saved = await request(app)
      .put('/api/admin/locator/site')
      .set(bearer(token))
      .send({ address: '1 High St', city: 'London', latitude: 51.5, longitude: -0.12, hours: '24/7' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.city, 'London');
    assert.equal(saved.body.hours, '24/7');

    const read = await request(app).get('/api/admin/locator/site').set(bearer(token));
    assert.equal(read.body.latitude, 51.5);
  });

  it('a short address lookup is refused before anything is fetched', async () => {
    const token = await login((await rawPrisma.admin.findFirst()).email);
    const res = await request(app).get('/api/admin/locator/geocode?q=ab').set(bearer(token));
    assert.equal(res.status, 400);
  });
});

describe('locator: charger type, waiting people, zones and several plugs', () => {
  const DC_CONNECTOR = { ...GOOD_CONNECTOR, standard: 'IEC_62196_T1_COMBO', powerType: 'DC', maxVoltage: 400, maxAmperage: 125 };

  it('marks a charge point with a DC connector as DC, and the rest as AC', async () => {
    await makeStation({ identity: 'AC1', name: 'Wall box' });
    await makeStation({ identity: 'DC1', name: 'Rapid', connectors: [DC_CONNECTOR] });

    const res = await request(app).get('/api/locator/stations');
    const byName = Object.fromEntries(res.body.stations.map((s) => [s.name, s]));
    assert.equal(byName['Rapid'].chargerType, 'DC');
    assert.equal(byName['Wall box'].chargerType, 'AC');
  });

  it('a list of plugs matches a charge point with any one of them', async () => {
    await makeStation({ identity: 'T2', name: 'Type 2 only' });
    await makeStation({ identity: 'CCS', name: 'CCS2 only', connectors: [{ ...DC_CONNECTOR, standard: 'IEC_62196_T2_COMBO' }] });
    await makeStation({ identity: 'NACS', name: 'NACS only', connectors: [{ ...DC_CONNECTOR, standard: 'TESLA_S' }] });

    const res = await request(app).get('/api/locator/stations?standard=TESLA_S,IEC_62196_T2_COMBO');
    assert.deepEqual(res.body.stations.map((s) => s.name), ['CCS2 only', 'NACS only']);
  });

  it('reports the waiting people for a charge point, and for its zone', async () => {
    const zone = await prisma.zone.create({ data: { name: 'Garage', tenantId: DEFAULT_TENANT_ID } });
    await makeStation({ identity: 'Z1', name: 'Bay 1', zoneId: zone.id });
    await makeStation({ identity: 'Z2', name: 'Bay 2', zoneId: zone.id });
    const solo = await makeStation({ identity: 'SOLO', name: 'Solo' });
    await prisma.queueEntry.create({
      data: { stationId: solo.id, tenantId: DEFAULT_TENANT_ID, name: 'Ben', contact: 'ben@example.test', idTag: 'TAG-S-1', position: 1, status: 'WAITING' },
    });
    await prisma.queueEntry.create({
      data: { zoneId: zone.id, tenantId: DEFAULT_TENANT_ID, name: 'Ana', contact: 'ana@example.test', idTag: 'TAG-Z-1', position: 1, status: 'WAITING' },
    });

    const res = await request(app).get('/api/locator/stations');
    const byName = Object.fromEntries(res.body.stations.map((s) => [s.name, s]));
    assert.equal(byName['Bay 1'].zone.waitingCount, 1);
    assert.equal(byName['Bay 2'].zone.name, 'Garage');
    assert.equal(byName['Solo'].zone, null);
    assert.equal(byName['Solo'].waitingCount, 1);
  });

  it('carries the tips for a charge point', async () => {
    await makeStation({ identity: 'TIP', name: 'Level 2', tips: 'Behind the ticket booth.' });
    const res = await request(app).get('/api/locator/stations');
    assert.equal(res.body.stations[0].tips, 'Behind the ticket booth.');
  });
});
