import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';
import { issueApiKey, revokeApiKey } from '../src/services/serviceAccountService.js';
import { SERVICE_ACCOUNT_PERMISSION_KEYS } from '../src/auth/permissions.js';

const SITE_B = 'site-b';
const bearer = (key) => ({ Authorization: `Bearer ${key}` });

// A service account on `tenantId` holding `permissions`, with one active key.
async function keyWith(permissions, { tenantId = DEFAULT_TENANT_ID, disabled = false } = {}) {
  return runWithTenant(tenantId, async () => {
    const account = await prisma.serviceAccount.create({
      data: {
        name: `acct-${Math.random().toString(36).slice(2, 10)}`,
        permissions: JSON.stringify(permissions),
        disabled,
      },
    });
    const { plainKey, key } = await issueApiKey(account.id, { name: 'test', expiresAt: null });
    return { plainKey, keyId: key.id, account };
  });
}

// Everything the API can do, so a test can take one permission away at a time.
const ALL = SERVICE_ACCOUNT_PERMISSION_KEYS;

async function station({ tenantId = DEFAULT_TENANT_ID, identity = 'CP-1', zoneName = 'Zone A' } = {}) {
  return runWithTenant(tenantId, async () => {
    const zone = await prisma.zone.create({ data: { name: `${zoneName} ${identity}` } });
    const st = await prisma.station.create({ data: { identity, name: `Station ${identity}`, zoneId: zone.id } });
    await prisma.connector.create({ data: { stationId: st.id, connectorId: 1, status: 'Available', operative: true } });
    return { station: st, zone };
  });
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });
});

describe('API v1 authentication', () => {
  it('refuses a request with no key', async () => {
    const res = await request(app).get('/api/v1/stations');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHENTICATED');
  });

  it('refuses a session token and a made-up key', async () => {
    const session = await request(app).get('/api/v1/stations').set({ Authorization: 'Bearer eyJhbGciOi.fake.token' });
    assert.equal(session.status, 401);
    const made = await request(app).get('/api/v1/stations').set(bearer('pgk_deadbeef_notarealkey'));
    assert.equal(made.status, 401);
  });

  it('refuses a revoked key', async () => {
    const { plainKey, keyId, account } = await keyWith(['api.stations.read']);
    assert.equal((await request(app).get('/api/v1/stations').set(bearer(plainKey))).status, 200);
    await runWithTenant(DEFAULT_TENANT_ID, () => revokeApiKey(account.id, keyId));
    assert.equal((await request(app).get('/api/v1/stations').set(bearer(plainKey))).status, 401);
  });

  it('refuses an expired key', async () => {
    const { plainKey, keyId } = await keyWith(['api.stations.read']);
    await rawPrisma.apiKey.update({ where: { id: keyId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request(app).get('/api/v1/stations').set(bearer(plainKey))).status, 401);
  });

  it('refuses every key on a disabled account', async () => {
    const { plainKey } = await keyWith(['api.stations.read'], { disabled: true });
    assert.equal((await request(app).get('/api/v1/stations').set(bearer(plainKey))).status, 401);
  });

  it('serves the API reference spec without a key', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    // 200 once the reference is built; 503 with a hint before that.
    assert.ok([200, 503].includes(res.status));
  });
});

describe('API v1 permissions', () => {
  it('answers /me with the key’s permissions and site', async () => {
    const { plainKey } = await keyWith(['api.stations.read', 'api.zones.read']);
    const res = await request(app).get('/api/v1/me').set(bearer(plainKey));
    assert.equal(res.status, 200);
    assert.equal(res.body.site.slug, 'default');
    assert.deepEqual(res.body.permissions, ['api.stations.read', 'api.zones.read']);
  });

  it('a read key can read but not write, and says what is missing', async () => {
    await station();
    const { plainKey } = await keyWith(['api.stations.read']);
    assert.equal((await request(app).get('/api/v1/stations').set(bearer(plainKey))).status, 200);
    const denied = await request(app).post('/api/v1/stations').set(bearer(plainKey)).send({ identity: 'CP-9', name: 'X' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'FORBIDDEN');
    assert.deepEqual(denied.body.missing, ['api.stations.write']);
  });

  it('a write key cannot send commands to a charge point', async () => {
    const { station: st } = await station();
    const { plainKey } = await keyWith(['api.stations.read', 'api.stations.write']);
    const res = await request(app).post(`/api/v1/stations/${st.id}/reset`).set(bearer(plainKey)).send({});
    assert.equal(res.status, 403);
    assert.deepEqual(res.body.missing, ['api.stations.control']);
  });

  it('a control key reaches the command (the charge point is offline here)', async () => {
    const { station: st } = await station();
    const { plainKey } = await keyWith(['api.stations.control']);
    const res = await request(app).post(`/api/v1/stations/${st.id}/reset`).set(bearer(plainKey)).send({});
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 404);
  });

  it('complaints and reports are read-only through the API', async () => {
    const { plainKey } = await keyWith(['api.complaints.read', 'api.reports.read', ...ALL]);
    assert.equal((await request(app).post('/api/v1/complaints').set(bearer(plainKey)).send({})).status, 405);
    assert.equal((await request(app).delete('/api/v1/reports/usage').set(bearer(plainKey))).status, 405);
    assert.equal((await request(app).get('/api/v1/reports/usage').set(bearer(plainKey))).status, 200);
  });

  it('returns JSON, never an HTML page, for an unknown endpoint', async () => {
    const { plainKey } = await keyWith(ALL);
    const res = await request(app).get('/api/v1/no-such-thing').set(bearer(plainKey));
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });

  it('does not expose the admin wizard steps', async () => {
    const { plainKey } = await keyWith(ALL);
    const identity = await request(app).get('/api/v1/stations/identity-check?identity=CP-1').set(bearer(plainKey));
    assert.equal(identity.body.code, 'NOT_FOUND');
    const probe = await request(app).post('/api/v1/stations/test-connection/1').set(bearer(plainKey)).send({});
    assert.equal(probe.body.code, 'NOT_FOUND');
  });

  it('a network-wide price rule needs the installation administrator', async () => {
    const { plainKey } = await keyWith(['api.priceRules.write']);
    const res = await request(app)
      .post('/api/v1/price-rules')
      .set(bearer(plainKey))
      .send({ kind: 'SURGE', scope: 'NETWORK', percent: 10, label: 'Network', startsAt: new Date().toISOString() });
    assert.equal(res.status, 403);
  });
});

describe('API v1 site isolation', () => {
  it('a key only sees its own site’s charge points', async () => {
    await station({ identity: 'CP-A' });
    await station({ tenantId: SITE_B, identity: 'CP-B' });
    const { plainKey } = await keyWith(['api.stations.read', 'api.stations.write']);

    const list = await request(app).get('/api/v1/stations').set(bearer(plainKey));
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.map((s) => s.identity), ['CP-A']);

    const other = await runWithTenant(SITE_B, () => prisma.station.findFirst({ where: { identity: 'CP-B' } }));
    assert.equal((await request(app).get(`/api/v1/stations/${other.id}`).set(bearer(plainKey))).status, 404);
    assert.equal((await request(app).delete(`/api/v1/stations/${other.id}`).set(bearer(plainKey))).status, 404);
    assert.ok(await rawPrisma.station.findUnique({ where: { id: other.id } }));
  });

  it('a waitlist entry from another site cannot be read or cancelled', async () => {
    const { station: st } = await station({ tenantId: SITE_B, identity: 'CP-B' });
    const entry = await runWithTenant(SITE_B, () =>
      prisma.queueEntry.create({ data: { stationId: st.id, name: 'Other', contact: 'x', idTag: 'T', position: 1 } }),
    );
    const { plainKey } = await keyWith(['api.waitlist.read', 'api.waitlist.manage']);
    assert.equal((await request(app).get(`/api/v1/waitlist/${entry.id}`).set(bearer(plainKey))).status, 404);
    assert.equal((await request(app).delete(`/api/v1/waitlist/${entry.id}`).set(bearer(plainKey))).status, 404);
    const still = await rawPrisma.queueEntry.findUnique({ where: { id: entry.id } });
    assert.equal(still.status, 'WAITING');
  });
});

describe('API v1 resources', () => {
  it('creates and updates a zone', async () => {
    const { plainKey } = await keyWith(['api.zones.read', 'api.zones.write']);
    const created = await request(app).post('/api/v1/zones').set(bearer(plainKey)).send({ name: 'Garage' });
    assert.equal(created.status, 201);
    const renamed = await request(app).put(`/api/v1/zones/${created.body.id}`).set(bearer(plainKey)).send({ name: 'Level 2' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Level 2');
    const list = await request(app).get('/api/v1/zones').set(bearer(plainKey));
    assert.deepEqual(list.body.data.map((z) => z.name), ['Level 2']);
  });

  it('creates a charge point with connectors', async () => {
    const { plainKey } = await keyWith(['api.stations.read', 'api.stations.write']);
    const res = await request(app)
      .post('/api/v1/stations')
      .set(bearer(plainKey))
      .send({ identity: 'CP-NEW', name: 'New bay', connectorCount: 2 });
    assert.equal(res.status, 201);
    assert.equal(res.body.identity, 'CP-NEW');
    assert.equal(res.body.connectors.length, 2);
  });

  it('lists a station’s waitlist without naming the drivers', async () => {
    const { station: st } = await station();
    await prisma.queueEntry.create({
      data: { stationId: st.id, name: 'Pat Driver', contact: 'pat@example.test', licensePlate: 'ABC123', idTag: 'TAG-1', position: 1 },
    });
    const { plainKey } = await keyWith(['api.waitlist.read']);
    const res = await request(app).get(`/api/v1/stations/${st.id}/waitlist`).set(bearer(plainKey));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].position, 1);
    const text = JSON.stringify(res.body);
    for (const secret of ['Pat Driver', 'pat@example.test', 'ABC123', 'TAG-1']) {
      assert.ok(!text.includes(secret), `response leaked ${secret}`);
    }
  });

  it('lists charges without payer details or payment links', async () => {
    const { station: st } = await station();
    const tx = await prisma.transaction.create({
      data: { stationId: st.id, connectorId: 1, idTag: 'TAG-2', ocppTransactionId: 7, meterStart: 0, meterStop: 900, stoppedAt: new Date() },
    });
    await prisma.charge.create({
      data: {
        token: 'secret-pay-token',
        stationId: st.id,
        transactionId: tx.id,
        idTag: 'TAG-2',
        payerName: 'Sam Payer',
        payerContact: 'sam@example.test',
        pricingModel: 'TIME',
        currency: 'USD',
        amountCents: 250,
        durationSeconds: 600,
        status: 'PENDING',
      },
    });
    const { plainKey } = await keyWith(['api.charges.read']);
    const res = await request(app).get('/api/v1/charges').set(bearer(plainKey));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].amountCents, 250);
    const text = JSON.stringify(res.body);
    for (const secret of ['Sam Payer', 'sam@example.test', 'secret-pay-token']) {
      assert.ok(!text.includes(secret), `response leaked ${secret}`);
    }
  });

  it('lists complaints without the driver’s name or contact', async () => {
    const { station: st } = await station();
    const entry = await prisma.queueEntry.create({
      data: { stationId: st.id, name: 'Jo Complainant', contact: 'jo@example.test', idTag: 'TAG-3', position: 1 },
    });
    await prisma.lineCuttingComplaint.create({ data: { stationId: st.id, queueEntryId: entry.id, note: 'Cut in' } });
    const { plainKey } = await keyWith(['api.complaints.read']);
    const res = await request(app).get('/api/v1/complaints').set(bearer(plainKey));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].note, 'Cut in');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('Jo Complainant'));
    assert.ok(!text.includes('jo@example.test'));
  });

  it('creates a site alert and refuses a network-wide one', async () => {
    const { plainKey } = await keyWith(['api.alerts.read', 'api.alerts.write']);
    const site = await request(app)
      .post('/api/v1/alerts')
      .set(bearer(plainKey))
      .send({ scope: 'SITE', severity: 'WARNING', message: 'Bay 2 is closed today' });
    assert.equal(site.status, 201);
    const network = await request(app)
      .post('/api/v1/alerts')
      .set(bearer(plainKey))
      .send({ scope: 'NETWORK', severity: 'INFO', message: 'Everywhere' });
    assert.equal(network.status, 403);
    const list = await request(app).get('/api/v1/alerts').set(bearer(plainKey));
    assert.deepEqual(list.body.data.map((a) => a.message), ['Bay 2 is closed today']);
  });

  it('the site’s usage report is available with the reports permission', async () => {
    const { plainKey } = await keyWith(['api.reports.read']);
    const res = await request(app).get('/api/v1/reports/usage?days=7').set(bearer(plainKey));
    assert.equal(res.status, 200);
  });
});
