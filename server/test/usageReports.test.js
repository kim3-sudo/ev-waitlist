import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { rawPrisma } from '../src/db.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

function authed(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

const HOUR = 3_600_000;

async function createStation(identity, connectorCount = 2) {
  const res = await authed(request(app).post('/api/admin/stations')).send({ identity, name: `Station ${identity}`, connectorCount });
  return res.body;
}

describe('GET /api/admin/reports/energy', () => {
  it('adds up metered energy per station and counts sessions without a reading', async () => {
    const station = await createStation('CP-E1');
    const now = Date.now();
    // Two finished sessions with readings (3 kWh and 5 kWh), and one with no reading.
    await rawPrisma.transaction.create({
      data: { tenantId: 'default', stationId: station.id, connectorId: 1, idTag: 'a', ocppTransactionId: 1,
        meterStart: 1000, meterStop: 4000, startedAt: new Date(now - 3 * HOUR), stoppedAt: new Date(now - 2 * HOUR) },
    });
    await rawPrisma.transaction.create({
      data: { tenantId: 'default', stationId: station.id, connectorId: 1, idTag: 'b', ocppTransactionId: 2,
        meterStart: 4000, meterStop: 9000, startedAt: new Date(now - 2 * HOUR), stoppedAt: new Date(now - HOUR) },
    });
    await rawPrisma.transaction.create({
      data: { tenantId: 'default', stationId: station.id, connectorId: 2, idTag: 'c', ocppTransactionId: 3,
        startedAt: new Date(now - HOUR), stoppedAt: new Date(now - 30 * 60_000) },
    });

    const res = await authed(request(app).get('/api/admin/reports/energy')).query({ days: 7 });
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.sessions, 3);
    assert.equal(res.body.totals.energyKwh, 8);
    assert.equal(res.body.totals.sessionsWithReading, 2);
    assert.equal(res.body.totals.sessionsWithoutReading, 1);
    assert.equal(res.body.stations[0].stationName, 'Station CP-E1');
    assert.equal(res.body.stations[0].energyKwh, 8);
    assert.equal(res.body.stations[0].averageKwhPerSession, 4);
    assert.ok(res.body.daily.length >= 1);
  });

  it('requires reports permission', async () => {
    const res = await request(app).get('/api/admin/reports/energy');
    assert.equal(res.status, 401);
  });
});

describe('GET /api/admin/reports/usage', () => {
  it('splits connector time into charging, waiting after charging, and free', async () => {
    const station = await createStation('CP-U1', 2);
    const now = Date.now();
    // Over the last 2 days (48 hours, 2 connectors = 96 connector-hours):
    // one 4-hour session, and one 2-hour wait after charging.
    await rawPrisma.transaction.create({
      data: { tenantId: 'default', stationId: station.id, connectorId: 1, idTag: 'u', ocppTransactionId: 10,
        startedAt: new Date(now - 10 * HOUR), stoppedAt: new Date(now - 6 * HOUR) },
    });
    await rawPrisma.idleEvent.create({
      data: { tenantId: 'default', stationId: station.id, connectorId: 1,
        startedAt: new Date(now - 6 * HOUR), endedAt: new Date(now - 4 * HOUR) },
    });

    const res = await authed(request(app).get('/api/admin/reports/usage')).query({ days: 2 });
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.stationName === 'Station CP-U1');
    assert.equal(row.connectors, 2);
    assert.equal(row.chargingHours, 4);
    assert.equal(row.waitingHours, 2);
    assert.equal(row.freeHours, 90);
    assert.equal(row.chargingPercent, 4.2);
    assert.equal(row.waitingPercent, 2.1);
    assert.equal(row.freePercent, 93.8);
    assert.equal(row.sessions, 1);
    assert.equal(row.averageSessionMinutes, 240);
  });

  it('leaves out time before the window', async () => {
    const station = await createStation('CP-U2', 1);
    const now = Date.now();
    await rawPrisma.transaction.create({
      data: { tenantId: 'default', stationId: station.id, connectorId: 1, idTag: 'old', ocppTransactionId: 20,
        startedAt: new Date(now - 10 * 24 * HOUR), stoppedAt: new Date(now - 9 * 24 * HOUR) },
    });
    const res = await authed(request(app).get('/api/admin/reports/usage')).query({ days: 7 });
    const row = res.body.rows.find((r) => r.stationName === 'Station CP-U2');
    assert.equal(row.chargingHours, 0);
    assert.equal(row.freePercent, 100);
  });
});
