import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { DEFAULT_TENANT_ID } from '../src/tenancy/context.js';

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
    connectorCount: 1,
    ...overrides,
  });
  return res.body;
}

async function setConnectorStatus(stationId, status) {
  await prisma.connector.update({
    where: { stationId_connectorId: { stationId, connectorId: 1 } },
    data: { status },
  });
}

describe('About: help details on the public settings', () => {
  it('saves the help details and returns them with the public settings', async () => {
    const put = await authed(request(app).put('/api/admin/settings')).send({
      helpContacts: {
        emails: ['help@example.com'],
        phones: ['+1 555 123 4567'],
        contactFormUrl: 'https://example.com/contact',
      },
    });
    assert.equal(put.status, 200);

    const pub = await request(app).get('/api/settings');
    assert.deepEqual(pub.body.helpContacts, {
      emails: ['help@example.com'],
      phones: ['+1 555 123 4567'],
      contactFormUrl: 'https://example.com/contact',
    });
  });

  it('refuses an e-mail address that is not one', async () => {
    const res = await authed(request(app).put('/api/admin/settings')).send({
      helpContacts: { emails: ['help at example'], phones: [], contactFormUrl: '' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not an e-mail address/);
  });

  it('keeps the help details when the branding is saved without them', async () => {
    await authed(request(app).put('/api/admin/settings')).send({
      helpContacts: { emails: ['help@example.com'], phones: [], contactFormUrl: '' },
    });
    await authed(request(app).put('/api/admin/settings')).send({ companyName: 'Renamed Co' });

    const pub = await request(app).get('/api/settings');
    assert.equal(pub.body.companyName, 'Renamed Co');
    assert.deepEqual(pub.body.helpContacts.emails, ['help@example.com']);
  });
});

describe('Tips for a charge point', () => {
  it('stores tips and shows them on the public charge point', async () => {
    const station = await createStation({ tips: 'Behind the ticket booth, level 2.' });
    assert.equal(station.tips, 'Behind the ticket booth, level 2.');

    const pub = await request(app).get(`/api/stations/${station.id}`);
    assert.equal(pub.body.tips, 'Behind the ticket booth, level 2.');
  });

  it('shows tips for a charge point in a zone too', async () => {
    const zone = (await authed(request(app).post('/api/admin/zones')).send({ name: 'Garage' })).body;
    await authed(request(app).post('/api/admin/stations')).send({
      identity: 'CP-Z',
      name: 'Zone charger',
      connectorCount: 1,
      zoneId: zone.id,
      tips: 'Ask at the front desk.',
    });

    const zones = await request(app).get('/api/zones');
    assert.equal(zones.body[0].stations[0].tips, 'Ask at the front desk.');
  });

  it('refuses tips longer than 500 characters', async () => {
    const res = await authed(request(app).post('/api/admin/stations')).send({
      identity: 'CP-2',
      name: 'Long',
      tips: 'x'.repeat(501),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Tips must be 500 characters at most/);
  });

  it('leaves tips alone when a charge point is saved without them', async () => {
    const station = await createStation({ tips: 'Level 2, by the lift.' });
    const res = await authed(request(app).put(`/api/admin/stations/${station.id}`)).send({ name: 'Garage B' });
    assert.equal(res.status, 200);
    assert.equal(res.body.tips, 'Level 2, by the lift.');
  });

  it('clears tips when they are sent blank', async () => {
    const station = await createStation({ tips: 'Level 2, by the lift.' });
    const res = await authed(request(app).put(`/api/admin/stations/${station.id}`)).send({ tips: '  ' });
    assert.equal(res.body.tips, null);
  });
});

describe('joining with a charger free right now', () => {
  it('reports NOTIFIED on join when a connector is free, so the driver can start charging', async () => {
    const station = await createStation();
    await setConnectorStatus(station.id, 'Available');

    const res = await request(app).post(`/api/stations/${station.id}/waitlist`).send({
      name: 'Dana',
      contact: 'dana@example.com',
      licensePlate: 'ABC123',
      plateRegion: '',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'NOTIFIED');
  });

  it('reports WAITING on join when no connector is free', async () => {
    const station = await createStation();
    await setConnectorStatus(station.id, 'Charging');

    const res = await request(app).post(`/api/stations/${station.id}/waitlist`).send({
      name: 'Sam',
      contact: 'sam@example.com',
      licensePlate: 'XYZ789',
      plateRegion: '',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'WAITING');
  });
});

describe('GET /api/pricing', () => {
  it('says prices are not shown for a free site', async () => {
    const res = await request(app).get('/api/pricing');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { enabled: false });
  });

  it('gives the rate and the time window in effect now', async () => {
    const everyHour = [{ days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, rate: 40 }];
    await prisma.paymentSettings.upsert({
      where: { tenantId: DEFAULT_TENANT_ID },
      create: { tenantId: DEFAULT_TENANT_ID, pricingModel: 'TIME', currency: 'USD', ratePerMinuteCents: 25, rateSchedule: JSON.stringify(everyHour) },
      update: { pricingModel: 'TIME', currency: 'USD', ratePerMinuteCents: 25, rateSchedule: JSON.stringify(everyHour) },
    });

    const res = await request(app).get('/api/pricing');
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.baseRateCents, 25);
    assert.equal(res.body.currentRateCents, 40);
    assert.equal(res.body.windows[0].active, true);
  });
});
