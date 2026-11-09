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
let viewerToken;
let nextOcppId = 1000;

beforeEach(async () => {
  await resetDb();
  nextOcppId = 1000;
  await prisma.paymentSettings.create({ data: { ratePerMinuteCents: 25 } });
  await createAdmin({ email: 'ops@example.test', password: PASSWORD });
  const viewer = await createAdmin({ email: 'viewer@example.test', password: PASSWORD });
  await prisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
  token = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
  viewerToken = (await request(app).post('/api/auth/login').send({ email: 'viewer@example.test', password: PASSWORD })).body.token;
});

const authed = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

// A stopped 10-minute session at a charge point, billed at 25 cents a minute (250 cents before tax).
async function finishedSession({ identity = `CP-${nextOcppId}`, zoneId = null } = {}) {
  const station = await prisma.station.create({ data: { identity, name: `Bay ${identity}`, zoneId } });
  const ocppTransactionId = nextOcppId++;
  await prisma.transaction.create({
    data: {
      stationId: station.id,
      connectorId: 1,
      idTag: `TAG${ocppTransactionId}`,
      ocppTransactionId,
      meterStart: 0,
      meterStop: 2000,
      startedAt: new Date(Date.now() - 10 * 60_000),
      stoppedAt: new Date(),
    },
  });
  return { station, charge: await createChargeForTransaction(station.id, ocppTransactionId) };
}

// A session that is paid, so it can be receipted and invoiced.
async function paidSession(options) {
  const { charge } = await finishedSession(options);
  await markChargePaid(charge.id, { provider: 'MANUAL', providerRef: `ref-${charge.id}` });
  return prisma.charge.findUnique({ where: { id: charge.id } });
}

const salesTax = (overrides = {}) => ({
  name: 'Sales tax',
  jurisdiction: 'Demo State',
  rateBasisPoints: 2000,
  mode: 'EXCLUSIVE',
  appliesTo: 'ALL',
  ...overrides,
});

describe('tax rules and the charge', () => {
  it('adds exclusive tax to a session and records the split on the charge', async () => {
    const created = await authed(request(app).post('/api/admin/tax-rules')).send(salesTax());
    assert.equal(created.status, 201);
    assert.equal(created.body.rateBasisPoints, 2000);

    const { charge } = await finishedSession();
    assert.equal(charge.netCents, 250);
    assert.equal(charge.taxCents, 50);
    assert.equal(charge.amountCents, 300, 'the driver is asked for the total, tax included');
    const lines = JSON.parse(charge.taxJson);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].name, 'Sales tax');
    assert.equal(lines[0].taxCents, 50);
  });

  it('takes inclusive tax out of the price, so the total stays the same', async () => {
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax({ mode: 'INCLUSIVE' }));
    const { charge } = await finishedSession();
    // 250 includes 20%: the tax is 250 * 2000 / 12000 = 41.67, rounded to 42, leaving 208 net.
    assert.equal(charge.amountCents, 250);
    assert.equal(charge.taxCents, 42);
    assert.equal(charge.netCents, 208);
  });

  it('applies a zone rule only to charge points in that zone', async () => {
    const zone = await prisma.zone.create({ data: { name: 'Level 2' } });
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax({ scope: 'ZONE', zoneId: zone.id }));
    const inZone = await finishedSession({ zoneId: zone.id });
    const outside = await finishedSession();
    assert.equal(inZone.charge.taxCents, 50);
    assert.equal(outside.charge.taxCents, 0);
  });

  it('applies a time-only rule to time-priced sessions, and an energy-only rule to none of them', async () => {
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax({ appliesTo: 'TIME' }));
    const { charge } = await finishedSession();
    assert.equal(charge.pricingModel, 'TIME');
    assert.equal(charge.taxCents, 50);
    await prisma.taxRule.deleteMany();
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax({ appliesTo: 'ENERGY' }));
    const next = await finishedSession();
    assert.equal(next.charge.taxCents, 0);
  });

  it('previews the tax a price would get, before any driver is charged', async () => {
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax());
    const res = await authed(request(app).get('/api/admin/tax-rules/preview'))
      .query({ priceCents: 1000, pricingModel: 'ENERGY' });
    assert.equal(res.status, 200);
    assert.equal(res.body.taxCents, 200);
    assert.equal(res.body.grossCents, 1200);
    assert.equal(res.body.rulesApplied.length, 1);
  });

  it('refuses a bad rule with a message, and a zone rule with no zone', async () => {
    const badRate = await authed(request(app).post('/api/admin/tax-rules')).send(salesTax({ rateBasisPoints: 99999 }));
    assert.equal(badRate.status, 400);
    const noZone = await authed(request(app).post('/api/admin/tax-rules')).send(salesTax({ scope: 'ZONE' }));
    assert.equal(noZone.status, 400);
    assert.match(noZone.body.error, /zone/);
  });

  it('lets a viewer read tax rules but not change them', async () => {
    const read = await authed(request(app).get('/api/admin/tax-rules'), viewerToken);
    assert.equal(read.status, 403, 'viewers have no payments access');
    const write = await authed(request(app).post('/api/admin/tax-rules'), viewerToken).send(salesTax());
    assert.equal(write.status, 403);
  });
});

describe('receipts', () => {
  it('issues a numbered receipt when a charge is paid, and serves it by the charge link', async () => {
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax());
    const charge = await paidSession();
    const receipt = await prisma.receipt.findUnique({ where: { chargeId: charge.id } });
    assert.ok(receipt, 'a receipt exists');
    assert.match(receipt.number, /^RCP-\d{4}-00001$/);
    assert.equal(receipt.netCents, 250);
    assert.equal(receipt.taxCents, 50);
    assert.equal(receipt.totalCents, 300);

    const page = await request(app).get(`/api/receipts/${charge.token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Receipt/);
    assert.match(page.text, new RegExp(receipt.number));
    assert.match(page.text, /Sales tax/);
  });

  it('numbers receipts in order, one per charge, with no gaps', async () => {
    const first = await paidSession();
    const second = await paidSession();
    const a = await prisma.receipt.findUnique({ where: { chargeId: first.id } });
    const b = await prisma.receipt.findUnique({ where: { chargeId: second.id } });
    assert.equal(a.number.slice(-5), '00001');
    assert.equal(b.number.slice(-5), '00002');
  });

  it('does not issue a receipt for a charge that is still unpaid, and says so on its link', async () => {
    const { charge } = await finishedSession();
    assert.equal(await prisma.receipt.findUnique({ where: { chargeId: charge.id } }), null);
    const res = await request(app).get(`/api/receipts/${charge.token}`);
    assert.equal(res.status, 404);
    assert.match(res.text, /not been issued/);
    assert.equal((await request(app).get('/api/receipts/not-a-real-token')).status, 404);
  });

  it('escapes the text it prints', async () => {
    const station = await prisma.station.create({ data: { identity: 'CP-XSS', name: '<img src=x onerror=alert(1)>' } });
    await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: 'TAGX',
        ocppTransactionId: 9001,
        meterStart: 0,
        meterStop: 1000,
        startedAt: new Date(Date.now() - 5 * 60_000),
        stoppedAt: new Date(),
      },
    });
    const charge = await createChargeForTransaction(station.id, 9001);
    await markChargePaid(charge.id, { provider: 'MANUAL', providerRef: 'x' });
    const res = await request(app).get(`/api/receipts/${charge.token}`);
    assert.ok(!res.text.includes('<img src=x'), 'raw markup is not printed');
    assert.match(res.text, /&lt;img src=x/);
  });
});

describe('B2B invoices and credit notes', () => {
  let customer;

  beforeEach(async () => {
    const created = await authed(request(app).post('/api/admin/billing/customers')).send({
      name: 'Acme <b>Fleet</b>',
      taxId: 'GB123456789',
      email: 'ap@acme.example',
    });
    assert.equal(created.status, 201);
    customer = created.body;
    await authed(request(app).put('/api/admin/billing/settings')).send({
      legalName: 'Plugyard Charging Ltd',
      taxId: 'GB999',
      invoicePrefix: 'ACME',
      paymentTermsDays: 14,
    });
    await authed(request(app).post('/api/admin/tax-rules')).send(salesTax());
  });

  it('invoices paid charges for a customer, with totals taken from the charges', async () => {
    const a = await paidSession();
    const b = await paidSession();
    const available = await authed(request(app).get('/api/admin/billing/uninvoiced-charges'));
    assert.deepEqual(available.body.data.map((c) => c.id).sort(), [a.id, b.id].sort());

    const res = await authed(request(app).post('/api/admin/billing/invoices')).send({
      customerId: customer.id,
      chargeIds: [a.id, b.id],
    });
    assert.equal(res.status, 201);
    assert.match(res.body.number, /^ACME-\d{4}-00001$/);
    assert.equal(res.body.netCents, 500);
    assert.equal(res.body.taxCents, 100);
    assert.equal(res.body.totalCents, 600);
    assert.equal(res.body.status, 'ISSUED');
    assert.ok(res.body.dueAt, 'payment terms set a due date');

    const detail = await authed(request(app).get(`/api/admin/billing/invoices/${res.body.id}`));
    assert.equal(detail.body.lines.length, 2);
    assert.equal(detail.body.lines[0].taxes[0].name, 'Sales tax');

    const after = await authed(request(app).get('/api/admin/billing/uninvoiced-charges'));
    assert.equal(after.body.data.length, 0, 'invoiced charges leave the list');
  });

  it('refuses to invoice a charge twice, and refuses unpaid charges', async () => {
    const paid = await paidSession();
    const first = await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.id, chargeIds: [paid.id] });
    assert.equal(first.status, 201);
    const again = await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.id, chargeIds: [paid.id] });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /already on an invoice/);

    const { charge: unpaid } = await finishedSession();
    const refused = await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.id, chargeIds: [unpaid.id] });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Only paid charges/);
  });

  it('renders the invoice as a page with the customer name escaped', async () => {
    const paid = await paidSession();
    const inv = await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.id, chargeIds: [paid.id] });
    const page = await authed(request(app).get(`/api/admin/billing/invoices/${inv.body.id}/document`));
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(inv.body.number));
    assert.match(page.text, /Plugyard Charging Ltd/);
    assert.match(page.text, /Acme &lt;b&gt;Fleet&lt;\/b&gt;/);
    assert.ok(!page.text.includes('<b>Fleet</b>'));
  });

  it('credits an invoice once, with negative amounts, and records payment', async () => {
    const paid = await paidSession();
    const inv = await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.id, chargeIds: [paid.id] });

    const paidRes = await authed(request(app).post(`/api/admin/billing/invoices/${inv.body.id}/mark-paid`));
    assert.equal(paidRes.body.status, 'PAID');

    const credit = await authed(request(app).post(`/api/admin/billing/invoices/${inv.body.id}/credit-note`));
    assert.equal(credit.status, 201);
    assert.equal(credit.body.kind, 'CREDIT_NOTE');
    assert.equal(credit.body.totalCents, -inv.body.totalCents);
    assert.equal(credit.body.creditsInvoiceId, inv.body.id);
    assert.match(credit.body.number, /^CN-\d{4}-00001$/);

    const second = await authed(request(app).post(`/api/admin/billing/invoices/${inv.body.id}/credit-note`));
    assert.equal(second.status, 400);
    assert.match(second.body.error, /already has a credit note/);

    const notPayable = await authed(request(app).post(`/api/admin/billing/invoices/${credit.body.id}/mark-paid`));
    assert.equal(notPayable.status, 400);
  });

  it('will not delete a customer who has invoices', async () => {
    const paid = await paidSession();
    await authed(request(app).post('/api/admin/billing/invoices')).send({ customerId: customer.id, chargeIds: [paid.id] });
    const res = await authed(request(app).delete(`/api/admin/billing/customers/${customer.id}`));
    assert.equal(res.status, 409);
  });

  it('checks the number prefix and payment terms in the settings', async () => {
    const bad = await authed(request(app).put('/api/admin/billing/settings')).send({ invoicePrefix: 'acme-2' });
    assert.equal(bad.status, 400);
    const terms = await authed(request(app).put('/api/admin/billing/settings')).send({ paymentTermsDays: -1 });
    assert.equal(terms.status, 400);
  });
});
