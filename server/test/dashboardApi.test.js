import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
  const station = await prisma.station.create({ data: { identity: 'DASH-001', name: 'Bay 1' } });
  await prisma.connector.create({ data: { stationId: station.id, connectorId: 1, status: 'Available' } });
});

describe('admin dashboard API', () => {
  it('returns connector, connectivity, uptime and utilization figures', async () => {
    const res = await request(app).get('/api/admin/dashboard?days=7').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.days, 7);
    assert.equal(res.body.connectors.total, 1);
    assert.equal(res.body.connectors.offline, 1);
    assert.equal(res.body.connectivity.total, 1);
    assert.equal(res.body.uptime.stations.length, 1);
    assert.ok('chargingPercent' in res.body.utilization);
  });

  it('falls back to a 7-day window for an unsupported range', async () => {
    const res = await request(app).get('/api/admin/dashboard?days=400').set('Authorization', `Bearer ${token}`);
    assert.equal(res.body.days, 7);
  });

  it('includes a money section for an admin who can view payments', async () => {
    const res = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.money.configured, false);
  });

  it('requires a signed-in admin', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    assert.equal(res.status, 401);
  });
});
