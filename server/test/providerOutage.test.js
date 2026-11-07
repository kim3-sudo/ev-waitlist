import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { setSiteSettings } from './support/siteSettings.js';
import { prisma, rawPrisma } from '../src/db.js';
import {
  checkAllSites,
  checkProviderNow,
  currentOutage,
  lockedOut,
  LOCKOUT_MESSAGE,
  resetProviderOutagesForTests,
  setProviderProbeForTests,
} from '../src/services/payments/providerOutage.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';
import { onConnectorFreed } from '../src/services/dispatcher.js';

// A payment provider that stops answering: its health check fails until the test turns it back on.
// Nothing here calls a real provider.

const PASSWORD = 'CorrectHorse1!';
const MINUTE = 60_000;

let providerDown = false;
let token;
let station;

async function setMode(mode) {
  await prisma.paymentSettings.update({ where: { tenantId: 'default' }, data: { providerOutageMode: mode } });
}

// Two failed checks in a row open an outage. A successful check ends it.
async function breakProvider() {
  providerDown = true;
  await checkProviderNow();
  await checkProviderNow();
}
async function restoreProvider() {
  providerDown = false;
  await checkProviderNow();
}

const authed = (req) => req.set('Authorization', `Bearer ${token}`);

beforeEach(async () => {
  await resetDb();
  resetProviderOutagesForTests();
  providerDown = false;
  setProviderProbeForTests(async () => {
    if (providerDown) throw new Error('Stripe is not responding (503)');
  });

  await setSiteSettings({ 'stripe.secretKey': 'sk_test_fake', 'stripe.webhookSecret': 'whsec_fake' });
  await prisma.paymentSettings.upsert({
    where: { tenantId: 'default' },
    create: { tenantId: 'default', pricingModel: 'TIME', ratePerMinuteCents: 10, provider: 'STRIPE', rateSchedule: '[]' },
    update: { pricingModel: 'TIME', ratePerMinuteCents: 10, provider: 'STRIPE', rateSchedule: '[]', providerOutageMode: 'LOCKOUT' },
  });

  const admin = await createAdmin({ password: PASSWORD });
  token = (await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD })).body.token;

  station = await prisma.station.create({ data: { identity: 'CP-OUT', name: 'Charger O', location: 'Lot' } });
  await prisma.connector.create({ data: { stationId: station.id, connectorId: 1, status: 'Available' } });
});

describe('detecting an outage', () => {
  it('needs two failed checks in a row, and a successful check ends the outage', async () => {
    providerDown = true;
    await checkProviderNow();
    assert.equal(await currentOutage(), null, 'one failed check is not an outage');

    await checkProviderNow();
    const open = await currentOutage();
    assert.equal(open.provider, 'STRIPE');
    assert.match(open.reason, /503/);

    await restoreProvider();
    assert.equal(await currentOutage(), null);
    const row = await rawPrisma.providerOutage.findFirst({ where: { tenantId: 'default' } });
    assert.ok(row.endedAt, 'the outage is kept, with its end time');
  });

  it('never opens an outage for a site with no payment provider', async () => {
    await prisma.paymentSettings.update({ where: { tenantId: 'default' }, data: { provider: 'NONE' } });
    await breakProvider();
    assert.equal(await currentOutage(), null);
  });

  it('reports the recovery to the caller, so held connectors can be offered again', async () => {
    await breakProvider();
    const recovered = [];
    providerDown = false;
    await checkAllSites(async (tenantId) => recovered.push(tenantId));
    assert.deepEqual(recovered, ['default']);
  });
});

describe('lockout mode', () => {
  beforeEach(async () => {
    await setMode('LOCKOUT');
  });

  it('refuses new waitlist joins until the provider recovers', async () => {
    await breakProvider();
    assert.equal(await lockedOut(), true);

    const body = { name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'US-CA' };
    const refused = await request(app).post(`/api/stations/${station.id}/waitlist`).send(body);
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error, LOCKOUT_MESSAGE);

    await restoreProvider();
    assert.equal(await lockedOut(), false);
    const accepted = await request(app).post(`/api/stations/${station.id}/waitlist`).send(body);
    assert.equal(accepted.status, 201);
  });

  it('offers no connector to anyone waiting during the outage, and offers again after it', async () => {
    await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Dana', contact: 'dana@example.com', idTag: 'TAG-LOCK', position: 1 },
    });
    await breakProvider();

    await onConnectorFreed(station.id, 1);
    assert.equal(await prisma.reservation.count(), 0, 'no hold while locked out');

    await restoreProvider();
    await onConnectorFreed(station.id, 1);
    assert.equal(await prisma.reservation.count(), 1, 'the connector is offered once the provider is back');
  });

  it('does not change what a session that is already under way costs', async () => {
    await breakProvider();
    const now = Date.now();
    await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: 'TAG-UNDER-WAY',
        ocppTransactionId: 1,
        startedAt: new Date(now - 10 * MINUTE),
        stoppedAt: new Date(now),
      },
    });
    const charge = await createChargeForTransaction(station.id, 1);
    assert.equal(charge.amountCents, 100);
    assert.equal(charge.pricingNote, null);
  });
});

describe('complimentary mode', () => {
  beforeEach(async () => {
    await setMode('COMPLIMENTARY');
  });

  it('keeps joins open, and makes a session that overlaps the outage free', async () => {
    await breakProvider();
    assert.equal(await lockedOut(), false);

    // A session that starts during the outage: each minute that starts inside it is free.
    const outageStart = (await currentOutage()).startedAt.getTime();
    await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: 'TAG-FREE',
        ocppTransactionId: 2,
        startedAt: new Date(outageStart),
        stoppedAt: new Date(outageStart + 10 * MINUTE),
      },
    });
    const charge = await createChargeForTransaction(station.id, 2);
    assert.equal(charge.amountCents, 0);
    assert.equal(charge.status, 'NO_CHARGE');
    assert.equal(charge.pricingNote, 'Complimentary charging (Payment system unavailable)');

    const joined = await request(app)
      .post(`/api/stations/${station.id}/waitlist`)
      .send({ name: 'Dana', contact: 'dana@example.com', licensePlate: 'ABC123', plateRegion: 'US-CA' });
    assert.equal(joined.status, 201);
  });

  it('charges a session that ended before the outage started as usual', async () => {
    await breakProvider();
    const outageStart = (await currentOutage()).startedAt.getTime();
    await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: 'TAG-BEFORE',
        ocppTransactionId: 3,
        startedAt: new Date(outageStart - 40 * MINUTE),
        stoppedAt: new Date(outageStart - 30 * MINUTE),
      },
    });
    const charge = await createChargeForTransaction(station.id, 3);
    assert.equal(charge.amountCents, 100);
  });
});

describe('the admin choice and what drivers see', () => {
  it('saves the mode, and refuses anything else', async () => {
    const bad = await authed(request(app).put('/api/admin/integrations/outage-mode')).send({ mode: 'FREE_FOR_ALL' });
    assert.equal(bad.status, 400);

    const saved = await authed(request(app).put('/api/admin/integrations/outage-mode')).send({ mode: 'COMPLIMENTARY' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.providerOutage.mode, 'COMPLIMENTARY');
    assert.equal(saved.body.providerOutage.current, null);

    const read = await authed(request(app).get('/api/admin/integrations'));
    assert.equal(read.body.providerOutage.mode, 'COMPLIMENTARY');
  });

  it('shows the admin the open outage', async () => {
    await breakProvider();
    const read = await authed(request(app).get('/api/admin/integrations'));
    assert.equal(read.body.providerOutage.current.provider, 'STRIPE');
    assert.match(read.body.providerOutage.current.reason, /503/);
  });

  it('tells drivers about an open outage on the public notices, and stops when it ends', async () => {
    await setMode('COMPLIMENTARY');
    assert.equal((await request(app).get('/api/notices')).body.paymentOutage, null);

    await breakProvider();
    const during = (await request(app).get('/api/notices')).body.paymentOutage;
    assert.equal(during.mode, 'COMPLIMENTARY');

    await restoreProvider();
    assert.equal((await request(app).get('/api/notices')).body.paymentOutage, null);
  });
});
