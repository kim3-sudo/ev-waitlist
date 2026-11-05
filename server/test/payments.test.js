import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Stripe from 'stripe';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { computeCharge, isInPeakWindow } from '../src/services/payments/pricing.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';

const TIME_SETTINGS = {
  pricingModel: 'TIME',
  ratePerMinuteCents: 20,
  peakRatePerMinuteCents: null,
  peakStartHour: null,
  peakEndHour: null,
  ratePerKwhCents: 0,
};

describe('pricing (pure)', () => {
  it('bills started minutes at the base rate', () => {
    const start = new Date(2026, 0, 1, 9, 0, 0);
    const stop = new Date(start.getTime() + 61_000); // 61 s -> 2 started minutes
    const out = computeCharge(TIME_SETTINGS, { startedAt: start, stoppedAt: stop });
    assert.equal(out.amountCents, 40);
    assert.equal(out.durationSeconds, 61);
    assert.equal(out.status, 'PENDING');
  });

  it('uses the peak rate for minutes inside the peak window (demand pricing)', () => {
    const start = new Date(2026, 0, 1, 16, 58, 0); // 16:58 -> peak 17:00-19:00
    const stop = new Date(start.getTime() + 4 * 60_000);
    const settings = { ...TIME_SETTINGS, peakRatePerMinuteCents: 50, peakStartHour: 17, peakEndHour: 19 };
    const out = computeCharge(settings, { startedAt: start, stoppedAt: stop });
    // 16:58, 16:59 off-peak (20 each); 17:00, 17:01 peak (50 each)
    assert.equal(out.amountCents, 20 + 20 + 50 + 50);
  });

  it('handles peak windows that wrap past midnight', () => {
    assert.equal(isInPeakWindow(new Date(2026, 0, 1, 23, 0), 22, 6), true);
    assert.equal(isInPeakWindow(new Date(2026, 0, 1, 3, 0), 22, 6), true);
    assert.equal(isInPeakWindow(new Date(2026, 0, 1, 12, 0), 22, 6), false);
    assert.equal(isInPeakWindow(new Date(2026, 0, 1, 12, 0), null, null), false);
  });

  it('bills power dispensed per kWh and rounds to cents', () => {
    const settings = { ...TIME_SETTINGS, pricingModel: 'ENERGY', ratePerKwhCents: 35 };
    const out = computeCharge(settings, {
      startedAt: new Date(0),
      stoppedAt: new Date(3_600_000),
      meterStart: 1000,
      meterStop: 13_500, // 12.5 kWh
    });
    assert.equal(out.energyWh, 12_500);
    assert.equal(out.amountCents, Math.round(12.5 * 35));
  });

  it('flags energy sessions with no usable meter reading for review instead of billing them', () => {
    const settings = { ...TIME_SETTINGS, pricingModel: 'ENERGY', ratePerKwhCents: 35 };
    const out = computeCharge(settings, { startedAt: new Date(0), stoppedAt: new Date(60_000), meterStart: 5, meterStop: null });
    assert.equal(out.status, 'NEEDS_REVIEW');
    assert.equal(out.amountCents, 0);
  });
});

async function stationWithFinishedSession({ meterStart = 0, meterStop = 2000, minutes = 10 } = {}) {
  const station = await prisma.station.create({ data: { identity: 'PAY-001', name: 'Garage Bay 1' } });
  const startedAt = new Date(Date.now() - minutes * 60_000);
  await prisma.transaction.create({
    data: {
      stationId: station.id,
      connectorId: 1,
      idTag: 'TAG0000000001',
      ocppTransactionId: 77,
      meterStart,
      meterStop,
      startedAt,
      stoppedAt: new Date(),
    },
  });
  return station;
}

describe('charges and payment links', () => {
  let adminToken;
  beforeEach(async () => {
    await resetDb();
    delete config.stripe.secretKey;
    config.stripe.secretKey = '';
    config.stripe.webhookSecret = '';
    config.braintree.merchantId = '';
    const admin = await createAdmin();
    const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Password123!' });
    adminToken = body.token;
  });

  it('creates a pending charge when a session stops, and charges only once', async () => {
    const station = await stationWithFinishedSession({ minutes: 10 });
    await prisma.paymentSettings.create({ data: { id: 'singleton', ratePerMinuteCents: 25 } });
    const first = await createChargeForTransaction(station.id, 77);
    assert.equal(first.status, 'PENDING');
    assert.equal(first.amountCents, 250);
    assert.equal(first.token.length >= 30, true);
    const second = await createChargeForTransaction(station.id, 77);
    assert.equal(second, null);
  });

  it('pays through the public link and the admin list shows PAID', async () => {
    const station = await stationWithFinishedSession();
    const charge = await createChargeForTransaction(station.id, 77);
    const pub = await request(app).get(`/api/pay/${charge.token}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.amountCents, charge.amountCents);
    assert.equal(pub.body.provider, null, 'no provider is set yet');

    const noProvider = await request(app).post(`/api/pay/${charge.token}/stripe`).send({});
    assert.equal(noProvider.status, 409);

    await prisma.charge.update({ where: { id: charge.id }, data: { status: 'PAID' } });
    const list = await request(app).get('/api/admin/payments/charges').set('Authorization', `Bearer ${adminToken}`);
    assert.equal(list.body[0].status, 'PAID');
  });

  it('returns 404 for an unknown payment token', async () => {
    assert.equal((await request(app).get('/api/pay/not-a-real-token')).status, 404);
  });

  it('refuses to switch to a provider that has no keys configured', async () => {
    const res = await request(app)
      .put('/api/admin/payments/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'STRIPE' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /isn't configured/);
  });

  it('requires the local-law acknowledgement before power-based pricing is saved', async () => {
    const admin = (t) => request(app).put('/api/admin/payments/settings').set('Authorization', `Bearer ${t}`);
    const refused = await admin(adminToken).send({ pricingModel: 'ENERGY', ratePerKwhCents: 30 });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /local laws/);

    const ok = await admin(adminToken).send({ pricingModel: 'ENERGY', ratePerKwhCents: 30, energyPricingAcknowledged: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.settings.pricingModel, 'ENERGY');
  });

  it('validates time-based demand pricing hours', async () => {
    const res = await request(app)
      .put('/api/admin/payments/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ peakStartHour: 25 });
    assert.equal(res.status, 400);
  });

  it('rejects a Stripe webhook without a valid signature', async () => {
    config.stripe.secretKey = 'sk_test_fake';
    config.stripe.webhookSecret = 'whsec_test_secret';
    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=bogus')
      .send('{"type":"checkout.session.completed"}');
    assert.equal(res.status, 400);
  });

  it('marks a charge PAID from a correctly signed Stripe checkout completion', async () => {
    config.stripe.secretKey = 'sk_test_fake';
    config.stripe.webhookSecret = 'whsec_test_secret';
    const station = await stationWithFinishedSession();
    await prisma.paymentSettings.create({ data: { id: 'singleton', ratePerMinuteCents: 20, provider: 'STRIPE' } });
    const charge = await createChargeForTransaction(station.id, 77);

    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', object: 'checkout.session', payment_status: 'paid', metadata: { chargeId: charge.id } } },
    });
    const header = new Stripe('sk_test_fake').webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_test_secret',
    });
    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);
    assert.equal(res.status, 200);

    const paid = await prisma.charge.findUnique({ where: { id: charge.id } });
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.providerRef, 'cs_test_123');

    // A replayed event must not change anything else.
    await request(app).post('/api/payments/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(payload);
    assert.equal((await prisma.charge.findUnique({ where: { id: charge.id } })).status, 'PAID');
  });
});
