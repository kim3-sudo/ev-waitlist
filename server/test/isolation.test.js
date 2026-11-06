import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';

// Two sites, each with one of everything an admin can see. Every admin route
// that takes an id is tried from each site against the other site's records,
// and every list is checked for the other site's markers.

const SITE_B = 'site-b';
const PASSWORD = 'Password123!';

async function createFixtures(tenantId) {
  const marker = tenantId === DEFAULT_TENANT_ID ? 'site-default' : tenantId;
  return runWithTenant(tenantId, async () => {
    const admin = await createAdmin({ password: PASSWORD });
    const zone = await prisma.zone.create({ data: { name: `Zone marker ${marker}` } });
    const station = await prisma.station.create({
      data: { identity: `CP-${marker}`, name: `Station marker ${marker}`, zoneId: zone.id },
    });
    const entry = await prisma.queueEntry.create({
      data: {
        stationId: station.id,
        name: `Entry marker ${marker}`,
        contact: `${marker}@example.test`,
        idTag: `TAG-${marker}`,
        position: 1,
      },
    });
    const complaint = await prisma.lineCuttingComplaint.create({
      data: { stationId: station.id, queueEntryId: entry.id, note: `Complaint marker ${marker}` },
    });
    const transaction = await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: `TAG-${marker}`,
        ocppTransactionId: 1,
        meterStart: 0,
        meterStop: 500,
        stoppedAt: new Date(),
      },
    });
    const charge = await prisma.charge.create({
      data: {
        token: `token-${marker}`,
        stationId: station.id,
        transactionId: transaction.id,
        idTag: `TAG-${marker}`,
        pricingModel: 'TIME',
        currency: 'USD',
        amountCents: 100,
        durationSeconds: 60,
        status: 'PENDING',
      },
    });
    const role = await prisma.customRole.create({
      data: { name: `Role marker ${marker}`, permissions: JSON.stringify(['stations.view']) },
    });
    return { tenantId, marker, admin, zone, station, entry, complaint, charge, role };
  });
}

async function tokenFor(admin) {
  const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

// Everything another site must never see, as text.
function markersOf(fx) {
  return [fx.marker, fx.admin.email, fx.charge.token];
}

let sites;

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });
  sites = {
    default: await createFixtures(DEFAULT_TENANT_ID),
    b: await createFixtures(SITE_B),
  };
});

// Admin calls that act on one record by id. Each is built from the victim's
// records (which only exist once the test has started), and must be refused,
// or find nothing, when the record belongs to another site.
const SINGLE_RECORD_CALLS = [
  { name: 'GET station', build: (v) => ({ method: 'get', path: `/api/admin/stations/${v.station.id}` }) },
  {
    name: 'PUT station',
    build: (v) => ({ method: 'put', path: `/api/admin/stations/${v.station.id}`, body: { name: 'Hijacked' } }),
  },
  { name: 'DELETE station', build: (v) => ({ method: 'delete', path: `/api/admin/stations/${v.station.id}` }) },
  {
    name: 'PUT zone',
    build: (v) => ({ method: 'put', path: `/api/admin/zones/${v.zone.id}`, body: { name: 'Hijacked' } }),
  },
  { name: 'DELETE zone', build: (v) => ({ method: 'delete', path: `/api/admin/zones/${v.zone.id}` }) },
  {
    name: 'PATCH user',
    build: (v) => ({ method: 'patch', path: `/api/admin/users/${v.admin.id}`, body: { role: 'ADMIN' } }),
  },
  { name: 'DELETE user', build: (v) => ({ method: 'delete', path: `/api/admin/users/${v.admin.id}` }) },
  {
    name: 'PATCH role',
    build: (v) => ({
      method: 'patch',
      path: `/api/admin/roles/${encodeURIComponent(v.role.name)}`,
      body: { description: 'Hijacked' },
    }),
  },
  {
    name: 'DELETE role',
    build: (v) => ({ method: 'delete', path: `/api/admin/roles/${encodeURIComponent(v.role.name)}` }),
  },
  {
    name: 'PATCH complaint',
    build: (v) => ({ method: 'patch', path: `/api/admin/complaints/${v.complaint.id}`, body: { status: 'DISMISSED' } }),
  },
];

// Public joins that name another site's station or zone. They must not add an
// entry to that site's waitlist from this site's address.
const PUBLIC_JOIN_CALLS = [
  { name: 'join station waitlist', build: (v, base) => ({ path: `${base}/stations/${v.station.id}/waitlist` }) },
  { name: 'join zone waitlist', build: (v, base) => ({ path: `${base}/zones/${v.zone.id}/waitlist` }) },
];

// The public API base of a site: the default site's un-prefixed routes, or a named site's.
const publicBase = (key) => (key === 'default' ? '/api' : `/api/t/${SITE_B}`);

const attackers = [
  ['the default site', 'default', 'b'],
  ['site B', 'b', 'default'],
];

for (const [label, attackerKey, victimKey] of attackers) {
  describe(`${label}'s admin cannot reach the other site's records`, () => {
    for (const { name, build } of SINGLE_RECORD_CALLS) {
      it(`${name} is refused, and the record is unchanged`, async () => {
        const victim = sites[victimKey];
        const call = build(victim);
        const token = await tokenFor(sites[attackerKey].admin);
        let req = request(app)[call.method](call.path).set('Authorization', `Bearer ${token}`);
        if (call.body) req = req.send(call.body);
        const res = await req;

        assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);

        const station = await rawPrisma.station.findUnique({ where: { id: victim.station.id } });
        const zone = await rawPrisma.zone.findUnique({ where: { id: victim.zone.id } });
        const admin = await rawPrisma.admin.findUnique({ where: { id: victim.admin.id } });
        const complaint = await rawPrisma.lineCuttingComplaint.findUnique({ where: { id: victim.complaint.id } });
        const role = await rawPrisma.customRole.findUnique({ where: { id: victim.role.id } });
        assert.ok(station, 'station still exists');
        assert.equal(station.name, `Station marker ${victim.marker}`);
        assert.equal(zone.name, `Zone marker ${victim.marker}`);
        assert.ok(admin, 'admin still exists');
        assert.equal(admin.role, 'ADMIN');
        assert.equal(complaint.status, 'OPEN');
        assert.equal(role.description, null);
      });
    }

    for (const { name, build } of PUBLIC_JOIN_CALLS) {
      it(`${name} from this site's address is refused`, async () => {
        const victim = sites[victimKey];
        const call = build(victim, publicBase(attackerKey));
        const res = await request(app)
          .post(call.path)
          .send({ name: 'Intruder', contact: 'intruder@example.test', licensePlate: 'ZZ999' });
        assert.equal(res.status, 404);
        const victimEntries = await rawPrisma.queueEntry.count({ where: { tenantId: victim.tenantId } });
        assert.equal(victimEntries, 1, 'no entry was added to the other site');
      });
    }

    it('the admin lists show only this site', async () => {
      const token = await tokenFor(sites[attackerKey].admin);
      const views = [
        '/api/admin/stations',
        '/api/admin/zones',
        '/api/admin/users',
        '/api/admin/roles',
        '/api/admin/complaints',
        '/api/admin/payments/charges',
        '/api/admin/reports/idle',
        '/api/admin/reports/complaints-summary',
      ];
      for (const path of views) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        assert.equal(res.status, 200, path);
        const text = JSON.stringify(res.body);
        for (const marker of markersOf(sites[victimKey])) {
          assert.equal(text.includes(marker), false, `${path} leaks "${marker}"`);
        }
      }
    });

    it('the public lists show only this site', async () => {
      // The fixture station is zoned, so it appears under /api/zones, not /api/stations.
      const base = publicBase(attackerKey);
      for (const path of [`${base}/stations`, `${base}/zones`]) {
        const text = JSON.stringify((await request(app).get(path)).body);
        assert.equal(text.includes(sites[victimKey].marker), false, `${path} leaks the other site`);
      }
      const zones = JSON.stringify((await request(app).get(`${base}/zones`)).body);
      assert.equal(zones.includes(sites[attackerKey].marker), true, '/api/zones omits this site');
    });
  });
}
