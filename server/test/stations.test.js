import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';

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

async function createStation(overrides = {}) {
  const res = await authed(request(app).post('/api/admin/stations')).send({
    identity: 'CP-1',
    name: 'Garage A',
    location: 'Level 1',
    connectorCount: 2,
    ...overrides,
  });
  return res.body;
}

describe('/api/admin/stations', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/stations');
    assert.equal(res.status, 401);
  });

  it('creates a station with the requested number of connectors', async () => {
    const station = await createStation();
    assert.equal(station.identity, 'CP-1');
    assert.equal(station.connectors.length, 2);
    assert.equal(station.online, false);
  });

  it('rejects a duplicate identity', async () => {
    await createStation();
    const res = await authed(request(app).post('/api/admin/stations')).send({ identity: 'CP-1', name: 'Dup' });
    assert.equal(res.status, 409);
  });

  it('updates a station and resizes its connectors', async () => {
    const station = await createStation({ connectorCount: 1 });
    const res = await authed(request(app).put(`/api/admin/stations/${station.id}`)).send({ connectorCount: 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.connectors.length, 3);
  });

  it('deletes a station', async () => {
    const station = await createStation();
    const res = await authed(request(app).delete(`/api/admin/stations/${station.id}`));
    assert.equal(res.status, 204);
    assert.equal((await authed(request(app).get(`/api/admin/stations/${station.id}`))).status, 404);
  });
});

describe('public /api/stations + waitlist', () => {
  it('lists stations with a waiting count', async () => {
    await createStation();
    const res = await request(app).get('/api/stations');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].waitingCount, 0);
  });

  it('joins the waitlist and reports position/status', async () => {
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });
    assert.equal(join.status, 201);
    assert.ok(join.body.id);

    const status = await request(app).get(`/api/waitlist/${join.body.id}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'WAITING');
    assert.equal(status.body.position, 1);
  });

  it('requires name and contact to join', async () => {
    const station = await createStation();
    const res = await request(app).post(`/api/stations/${station.id}/waitlist`).send({ name: 'Dana' });
    assert.equal(res.status, 400);
  });

  it('requires an identifier when identifierMode demands one', async () => {
    await authed(request(app).put('/api/admin/settings')).send({ identifierMode: 'LICENSE_PLATE' });
    const station = await createStation();
    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com' });
    assert.equal(res.status, 400);
  });

  it('cancels a waitlist entry', async () => {
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });

    const cancel = await request(app).delete(`/api/waitlist/${join.body.id}`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, 'CANCELLED');
  });

  it('refuses to start charging before a reservation exists', async () => {
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });

    const res = await request(app).post(`/api/waitlist/${join.body.id}/start-charging`);
    assert.equal(res.status, 409);
  });

  it('records and lets an admin resolve a line-cutter report', async () => {
    const station = await createStation();
    const join = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });

    const report = await request(app)
      .post(`/api/waitlist/${join.body.id}/report-line-cutter`)
      .send({ note: 'Someone else plugged in' });
    assert.equal(report.status, 201);

    const list = await authed(request(app).get('/api/admin/reports'));
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].note, 'Someone else plugged in');

    const resolve = await authed(request(app).patch(`/api/admin/reports/${report.body.id}`)).send({ status: 'RESOLVED' });
    assert.equal(resolve.status, 200);
    assert.equal(resolve.body.status, 'RESOLVED');
  });
});
