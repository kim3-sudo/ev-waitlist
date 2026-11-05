import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { reconcileIdle } from '../src/services/idleTracker.js';

let token;
let stationId;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
  const station = await prisma.station.create({ data: { identity: 'IDLE-001', name: 'Bay 1' } });
  stationId = station.id;
});

async function setStatus(connectorId, status) {
  await prisma.connector.upsert({
    where: { stationId_connectorId: { stationId, connectorId } },
    update: { status },
    create: { stationId, connectorId, status },
  });
  await reconcileIdle(stationId, connectorId);
}

async function openTransaction(connectorId) {
  return prisma.transaction.create({
    data: { stationId, connectorId, idTag: 'TAG', ocppTransactionId: Math.floor(Math.random() * 1e6), meterStart: 0 },
  });
}

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);

describe('idle tracking', () => {
  it('opens an event when a finished session leaves the car plugged in, and closes it when freed', async () => {
    await setStatus(1, 'Charging');
    await setStatus(1, 'Finishing');

    let events = await prisma.idleEvent.findMany({ where: { stationId } });
    assert.equal(events.length, 1);
    assert.equal(events[0].endedAt, null);

    await setStatus(1, 'Available');
    events = await prisma.idleEvent.findMany({ where: { stationId } });
    assert.equal(events.length, 1);
    assert.notEqual(events[0].endedAt, null);
  });

  it('does not treat SuspendedEV as idle while a transaction is still open (car paused mid-charge)', async () => {
    const tx = await openTransaction(1);
    await setStatus(1, 'Charging');
    await setStatus(1, 'SuspendedEV');
    assert.equal(await prisma.idleEvent.count({ where: { stationId } }), 0);

    await prisma.transaction.update({ where: { id: tx.id }, data: { stoppedAt: new Date() } });
    await reconcileIdle(stationId, 1);
    assert.equal(await prisma.idleEvent.count({ where: { stationId, endedAt: null } }), 1);
  });

  it('closes the event when charging resumes', async () => {
    await setStatus(1, 'Finishing');
    await setStatus(1, 'Charging');
    const events = await prisma.idleEvent.findMany({ where: { stationId } });
    assert.equal(events.length, 1);
    assert.notEqual(events[0].endedAt, null);
  });

  it('does not open duplicate events for repeated or concurrent reconciles', async () => {
    await setStatus(1, 'Finishing');
    await Promise.all([reconcileIdle(stationId, 1), reconcileIdle(stationId, 1), reconcileIdle(stationId, 1)]);
    assert.equal(await prisma.idleEvent.count({ where: { stationId } }), 1);
  });

  it('ignores connector 0 (whole station)', async () => {
    await reconcileIdle(stationId, 0);
    assert.equal(await prisma.idleEvent.count(), 0);
  });
});

describe('GET /api/admin/reports/idle', () => {
  it('requires authentication', async () => {
    assert.equal((await request(app).get('/api/admin/reports/idle')).status, 401);
  });

  it('flags events at or over the threshold and measures ongoing ones to now', async () => {
    await prisma.idleEvent.create({
      data: { stationId, connectorId: 1, startedAt: minutesAgo(30), endedAt: minutesAgo(5) },
    });
    await prisma.idleEvent.create({
      data: { stationId, connectorId: 2, startedAt: minutesAgo(12) },
    });
    await prisma.idleEvent.create({
      data: { stationId, connectorId: 2, startedAt: minutesAgo(3), endedAt: minutesAgo(2) },
    });

    const res = await request(app)
      .get('/api/admin/reports/idle?minMinutes=10')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.minMinutes, 10);
    assert.equal(res.body.rows.length, 3);
    assert.equal(res.body.ongoingCount, 1);
    assert.equal(res.body.flaggedCount, 2);

    const ongoing = res.body.rows.find((r) => r.ongoing);
    assert.equal(ongoing.flagged, true);
    assert.ok(ongoing.durationMinutes >= 12);
    assert.equal(ongoing.station.name, 'Bay 1');
  });

  it('excludes events older than the lookback window', async () => {
    await prisma.idleEvent.create({
      data: { stationId, connectorId: 1, startedAt: new Date(Date.now() - 10 * 24 * 3600_000), endedAt: new Date() },
    });
    const res = await request(app)
      .get('/api/admin/reports/idle?days=7')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.body.rows.length, 0);
  });
});
