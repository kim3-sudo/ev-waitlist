import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { createChargeForTransaction, markChargePaid } from '../src/services/payments/chargeService.js';

const PASSWORD = 'Password123!';
let token;
let nextOcppId = 3000;

beforeEach(async () => {
  await resetDb();
  nextOcppId = 3000;
  await prisma.paymentSettings.create({ data: { ratePerMinuteCents: 25 } });
  await createAdmin({ email: 'ops@example.test', password: PASSWORD });
  token = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
});

const authed = (req) => req.set('Authorization', `Bearer ${token}`);

// A stopped 10-minute session billed at 25 cents a minute (250 cents before any discount or tax).
async function finishedSession({ idTag = `TAG${nextOcppId}`, identity = `CP-${nextOcppId}` } = {}) {
  const station = await prisma.station.create({ data: { identity, name: `Bay ${identity}` } });
  const ocppTransactionId = nextOcppId++;
  await prisma.transaction.create({
    data: {
      stationId: station.id,
      connectorId: 1,
      idTag,
      ocppTransactionId,
      meterStart: 0,
      meterStop: 2000,
      startedAt: new Date(Date.now() - 10 * 60_000),
      stoppedAt: new Date(),
    },
  });
  return createChargeForTransaction(station.id, ocppTransactionId);
}

async function paidSession(options) {
  const charge = await finishedSession(options);
  await markChargePaid(charge.id, { provider: 'MANUAL', providerRef: `ref-${charge.id}` });
  return prisma.charge.findUnique({ where: { id: charge.id } });
}

describe('charging plans', () => {
  it('discounts a subscriber\'s session, and only while the plan is active', async () => {
    const plan = await authed(request(app).post('/api/admin/subscriptions/plans')).send({ name: 'Gold', monthlyFeeCents: 2000, discountPercent: 10 });
    assert.equal(plan.status, 201);
    assert.equal(plan.body.currency, 'USD');
    const sub = await authed(request(app).post('/api/admin/subscriptions/subscriptions')).send({ planId: plan.body.id, idTag: 'SUB-TAG' });
    assert.equal(sub.status, 201);

    const discounted = await finishedSession({ idTag: 'SUB-TAG' });
    assert.equal(discounted.discountCents, 25, '10% of 250 cents');
    assert.equal(discounted.amountCents, 225);
    assert.equal(discounted.subscriptionId, sub.body.id);

    const other = await finishedSession({ idTag: 'NOT-A-SUBSCRIBER' });
    assert.equal(other.discountCents, 0);
    assert.equal(other.amountCents, 250);

    await authed(request(app).post(`/api/admin/subscriptions/subscriptions/${sub.body.id}/cancel`));
    const after = await finishedSession({ idTag: 'SUB-TAG' });
    assert.equal(after.discountCents, 0, 'a cancelled subscription gives no discount');
  });

  it('refuses a second active plan for the same ID tag, and a plan with subscribers cannot be deleted', async () => {
    const plan = await authed(request(app).post('/api/admin/subscriptions/plans')).send({ name: 'Basic', discountPercent: 5 });
    await authed(request(app).post('/api/admin/subscriptions/subscriptions')).send({ planId: plan.body.id, idTag: 'DUP' });
    const again = await authed(request(app).post('/api/admin/subscriptions/subscriptions')).send({ planId: plan.body.id, idTag: 'DUP' });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /already has an active plan/);
    const del = await authed(request(app).delete(`/api/admin/subscriptions/plans/${plan.body.id}`));
    assert.equal(del.status, 409);
  });

  it('bills each plan fee once a month, to the subscriber\'s billing customer', async () => {
    const customer = await authed(request(app).post('/api/admin/billing/customers')).send({ name: 'Fleet Co', taxId: '' });
    const plan = await authed(request(app).post('/api/admin/subscriptions/plans')).send({ name: 'Fleet', monthlyFeeCents: 4000, discountPercent: 0 });
    await authed(request(app).post('/api/admin/subscriptions/subscriptions')).send({ planId: plan.body.id, idTag: 'FLEET-1', billingCustomerId: customer.body.id });

    const first = await authed(request(app).post('/api/admin/subscriptions/bill')).send({ period: '2026-11' });
    assert.equal(first.status, 200);
    assert.equal(first.body.invoicesIssued, 1);
    assert.equal(first.body.invoices[0].totalCents, 4000);

    const again = await authed(request(app).post('/api/admin/subscriptions/bill')).send({ period: '2026-11' });
    assert.equal(again.body.invoicesIssued, 0, 'the same month is not billed twice');

    const nextMonth = await authed(request(app).post('/api/admin/subscriptions/bill')).send({ period: '2026-12' });
    assert.equal(nextMonth.body.invoicesIssued, 1);

    const bad = await authed(request(app).post('/api/admin/subscriptions/bill')).send({ period: 'November' });
    assert.equal(bad.status, 400);
  });
});

describe('reversing a charge', () => {
  it('reverses a paid charge with a reason, and refuses it twice or without a reason', async () => {
    const charge = await paidSession();
    const noReason = await authed(request(app).post(`/api/admin/billing/charges/${charge.id}/reverse`)).send({});
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.error, /Say why/);

    const done = await authed(request(app).post(`/api/admin/billing/charges/${charge.id}/reverse`)).send({ reason: 'Charged twice' });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'REVERSED');
    assert.match(done.body.message, /Refund the payment/);

    const again = await authed(request(app).post(`/api/admin/billing/charges/${charge.id}/reverse`)).send({ reason: 'again' });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /already reversed/);

    const stored = await prisma.charge.findUnique({ where: { id: charge.id } });
    assert.equal(stored.reversalReason, 'Charged twice');
    assert.ok(stored.reversedAt);
  });

  it('tells the admin when the charge is on an invoice, so the invoice is credited too', async () => {
    const charge = await paidSession();
    const customer = await authed(request(app).post('/api/admin/billing/customers')).send({ name: 'Acme' });
    await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.body.id, chargeIds: [charge.id] });
    const done = await authed(request(app).post(`/api/admin/billing/charges/${charge.id}/reverse`)).send({ reason: 'Refund agreed' });
    assert.equal(done.body.onInvoice, true);
    assert.match(done.body.message, /credit note/);
  });

  it('keeps a reversed charge off the invoice list, and prints the reversal on its receipt', async () => {
    const charge = await paidSession();
    await authed(request(app).post(`/api/admin/billing/charges/${charge.id}/reverse`)).send({ reason: 'Wrong price' });
    const list = await authed(request(app).get('/api/admin/billing/uninvoiced-charges'));
    assert.equal(list.body.data.length, 0);
    const page = await request(app).get(`/api/receipts/${charge.token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Reversed on/);
    assert.match(page.text, /Wrong price/);
  });
});

describe('tax exemption and e-mail', () => {
  it('invoices a tax-exempt business without tax, and states the exemption reference', async () => {
    await authed(request(app).post('/api/admin/tax-rules')).send({ name: 'VAT', rateBasisPoints: 2000, mode: 'EXCLUSIVE', appliesTo: 'ALL' });
    const charge = await paidSession();
    assert.equal(charge.taxCents, 50, 'the session itself was taxed at the till');

    const customer = await authed(request(app).post('/api/admin/billing/customers')).send({
      name: 'Charity Ltd',
      taxExempt: true,
      exemptionReference: 'EX-2026-17',
    });
    assert.equal(customer.body.taxExempt, true);
    const inv = await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.body.id, chargeIds: [charge.id] });
    assert.equal(inv.status, 201);
    assert.equal(inv.body.taxCents, 0);
    assert.equal(inv.body.totalCents, 250);
    const page = await authed(request(app).get(`/api/admin/billing/invoices/${inv.body.id}/document`));
    assert.match(page.text, /Tax exempt: EX-2026-17/);
  });

  it('refuses to switch e-mail receipts or invoices on while e-mail is not set up', async () => {
    const res = await authed(request(app).put('/api/admin/billing/settings')).send({ emailReceipts: true });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /E-mail is not set up/);
    const off = await authed(request(app).put('/api/admin/billing/settings')).send({ emailReceipts: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.emailAvailable, false);
  });
});
