import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';

// Alerts and price changes through the admin API, and what drivers see of them.

const PASSWORD = 'CorrectHorse1!';
const SITE_B = 'site-b';
const HOUR = 60 * 60_000;
const hoursFromNow = (h) => new Date(Date.now() + h * HOUR).toISOString();

let token;
let instanceToken;
let garageA;
let lobbyB;
let garageC;

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });

  const admin = await createAdmin({ password: PASSWORD });
  token = await login(admin.email);

  const instance = await createAdmin({ password: PASSWORD });
  await rawPrisma.admin.update({ where: { id: instance.id }, data: { instanceAdmin: true } });
  instanceToken = await login(instance.email);

  garageA = await prisma.station.create({ data: { identity: 'CP-A', name: 'Charger A', location: 'Garage P1' } });
  lobbyB = await prisma.station.create({ data: { identity: 'CP-B', name: 'Charger B', location: 'Lobby' } });
  garageC = await prisma.station.create({ data: { identity: 'CP-C', name: 'Charger C', location: 'Garage P1' } });
});

const authed = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

async function stationsById() {
  const res = await request(app).get('/api/stations');
  assert.equal(res.status, 200);
  return new Map(res.body.map((s) => [s.id, s]));
}

describe('alerts for charge points', () => {
  it('shows a charge point alert only on that charge point', async () => {
    const res = await authed(request(app).post('/api/admin/alerts')).send({
      scope: 'STATION',
      stationId: garageA.id,
      severity: 'WARNING',
      message: 'Charger A is out of service for repair',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'ACTIVE');
    assert.equal(res.body.canEdit, true);

    const stations = await stationsById();
    assert.deepEqual(stations.get(garageA.id).notices.alerts.map((a) => a.severity), ['WARNING']);
    assert.equal(stations.get(lobbyB.id).notices.alerts.length, 0);
  });

  it('shows a location alert on every charge point at that location', async () => {
    const res = await authed(request(app).post('/api/admin/alerts')).send({
      scope: 'LOCATION',
      location: 'Garage P1',
      severity: 'INFO',
      message: 'Garage P1 is closed on Sunday',
    });
    assert.equal(res.status, 201);

    const stations = await stationsById();
    assert.equal(stations.get(garageA.id).notices.alerts.length, 1);
    assert.equal(stations.get(garageC.id).notices.alerts.length, 1);
    assert.equal(stations.get(lobbyB.id).notices.alerts.length, 0);
  });

  it('refuses a location that no charge point has', async () => {
    const res = await authed(request(app).post('/api/admin/alerts')).send({
      scope: 'LOCATION',
      location: 'Basement',
      message: 'Hello',
    });
    assert.equal(res.status, 400);
  });

  it('shows a site alert to drivers of that site only', async () => {
    const res = await authed(request(app).post('/api/admin/alerts')).send({
      scope: 'SITE',
      severity: 'INFO',
      message: 'Our campus charging is moving to the north lot',
    });
    assert.equal(res.status, 201);

    const here = await request(app).get('/api/notices');
    assert.deepEqual(here.body.alerts.map((a) => a.message), ['Our campus charging is moving to the north lot']);

    const other = await request(app).get(`/api/t/${SITE_B}/notices`);
    assert.equal(other.body.alerts.length, 0);
  });

  it('keeps an alert out of its own list once it has ended', async () => {
    const created = await authed(request(app).post('/api/admin/alerts')).send({
      scope: 'STATION',
      stationId: garageA.id,
      message: 'Temporary',
      startsAt: new Date(Date.now() - HOUR).toISOString(),
    });
    assert.equal(created.status, 201);

    const ended = await authed(request(app).put(`/api/admin/alerts/${created.body.id}`)).send({ endsAt: new Date().toISOString() });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.status, 'ENDED');

    const stations = await stationsById();
    assert.equal(stations.get(garageA.id).notices.alerts.length, 0);
  });

  it('keeps an alert that starts later out of view until it starts', async () => {
    const res = await authed(request(app).post('/api/admin/alerts')).send({
      scope: 'STATION',
      stationId: garageA.id,
      message: 'Coming soon',
      startsAt: hoursFromNow(5),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'SCHEDULED');
    const stations = await stationsById();
    assert.equal(stations.get(garageA.id).notices.alerts.length, 0);
  });

  it('refuses an empty message, an invalid severity, and an end before the start', async () => {
    const base = { scope: 'SITE', message: 'Hello' };
    assert.equal((await authed(request(app).post('/api/admin/alerts')).send({ ...base, message: '  ' })).status, 400);
    assert.equal((await authed(request(app).post('/api/admin/alerts')).send({ ...base, severity: 'CRITICAL' })).status, 400);
    const backwards = await authed(request(app).post('/api/admin/alerts')).send({
      ...base,
      startsAt: hoursFromNow(3),
      endsAt: hoursFromNow(1),
    });
    assert.equal(backwards.status, 400);
  });
});

describe('network-wide alerts', () => {
  it('needs the installation administrator to post one', async () => {
    const refused = await authed(request(app).post('/api/admin/alerts')).send({ scope: 'NETWORK', message: 'Outage' });
    assert.equal(refused.status, 403);
  });

  it('shows the installation administrator\'s network alert on every site', async () => {
    const res = await authed(request(app).post('/api/admin/alerts'), instanceToken).send({
      scope: 'NETWORK',
      severity: 'WARNING',
      message: 'Network maintenance tonight',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.network, true);

    const here = await request(app).get('/api/notices');
    const there = await request(app).get(`/api/t/${SITE_B}/notices`);
    assert.equal(here.body.alerts[0].message, 'Network maintenance tonight');
    assert.equal(there.body.alerts[0].message, 'Network maintenance tonight');

    // A site administrator sees it, but cannot change it.
    const listed = await authed(request(app).get('/api/admin/alerts')).expect(200);
    const row = listed.body.data.find((a) => a.message === 'Network maintenance tonight');
    assert.equal(row.canEdit, false);
    const edit = await authed(request(app).put(`/api/admin/alerts/${row.id}`)).send({ message: 'Changed' });
    assert.equal(edit.status, 403);
  });
});

describe('price changes', () => {
  it('needs an end time and a percentage for a surge', async () => {
    const noEnd = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'SITE',
      percent: 25,
    });
    assert.equal(noEnd.status, 400);
    const zero = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'SITE',
      percent: 0,
      endsAt: hoursFromNow(2),
    });
    assert.equal(zero.status, 400);
    const huge = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'SITE',
      percent: 500,
      endsAt: hoursFromNow(2),
    });
    assert.equal(huge.status, 400);
  });

  it('needs no end time for complimentary charging, which runs until it is turned off', async () => {
    const res = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'COMPLIMENTARY',
      scope: 'SITE',
      label: 'Open house',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.endsAt, null);
    assert.equal(res.body.status, 'ACTIVE');
  });

  it('refuses a group or charge point that does not exist', async () => {
    const zone = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'ZONE',
      zoneId: 'no-such-zone',
      percent: 10,
      endsAt: hoursFromNow(2),
    });
    assert.equal(zone.status, 400);
    const station = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'COMPLIMENTARY',
      scope: 'STATION',
      stationId: 'no-such-station',
    });
    assert.equal(station.status, 400);
  });

  it('shows a charge point price change on that charge point, with its percentage', async () => {
    const res = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'STATION',
      stationId: garageA.id,
      percent: 50,
      label: 'Peak',
      endsAt: hoursFromNow(2),
    });
    assert.equal(res.status, 201);
    const stations = await stationsById();
    assert.deepEqual(
      stations.get(garageA.id).notices.pricing.map((p) => [p.kind, p.percent, p.label]),
      [['SURGE', 50, 'Peak']],
    );
    assert.equal(stations.get(lobbyB.id).notices.pricing.length, 0);
  });

  it('ends a running change when its end is set to now', async () => {
    const created = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'SITE',
      percent: -15,
      startsAt: new Date(Date.now() - HOUR).toISOString(),
      endsAt: hoursFromNow(2),
    });
    assert.equal(created.status, 201);
    const ended = await authed(request(app).put(`/api/admin/price-rules/${created.body.id}`)).send({
      endsAt: new Date().toISOString(),
    });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.status, 'ENDED');
  });

  it('shows a network-wide price change to every site, and refuses it to a site administrator', async () => {
    const refused = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'COMPLIMENTARY',
      scope: 'NETWORK',
    });
    assert.equal(refused.status, 403);

    const created = await authed(request(app).post('/api/admin/price-rules'), instanceToken).send({
      kind: 'COMPLIMENTARY',
      scope: 'NETWORK',
      label: 'Launch week',
    });
    assert.equal(created.status, 201);

    const here = await request(app).get('/api/notices');
    const there = await request(app).get(`/api/t/${SITE_B}/notices`);
    assert.deepEqual(here.body.pricing.map((p) => p.kind), ['COMPLIMENTARY']);
    assert.deepEqual(there.body.pricing.map((p) => p.kind), ['COMPLIMENTARY']);
  });

  it('does not let one site change another site\'s price change', async () => {
    const created = await authed(request(app).post('/api/admin/price-rules')).send({
      kind: 'SURGE',
      scope: 'SITE',
      percent: 10,
      endsAt: hoursFromNow(2),
    });
    assert.equal(created.status, 201);

    // The installation administrator working in site B: the rule from the default site does not exist there.
    const res = await request(app)
      .put(`/api/admin/price-rules/${created.body.id}`)
      .set('Authorization', `Bearer ${instanceToken}`)
      .set('X-Site', SITE_B)
      .send({ percent: 99 });
    assert.equal(res.status, 404);
    const still = await authed(request(app).get('/api/admin/price-rules')).expect(200);
    assert.equal(still.body.data.find((r) => r.id === created.body.id).percent, 10);
  });
});
