import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Stripe from 'stripe';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { setSiteSettings } from './support/siteSettings.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant } from '../src/tenancy/context.js';
import { siteConfig } from '../src/services/runtimeConfig.js';

const SITE_B = 'site-b';

async function loginAs(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
  return res.body.token;
}

// A pending Stripe charge in a site, ready to be marked paid by a webhook.
async function stripeChargeIn(tenantId) {
  return runWithTenant(tenantId, async () => {
    const station = await prisma.station.create({ data: { identity: `ST-${tenantId}`, name: `Bay ${tenantId}` } });
    const transaction = await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: `TAG-${tenantId}`,
        ocppTransactionId: 500,
        meterStart: 0,
        meterStop: 1000,
        stoppedAt: new Date(),
      },
    });
    await prisma.paymentSettings.upsert({
      where: { tenantId },
      create: { ratePerMinuteCents: 20, provider: 'STRIPE' },
      update: { provider: 'STRIPE' },
    });
    return prisma.charge.create({
      data: {
        token: `token-${tenantId}`,
        stationId: station.id,
        transactionId: transaction.id,
        idTag: `TAG-${tenantId}`,
        pricingModel: 'TIME',
        currency: 'USD',
        amountCents: 400,
        durationSeconds: 1200,
        status: 'PENDING',
      },
    });
  });
}

function stripeEvent(chargeId) {
  return JSON.stringify({
    id: 'evt_site',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_site', object: 'checkout.session', payment_status: 'paid', metadata: { chargeId } } },
  });
}

beforeEach(async () => {
  await resetDb();
  await rawPrisma.tenant.create({ data: { id: SITE_B, slug: SITE_B, name: 'Site B' } });
});

describe('per-site settings', () => {
  it('a site\'s payment keys are not visible to another site', async () => {
    await setSiteSettings({ 'stripe.secretKey': 'sk_test_only_b', 'stripe.webhookSecret': 'whsec_b' }, SITE_B);

    assert.equal(await runWithTenant(SITE_B, () => siteConfig().stripe.secretKey), 'sk_test_only_b');
    assert.equal(siteConfig().stripe.secretKey, '', 'default site has no Stripe key');

    const admin = await createAdmin({ password: 'Password123!' });
    const token = await loginAs(admin.email);
    const res = await request(app).get('/api/admin/integrations').set('Authorization', `Bearer ${token}`);
    assert.equal(res.body.secretsSet['stripe.secretKey'], false);
    assert.equal(JSON.stringify(res.body).includes('sk_test_only_b'), false);
  });

  it('the reservation window is per site', async () => {
    await setSiteSettings({ reservationWindowMinutes: 42 }, SITE_B);
    assert.equal(await runWithTenant(SITE_B, () => siteConfig().reservationWindowMinutes), 42);
    assert.equal(siteConfig().reservationWindowMinutes, 15);
  });

  it('CORS allows each site\'s own origin', async () => {
    await setSiteSettings({ corsOrigin: 'https://b.example.test' }, SITE_B);

    const b = await request(app).get('/api/health').set('Origin', 'https://b.example.test');
    assert.equal(b.headers['access-control-allow-origin'], 'https://b.example.test');

    const unknown = await request(app).get('/api/health').set('Origin', 'https://nobody.example.test');
    assert.equal(unknown.headers['access-control-allow-origin'], undefined);
  });

  it('a site\'s public URL drives its own Square webhook address', async () => {
    await setSiteSettings({ publicUrl: 'https://b.example.test' }, SITE_B);
    assert.equal(
      await runWithTenant(SITE_B, () => siteConfig().square.webhookUrl),
      'https://b.example.test/api/t/site-b/payments/square/webhook',
    );
    assert.equal(siteConfig().square.webhookUrl, 'http://localhost:4000/api/payments/square/webhook');
  });
});

describe('Stripe webhooks use the receiving site\'s secret', () => {
  it('a site\'s own endpoint accepts an event signed with its secret, and marks its charge paid', async () => {
    await setSiteSettings({ 'stripe.secretKey': 'sk_test_b', 'stripe.webhookSecret': 'whsec_site_b' }, SITE_B);
    const charge = await stripeChargeIn(SITE_B);
    const payload = stripeEvent(charge.id);
    const header = new Stripe('sk_test_b').webhooks.generateTestHeaderString({ payload, secret: 'whsec_site_b' });

    const res = await request(app)
      .post(`/api/t/${SITE_B}/payments/stripe/webhook`)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);

    assert.equal(res.status, 200);
    assert.equal((await rawPrisma.charge.findUnique({ where: { id: charge.id } })).status, 'PAID');
  });

  it('the default endpoint refuses site B\'s signature, and cannot mark site B\'s charge paid', async () => {
    await setSiteSettings({ 'stripe.secretKey': 'sk_test_b', 'stripe.webhookSecret': 'whsec_site_b' }, SITE_B);
    await setSiteSettings({ 'stripe.secretKey': 'sk_test_default', 'stripe.webhookSecret': 'whsec_default' });
    const charge = await stripeChargeIn(SITE_B);
    const payload = stripeEvent(charge.id);
    const header = new Stripe('sk_test_b').webhooks.generateTestHeaderString({ payload, secret: 'whsec_site_b' });

    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);

    assert.equal(res.status, 400);
    assert.equal((await rawPrisma.charge.findUnique({ where: { id: charge.id } })).status, 'PENDING');
  });
});
