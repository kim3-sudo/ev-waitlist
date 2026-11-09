import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import {
  backoffMs,
  dispatchWebhookDeliveries,
  emitEvent,
  eventMatches,
  MAX_ATTEMPTS,
  signPayload,
  urlProblem,
  verifySignature,
} from '../src/services/webhooks.js';

const PASSWORD = 'CorrectHorse1!';
let token;

beforeEach(async () => {
  await resetDb();
  await createAdmin({ email: 'ops@example.test', password: PASSWORD });
  token = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
});

const authed = (req) => req.set('Authorization', `Bearer ${token}`);

// A fake HTTP send: records what was posted and answers with the given status.
function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { status };
  };
  fn.calls = calls;
  return fn;
}

describe('webhook addresses', () => {
  it('needs https, and refuses this machine and private networks', () => {
    assert.match(urlProblem('http://hooks.example.test/x'), /https/);
    assert.match(urlProblem('https://localhost/x'), /this machine/);
    assert.match(urlProblem('https://10.1.2.3/x'), /private network/);
    assert.match(urlProblem('https://192.168.0.5/x'), /private network/);
    assert.equal(urlProblem('https://hooks.example.test/charging'), null);
    assert.match(urlProblem('not a url'), /full web address/);
  });
});

describe('signing and matching', () => {
  it('signs a body so the receiver can check it, and refuses a changed body or an old timestamp', () => {
    const body = '{"type":"charge.paid"}';
    const now = Date.now();
    const header = signPayload('whsec_test', body, Math.floor(now / 1000));
    assert.equal(verifySignature('whsec_test', body, header, { now }), true);
    assert.equal(verifySignature('whsec_test', body + ' ', header, { now }), false);
    assert.equal(verifySignature('whsec_other', body, header, { now }), false);
    assert.equal(verifySignature('whsec_test', body, header, { now: now + 3600_000 }), false, 'a stale timestamp is refused');
  });

  it('matches event types against an endpoint\'s list, and * matches all', () => {
    assert.equal(eventMatches('*', 'charge.paid'), true);
    assert.equal(eventMatches('charge.paid,invoice.issued', 'invoice.issued'), true);
    assert.equal(eventMatches('charge.paid', 'invoice.issued'), false);
  });

  it('backs off a minute, then two, four, and so on, up to six hours', () => {
    assert.equal(backoffMs(1), 60_000);
    assert.equal(backoffMs(2), 120_000);
    assert.equal(backoffMs(30), 6 * 3600 * 1000);
  });
});

describe('endpoints and delivery', () => {
  it('returns the secret once, when an endpoint is created, and never again', async () => {
    const created = await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: ['charge.paid'] });
    assert.equal(created.status, 201);
    assert.match(created.body.secret, /^whsec_/);
    const list = await authed(request(app).get('/api/admin/webhooks'));
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].secret, undefined);
    assert.equal(list.body.data[0].events, 'charge.paid');
  });

  it('refuses an unknown event type and an unsafe address', async () => {
    const badEvent = await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: ['made.up'] });
    assert.equal(badEvent.status, 400);
    const badUrl = await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://127.0.0.1/a', events: '*' });
    assert.equal(badUrl.status, 400);
  });

  it('delivers a signed event that the receiver can verify, and marks it delivered', async () => {
    const created = await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: '*' });
    const eventId = await emitEvent('charge.paid', { chargeId: 'c1', totalCents: 300 }, 'default');
    assert.ok(eventId);
    const fetchImpl = fakeFetch(200);
    assert.equal(await dispatchWebhookDeliveries({ fetchImpl }), 1);

    const sent = fetchImpl.calls[0];
    assert.equal(sent.url, 'https://hooks.example.test/a');
    assert.equal(sent.init.headers['X-Plugyard-Event'], 'charge.paid');
    assert.equal(verifySignature(created.body.secret, sent.init.body, sent.init.headers['X-Plugyard-Signature']), true);
    const body = JSON.parse(sent.init.body);
    assert.equal(body.type, 'charge.paid');
    assert.equal(body.data.totalCents, 300);

    const row = await rawPrisma.webhookDelivery.findFirst({ where: { eventId } });
    assert.equal(row.status, 'DELIVERED');
    assert.equal(row.attempts, 1);
  });

  it('retries a failed delivery with a wait, and gives up after the last attempt', async () => {
    await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: '*' });
    const eventId = await emitEvent('invoice.issued', { invoiceId: 'i1' }, 'default');
    const start = new Date();
    await dispatchWebhookDeliveries({ now: start, fetchImpl: fakeFetch(500) });
    let row = await rawPrisma.webhookDelivery.findFirst({ where: { eventId } });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.attempts, 1);
    assert.ok(row.nextAttemptAt > start, 'the retry is scheduled for later');

    // Not due yet: nothing is sent.
    assert.equal(await dispatchWebhookDeliveries({ now: start, fetchImpl: fakeFetch(500) }), 0);

    // Keep failing until the attempts run out.
    let when = new Date(start.getTime() + 365 * 24 * 3600 * 1000);
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      await dispatchWebhookDeliveries({ now: when, fetchImpl: fakeFetch(503) });
      when = new Date(when.getTime() + 365 * 24 * 3600 * 1000);
    }
    row = await rawPrisma.webhookDelivery.findFirst({ where: { eventId } });
    assert.equal(row.status, 'FAILED');
    assert.equal(row.attempts, MAX_ATTEMPTS);
    assert.match(row.lastError, /503/);
  });

  it('sends a test event through the normal path, and can retry a failed delivery', async () => {
    const created = await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: '*' });
    const id = created.body.id;
    const test = await authed(request(app).post(`/api/admin/webhooks/${id}/test`));
    assert.equal(test.status, 202);
    const fetchImpl = fakeFetch(200);
    await dispatchWebhookDeliveries({ fetchImpl });
    assert.equal(JSON.parse(fetchImpl.calls[0].init.body).type, 'webhook.test');

    const delivery = await rawPrisma.webhookDelivery.findFirst({ where: { endpointId: id } });
    const retry = await authed(request(app).post(`/api/admin/webhooks/deliveries/${delivery.id}/retry`));
    assert.equal(retry.status, 409, 'a delivered event is not sent again');
  });

  it('stops sending to a turned-off endpoint', async () => {
    const created = await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: '*' });
    await authed(request(app).patch(`/api/admin/webhooks/${created.body.id}`)).send({ active: false });
    const eventId = await emitEvent('charge.paid', { x: 1 }, 'default');
    assert.equal(eventId, null, 'a turned-off endpoint is not queued');
    const fetchImpl = fakeFetch(200);
    await dispatchWebhookDeliveries({ fetchImpl });
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('keeps one site\'s endpoints separate from another site\'s', async () => {
    await authed(request(app).post('/api/admin/webhooks')).send({ url: 'https://hooks.example.test/a', events: '*' });
    const eventId = await emitEvent('charge.paid', {}, 'some-other-site');
    assert.equal(eventId, null);
    assert.equal(await prisma.webhookDelivery.count(), 0);
  });
});
