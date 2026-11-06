import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { prisma } from '../src/db.js';
import { setSiteSettings } from './support/siteSettings.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';

const KEY = 'square-test-signature-key';
const URL_ = 'http://localhost:4000/api/payments/square/webhook';

// Square's documented scheme: base64(HMAC-SHA256(key, notificationUrl + body)).
function sign(body) {
  return createHmac('sha256', KEY).update(URL_ + body).digest('base64');
}

async function pendingSquareCharge() {
  const station = await prisma.station.create({ data: { identity: 'SQ-001', name: 'Square Bay' } });
  await prisma.transaction.create({
    data: {
      stationId: station.id,
      connectorId: 1,
      idTag: 'SQTAG000001',
      ocppTransactionId: 91,
      meterStart: 0,
      meterStop: 1000,
      startedAt: new Date(Date.now() - 10 * 60_000),
      stoppedAt: new Date(),
    },
  });
  await prisma.paymentSettings.create({ data: { ratePerMinuteCents: 30, provider: 'SQUARE' } });
  const charge = await createChargeForTransaction(station.id, 91);
  await prisma.charge.update({ where: { id: charge.id }, data: { provider: 'SQUARE', providerRef: 'order_abc' } });
  return charge;
}

describe('Square', () => {
  beforeEach(async () => {
    await resetDb();
    await setSiteSettings({
      'square.accessToken': 'EAAA-test',
      'square.locationId': 'LOC123',
      'square.webhookSignatureKey': KEY,
      'square.webhookUrl': URL_,
    });
  });

  it('rejects a webhook whose signature does not match', async () => {
    const body = JSON.stringify({ type: 'payment.updated' });
    const res = await request(app)
      .post('/api/payments/square/webhook')
      .set('Content-Type', 'application/json')
      .set('x-square-hmacsha256-signature', 'not-a-real-signature')
      .send(body);
    assert.equal(res.status, 400);
  });

  it('marks the charge paid for a correctly signed completed payment', async () => {
    const charge = await pendingSquareCharge();
    const body = JSON.stringify({
      type: 'payment.updated',
      event_id: 'evt_1',
      data: { type: 'payment', id: 'pay_1', object: { payment: { id: 'pay_1', status: 'COMPLETED', orderId: 'order_abc' } } },
    });
    const res = await request(app)
      .post('/api/payments/square/webhook')
      .set('Content-Type', 'application/json')
      .set('x-square-hmacsha256-signature', sign(body))
      .send(body);
    assert.equal(res.status, 200);
    const paid = await prisma.charge.findUnique({ where: { id: charge.id } });
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.providerRef, 'pay_1');
  });

  it('ignores signed events that are not a completed payment for a known order', async () => {
    const charge = await pendingSquareCharge();
    const body = JSON.stringify({
      type: 'payment.updated',
      data: { object: { payment: { id: 'pay_2', status: 'APPROVED', orderId: 'order_abc' } } },
    });
    await request(app)
      .post('/api/payments/square/webhook')
      .set('Content-Type', 'application/json')
      .set('x-square-hmacsha256-signature', sign(body))
      .send(body);
    assert.equal((await prisma.charge.findUnique({ where: { id: charge.id } })).status, 'PENDING');
  });

  it('refuses to start a Square payment when Square is not the active provider', async () => {
    const charge = await pendingSquareCharge();
    await prisma.paymentSettings.update({ where: { tenantId: 'default' }, data: { provider: 'NONE' } });
    const res = await request(app).post(`/api/pay/${charge.token}/square`);
    assert.equal(res.status, 409);
  });
});
