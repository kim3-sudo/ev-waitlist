import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { sweepRetention } from '../src/services/retentionSweeper.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

let adminToken;
let viewerToken;
let station;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.token;
}

async function closedEntry({ closedDaysAgo, status = 'CANCELLED', idTag = `TAG-${Math.random()}` }) {
  return prisma.queueEntry.create({
    data: {
      stationId: station.id,
      name: 'Dana Driver',
      contact: 'dana@example.test',
      licensePlate: 'AB12 CDE',
      parkingPermit: 'P-99',
      idTag,
      position: 1,
      status,
      createdAt: daysAgo(closedDaysAgo + 1),
      closedAt: daysAgo(closedDaysAgo),
    },
  });
}

async function chargeFor(idTag, createdDaysAgo) {
  const transaction = await prisma.transaction.create({
    data: { stationId: station.id, connectorId: 1, idTag, ocppTransactionId: Math.floor(Math.random() * 1e6), meterStart: 0, meterStop: 500, stoppedAt: new Date() },
  });
  return prisma.charge.create({
    data: {
      token: `tok-${idTag}`,
      stationId: station.id,
      transactionId: transaction.id,
      idTag,
      payerName: 'Dana Driver',
      payerContact: 'dana@example.test',
      pricingModel: 'TIME',
      currency: 'USD',
      amountCents: 300,
      durationSeconds: 600,
      status: 'PAID',
      createdAt: daysAgo(createdDaysAgo),
    },
  });
}

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: PASSWORD });
  const viewer = await createAdmin({ password: PASSWORD });
  await rawPrisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
  adminToken = await login(admin.email);
  viewerToken = await login(viewer.email);
  station = await prisma.station.create({ data: { identity: 'PRIV-1', name: 'Privacy bay' } });
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('retention sweep', () => {
  it('clears personal details of queue entries closed longer ago than the queue period', async () => {
    const old = await closedEntry({ closedDaysAgo: 31 });
    const recent = await closedEntry({ closedDaysAgo: 5 });
    const waiting = await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Still waiting', contact: 'wait@example.test', idTag: 'TAG-WAIT', position: 2 },
    });

    await runWithTenant(DEFAULT_TENANT_ID, () => sweepRetention());

    const cleared = await rawPrisma.queueEntry.findUnique({ where: { id: old.id } });
    assert.equal(cleared.name, '');
    assert.equal(cleared.contact, '');
    assert.equal(cleared.licensePlate, null);
    assert.equal(cleared.parkingPermit, null);
    assert.equal((await rawPrisma.queueEntry.findUnique({ where: { id: recent.id } })).contact, 'dana@example.test');
    assert.equal((await rawPrisma.queueEntry.findUnique({ where: { id: waiting.id } })).contact, 'wait@example.test');
  });

  it('clears payer details after the financial period, and keeps amounts', async () => {
    await rawPrisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: { financialRetentionDays: 365 } });
    const old = await chargeFor('TAG-OLD', 400);
    const recent = await chargeFor('TAG-NEW', 100);

    await runWithTenant(DEFAULT_TENANT_ID, () => sweepRetention());

    const after = await rawPrisma.charge.findUnique({ where: { id: old.id } });
    assert.equal(after.payerContact, null);
    assert.equal(after.payerName, null);
    assert.equal(after.amountCents, 300);
    assert.equal((await rawPrisma.charge.findUnique({ where: { id: recent.id } })).payerContact, 'dana@example.test');
  });

  it('keeps financial records indefinitely when the period is null', async () => {
    const old = await chargeFor('TAG-KEEP', 4000);
    await rawPrisma.tenant.update({ where: { id: DEFAULT_TENANT_ID }, data: { financialRetentionDays: null } });

    await runWithTenant(DEFAULT_TENANT_ID, () => sweepRetention());

    assert.equal((await rawPrisma.charge.findUnique({ where: { id: old.id } })).payerContact, 'dana@example.test');
  });

  it('the sweep is safe to repeat', async () => {
    await closedEntry({ closedDaysAgo: 31 });
    await runWithTenant(DEFAULT_TENANT_ID, () => sweepRetention());
    const second = await runWithTenant(DEFAULT_TENANT_ID, () => sweepRetention());
    assert.equal(second.queueEntries, 0);
  });
});

describe('retention settings', () => {
  it('sets the periods, and refuses nonsense values', async () => {
    const ok = await request(app)
      .put('/api/admin/privacy/retention')
      .set(bearer(adminToken))
      .send({ queueRetentionDays: 14, financialRetentionDays: null });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { queueRetentionDays: 14, financialRetentionDays: null });

    assert.equal((await request(app).put('/api/admin/privacy/retention').set(bearer(adminToken)).send({ queueRetentionDays: 0 })).status, 400);
    assert.equal((await request(app).put('/api/admin/privacy/retention').set(bearer(adminToken)).send({ financialRetentionDays: 9999 })).status, 400);
  });

  it('defaults both periods to 30 days', async () => {
    const res = await request(app).get('/api/admin/privacy/retention').set(bearer(adminToken));
    assert.deepEqual(res.body, { queueRetentionDays: 30, financialRetentionDays: 30 });
  });

  it('a viewer cannot change retention', async () => {
    assert.equal((await request(app).put('/api/admin/privacy/retention').set(bearer(viewerToken)).send({ queueRetentionDays: 5 })).status, 403);
  });
});

describe('early erasure', () => {
  it('clears one driver\'s details now, including their charges, whatever the periods say', async () => {
    const entry = await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Dana Driver', contact: 'dana@example.test', licensePlate: 'AB12', idTag: 'TAG-ERASE', position: 3, status: 'COMPLETED', closedAt: new Date() },
    });
    const charge = await chargeFor('TAG-ERASE', 2);

    const res = await request(app).post('/api/admin/privacy/erase').set(bearer(adminToken)).send({ queueEntryId: entry.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.erased, true);

    const cleared = await rawPrisma.queueEntry.findUnique({ where: { id: entry.id } });
    assert.equal(cleared.name, '');
    assert.equal(cleared.licensePlate, null);
    assert.equal((await rawPrisma.charge.findUnique({ where: { id: charge.id } })).payerContact, null);
  });

  it('is refused for an entry in another site', async () => {
    const res = await request(app).post('/api/admin/privacy/erase').set(bearer(adminToken)).send({ queueEntryId: 'nope' });
    assert.equal(res.status, 404);
  });

  it('cannot erase a driver in another site', async () => {
    await rawPrisma.tenant.create({ data: { id: 'site-b', slug: 'site-b', name: 'Site B' } });
    const other = await runWithTenant('site-b', () =>
      prisma.queueEntry.create({ data: { name: 'Other site driver', contact: 'other@example.test', idTag: 'TAG-OTHER', position: 1 } }),
    );
    const res = await request(app).post('/api/admin/privacy/erase').set(bearer(adminToken)).send({ queueEntryId: other.id });
    assert.equal(res.status, 404);
    assert.equal((await rawPrisma.queueEntry.findUnique({ where: { id: other.id } })).name, 'Other site driver');
  });
});
