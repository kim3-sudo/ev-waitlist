import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { onConnectorFreed } from '../src/services/dispatcher.js';
import { isIdTagAuthorizedAt } from '../src/services/queueService.js';

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

async function createZone(name = 'Parking Garage P1') {
  const res = await authed(request(app).post('/api/admin/zones')).send({ name });
  return res.body;
}

async function createStation({ identity, name, zoneId }) {
  const res = await authed(request(app).post('/api/admin/stations')).send({
    identity,
    name,
    connectorCount: 1,
    zoneId: zoneId ?? '',
  });
  return res.body;
}

describe('/api/admin/zones', () => {
  it('requires authentication', async () => {
    assert.equal((await request(app).get('/api/admin/zones')).status, 401);
  });

  it('creates, lists, and renames a zone', async () => {
    const created = await createZone('Garage A');
    assert.equal(created.name, 'Garage A');
    assert.equal(created.stations.length, 0);
    assert.equal(created.waitingCount, 0);

    const renamed = await authed(request(app).put(`/api/admin/zones/${created.id}`)).send({ name: 'Garage A1' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Garage A1');
  });

  it('rejects a duplicate zone name', async () => {
    await createZone('Garage A');
    const res = await authed(request(app).post('/api/admin/zones')).send({ name: 'Garage A' });
    assert.equal(res.status, 409);
  });

  it('refuses to delete a zone that still has stations assigned', async () => {
    const zone = await createZone();
    await createStation({ identity: 'CP-1', name: 'Charger 1', zoneId: zone.id });

    const res = await authed(request(app).delete(`/api/admin/zones/${zone.id}`));
    assert.equal(res.status, 400);
  });

  it('deletes an empty zone', async () => {
    const zone = await createZone();
    const res = await authed(request(app).delete(`/api/admin/zones/${zone.id}`));
    assert.equal(res.status, 204);
  });
});

describe('assigning stations to a zone', () => {
  it('shows the zone name on the admin station and un-assigns cleanly when deleted', async () => {
    const zone = await createZone('Garage A');
    const station = await createStation({ identity: 'CP-1', name: 'Charger 1', zoneId: zone.id });
    assert.equal(station.zoneId, zone.id);
    assert.equal(station.zoneName, 'Garage A');
  });

  it('rejects an unknown zoneId', async () => {
    const res = await authed(request(app).post('/api/admin/stations')).send({
      identity: 'CP-1',
      name: 'Charger 1',
      zoneId: 'does-not-exist',
    });
    assert.equal(res.status, 400);
  });
});

describe('public station/zone listing', () => {
  it('lists zoned stations only under /api/zones, and standalone ones only under /api/stations', async () => {
    const zone = await createZone('Garage A');
    await createStation({ identity: 'CP-1', name: 'Zoned charger', zoneId: zone.id });
    await createStation({ identity: 'CP-2', name: 'Standalone charger' });

    const stations = await request(app).get('/api/stations');
    assert.equal(stations.body.length, 1);
    assert.equal(stations.body[0].name, 'Standalone charger');

    const zones = await request(app).get('/api/zones');
    assert.equal(zones.body.length, 1);
    assert.equal(zones.body[0].stations.length, 1);
    assert.equal(zones.body[0].stations[0].name, 'Zoned charger');
  });

  it('refuses to join a zoned station directly', async () => {
    const zone = await createZone('Garage A');
    const station = await createStation({ identity: 'CP-1', name: 'Zoned charger', zoneId: zone.id });

    const res = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });
    assert.equal(res.status, 400);
  });
});

describe('zone-based dispatch', () => {
  it('matches the next zone-queued person to whichever station frees up first', async () => {
    const zone = await createZone('Garage A');
    const stationA = await createStation({ identity: 'CP-A', name: 'Charger A', zoneId: zone.id });
    const stationB = await createStation({ identity: 'CP-B', name: 'Charger B', zoneId: zone.id });
    // Both connectors start Unavailable, as if no StatusNotification has
    // reported them free yet.
    await prisma.connector.updateMany({ where: {}, data: { status: 'Unavailable' } });

    const join1 = await request(app)
      .post(`/api/zones/${zone.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });
    const join2 = await request(app)
      .post(`/api/zones/${zone.id}/waitlist`)
      .send({ name: 'Sam', contact: 'sam@example.com', licensePlate: 'XYZ789' });
    assert.equal(join1.status, 201);
    assert.equal(join2.status, 201);

    // Nobody's been matched yet -- still shows the zone name, not a station.
    const beforeMatch = await request(app).get(`/api/waitlist/${join1.body.id}`);
    assert.equal(beforeMatch.body.status, 'WAITING');
    assert.equal(beforeMatch.body.stationName, 'Garage A');
    assert.equal(beforeMatch.body.position, 1);

    // Station B's connector reports Available first -- Dana (front of the
    // zone's line) should be matched to it, not station A.
    await prisma.connector.update({
      where: { stationId_connectorId: { stationId: stationB.id, connectorId: 1 } },
      data: { status: 'Available' },
    });
    await onConnectorFreed(stationB.id, 1);

    const dana = await request(app).get(`/api/waitlist/${join1.body.id}`);
    assert.equal(dana.body.status, 'NOTIFIED');
    assert.equal(dana.body.stationName, 'Charger B');
    assert.equal(dana.body.reservation.connectorId, 1);

    const samStillWaiting = await request(app).get(`/api/waitlist/${join2.body.id}`);
    assert.equal(samStillWaiting.body.status, 'WAITING');
    assert.equal(samStillWaiting.body.position, 1);

    // Now station A frees up -- Sam should be matched to it.
    await prisma.connector.update({
      where: { stationId_connectorId: { stationId: stationA.id, connectorId: 1 } },
      data: { status: 'Available' },
    });
    await onConnectorFreed(stationA.id, 1);

    const sam = await request(app).get(`/api/waitlist/${join2.body.id}`);
    assert.equal(sam.body.status, 'NOTIFIED');
    assert.equal(sam.body.stationName, 'Charger A');

    // Each person is now pinned to the specific station they were matched
    // to -- this is what lets OCPP StartTransaction/Authorize (both keyed
    // by station) find them.
    const danaEntry = await prisma.queueEntry.findUnique({ where: { id: join1.body.id } });
    const samEntry = await prisma.queueEntry.findUnique({ where: { id: join2.body.id } });
    assert.equal(danaEntry.stationId, stationB.id);
    assert.equal(samEntry.stationId, stationA.id);
    assert.equal(await isIdTagAuthorizedAt(stationB.id, danaEntry.idTag), true);
    assert.equal(await isIdTagAuthorizedAt(stationA.id, danaEntry.idTag), false);
    assert.equal(await isIdTagAuthorizedAt(stationA.id, samEntry.idTag), true);
  });

  it('dispatches immediately on join if a connector in the zone is already free', async () => {
    const zone = await createZone('Garage A');
    const station = await createStation({ identity: 'CP-A', name: 'Charger A', zoneId: zone.id });
    await prisma.connector.update({
      where: { stationId_connectorId: { stationId: station.id, connectorId: 1 } },
      data: { status: 'Available' },
    });

    const join = await request(app)
      .post(`/api/zones/${zone.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });

    // tryDispatchZone runs fire-and-forget after the response -- give it a
    // tick to complete.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = await request(app).get(`/api/waitlist/${join.body.id}`);
    assert.equal(status.body.status, 'NOTIFIED');
    assert.equal(status.body.stationName, 'Charger A');
  });

  it('does not double-book a connector still marked Available after a soft hold', async () => {
    const zone = await createZone('Garage A');
    const station = await createStation({ identity: 'CP-A', name: 'Charger A', zoneId: zone.id });
    await prisma.connector.update({
      where: { stationId_connectorId: { stationId: station.id, connectorId: 1 } },
      data: { status: 'Available' },
    });

    // First join dispatches immediately (soft hold -- no real OCPP client,
    // so the connector's DB status is never flipped away from Available).
    const join1 = await request(app)
      .post(`/api/zones/${zone.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A second person joining re-triggers zone dispatch, which would see
    // the same connector still reading "Available" if not for the
    // already-held guard.
    const join2 = await request(app)
      .post(`/api/zones/${zone.id}/waitlist`)
      .send({ name: 'Sam', contact: 'sam@example.com', licensePlate: 'XYZ789' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const dana = await request(app).get(`/api/waitlist/${join1.body.id}`);
    const sam = await request(app).get(`/api/waitlist/${join2.body.id}`);
    assert.equal(dana.body.status, 'NOTIFIED');
    assert.equal(sam.body.status, 'WAITING');

    const activeReservations = await prisma.reservation.count({
      where: { stationId: station.id, connectorId: 1, status: 'ACTIVE' },
    });
    assert.equal(activeReservations, 1);
  });

  it("refuses a line-cutter report before the entry has been matched to a station", async () => {
    const zone = await createZone('Garage A');
    await createStation({ identity: 'CP-A', name: 'Charger A', zoneId: zone.id });
    await prisma.connector.updateMany({ where: {}, data: { status: 'Unavailable' } });

    const join = await request(app)
      .post(`/api/zones/${zone.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123' });

    const res = await request(app).post(`/api/waitlist/${join.body.id}/report-line-cutter`).send({});
    assert.equal(res.status, 409);
  });
});
