import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/tenancy/context.js';
import { registry } from '../src/services/stationRegistry.js';
import { ROAMING_TERMS_VERSION } from '../src/services/roaming.js';
import { roamingAuthorize } from '../src/ocpi/authorize.js';
import { dispatchDue, enqueue } from '../src/ocpi/outbox.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';

// A fake e-mobility partner (eMSP) on a local port. It checks the token we send,
// answers the discovery calls, and records every request it receives.
const EMSP_TOKEN = 'emsp-token-abc';
const EMSP_CC = 'NL';
const EMSP_PARTY = 'EMS';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

let fake;
let received;
let authorizeAnswer;
let failNext;

function startFakeEmsp() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      const auth = req.headers.authorization ?? '';
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status_code: status === 200 || status === 201 ? 1000 : 2000, timestamp: new Date().toISOString(), data }));
      };

      if (req.url === '/ocpi/versions' && req.method === 'GET') {
        if (auth !== `Token ${b64(EMSP_TOKEN)}`) return send(401, undefined);
        return send(200, [{ version: '2.2.1', url: `${fake.base}/ocpi/2.2.1` }]);
      }
      if (req.url === '/ocpi/2.2.1' && req.method === 'GET') {
        return send(200, {
          version: '2.2.1',
          endpoints: ['tokens', 'sessions', 'cdrs', 'tariffs', 'locations'].map((identifier) => ({
            identifier,
            url: `${fake.base}/ocpi/2.2.1/${identifier}`,
          })),
        });
      }
      if (req.url.endsWith('/authorize') && req.method === 'POST') {
        received.push({ method: req.method, url: req.url, auth, body });
        return send(200, { allowed: authorizeAnswer });
      }
      if (auth !== `Token ${b64(EMSP_TOKEN)}`) return send(401, undefined);

      received.push({ method: req.method, url: req.url, auth, body });
      if (failNext) {
        failNext = false;
        return send(500, undefined);
      }
      return send(200, undefined);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

// Stands in for a connected charge point. Records the OCPP calls the server makes.
const chargePoint = { calls: [], answers: {} };
function fakeChargePoint(identity) {
  const client = {
    async call(action, payload) {
      chargePoint.calls.push({ identity, action, payload });
      return { status: chargePoint.answers[action] ?? 'Accepted' };
    },
  };
  registry.add(identity, client);
  return client;
}

before(async () => {
  fake = await startFakeEmsp();
});
after(() => fake.server.close());

let adminToken;
let station;
const ADMIN_PASSWORD = 'Password123!';

async function setRoaming(tenantId, on) {
  await rawPrisma.tenant.update({
    where: { id: tenantId },
    data: {
      roamingEnabled: on,
      roamingTermsAcknowledgedAt: on ? new Date() : null,
      roamingTermsAcknowledgedVersion: on ? ROAMING_TERMS_VERSION : null,
    },
  });
}

// Invites a partner and completes the handshake. Returns our token for the partner.
async function handshake(name = 'Partner Co') {
  const invite = await request(app).post('/api/admin/ocpi/partners').set('Authorization', `Bearer ${adminToken}`).send({ name });
  assert.equal(invite.status, 201);
  const res = await request(app)
    .post('/ocpi/default/2.2.1/credentials')
    .set('Authorization', `Token ${b64(invite.body.registrationToken)}`)
    .send({
      url: `${fake.base}/ocpi/versions`,
      token: EMSP_TOKEN,
      roles: [{ role: 'EMSP', party_id: EMSP_PARTY, country_code: EMSP_CC, business_details: { name: 'EMSP' } }],
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { partnerId: invite.body.id, ourToken: res.body.data.token };
}

beforeEach(async () => {
  await resetDb();
  received = [];
  authorizeAnswer = 'ALLOWED';
  failNext = false;
  chargePoint.calls = [];
  chargePoint.answers = {};

  const admin = await createAdmin({ password: ADMIN_PASSWORD });
  const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: ADMIN_PASSWORD });
  adminToken = login.body.token;

  await rawPrisma.operator.update({ where: { id: 'singleton' }, data: { name: 'Acme Parking', countryCode: 'GB', partyId: 'CPO' } });
  await setRoaming(DEFAULT_TENANT_ID, true);
  await prisma.paymentSettings.upsert({
    where: { tenantId: DEFAULT_TENANT_ID },
    create: { ratePerMinuteCents: 30, currency: 'EUR' },
    update: { ratePerMinuteCents: 30, currency: 'EUR' },
  });
  station = await prisma.station.create({
    data: { identity: 'OCPI-1', name: 'Bay 1', location: 'Level 1', latitude: 52.1, longitude: 4.3 },
  });
  await prisma.connector.create({
    data: { stationId: station.id, connectorId: 1, status: 'Available', ...CONNECTOR_DETAILS },
  });
  fakeChargePoint('OCPI-1');
});

const bearer = () => ({ Authorization: `Bearer ${adminToken}` });

const CONNECTOR_DETAILS = { standard: 'IEC_62196_T2', format: 'CABLE', powerType: 'AC_3_PHASE', maxVoltage: 400, maxAmperage: 32 };

describe('connector details', () => {
  it('publishes the connector\'s own details, not placeholders', async () => {
    const { ourToken } = await handshake();
    const res = await request(app).get('/ocpi/default/2.2.1/locations').set('Authorization', `Token ${b64(ourToken)}`);
    const connector = res.body.data[0].evses[0].connectors[0];
    assert.equal(connector.standard, 'IEC_62196_T2');
    assert.equal(connector.power_type, 'AC_3_PHASE');
    assert.equal(connector.max_voltage, 400);
    assert.equal(connector.max_amperage, 32);
  });

  it('does not publish a station whose connector details are incomplete', async () => {
    const bare = await prisma.station.create({ data: { identity: 'OCPI-BARE', name: 'Bare', latitude: 52, longitude: 4 } });
    await prisma.connector.create({ data: { stationId: bare.id, connectorId: 1, status: 'Available' } });
    const { ourToken } = await handshake();
    const res = await request(app).get('/ocpi/default/2.2.1/locations').set('Authorization', `Token ${b64(ourToken)}`);
    assert.equal(res.body.data.some((l) => l.id === bare.id), false);
    assert.equal((await request(app).get(`/ocpi/default/2.2.1/locations/GB/CPO/${bare.id}`).set('Authorization', `Token ${b64(ourToken)}`)).status, 404);
  });

  it('the admin saves connector details and refuses invalid ones', async () => {
    const ok = await request(app)
      .put(`/api/admin/stations/${station.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connectors: [{ connectorId: 1, standard: 'CHADEMO', format: 'CABLE', powerType: 'DC', maxVoltage: 500, maxAmperage: 125 }] });
    assert.equal(ok.status, 200);
    const saved = await prisma.connector.findFirst({ where: { stationId: station.id, connectorId: 1 } });
    assert.equal(saved.standard, 'CHADEMO');
    assert.equal(saved.powerType, 'DC');

    const badStandard = await request(app)
      .put(`/api/admin/stations/${station.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connectors: [{ connectorId: 1, standard: 'NOT_A_PLUG' }] });
    assert.equal(badStandard.status, 400);

    const unknownConnector = await request(app)
      .put(`/api/admin/stations/${station.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ connectors: [{ connectorId: 9, standard: 'CHADEMO' }] });
    assert.equal(unknownConnector.status, 400);
  });
});

describe('handshake', () => {
  it('a partner registers with an invitation and receives our token', async () => {
    const { partnerId, ourToken } = await handshake();
    const partner = await rawPrisma.ocpiPartner.findUnique({ where: { id: partnerId } });
    assert.equal(partner.status, 'ACTIVE');
    assert.equal(partner.registrationTokenHash, null, 'the registration token cannot be used twice');
    assert.ok(ourToken.length > 20);
    assert.ok(JSON.parse(partner.endpoints).sessions, 'discovered the partner\'s endpoints');
  });

  it('an invitation cannot be used twice', async () => {
    const invite = await request(app).post('/api/admin/ocpi/partners').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Twice' });
    const body = {
      url: `${fake.base}/ocpi/versions`,
      token: EMSP_TOKEN,
      roles: [{ role: 'EMSP', party_id: EMSP_PARTY, country_code: EMSP_CC }],
    };
    await request(app).post('/ocpi/default/2.2.1/credentials').set('Authorization', `Token ${b64(invite.body.registrationToken)}`).send(body);
    const again = await request(app).post('/ocpi/default/2.2.1/credentials').set('Authorization', `Token ${b64(invite.body.registrationToken)}`).send(body);
    assert.equal(again.status, 401);
  });

  it('refuses an invitation while roaming is off for the site', async () => {
    await setRoaming(DEFAULT_TENANT_ID, false);
    const res = await request(app).post('/api/admin/ocpi/partners').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Nope' });
    assert.equal(res.status, 409);
  });

  it('the partner\'s OCPI address answers 403 while roaming is off', async () => {
    await setRoaming(DEFAULT_TENANT_ID, false);
    const res = await request(app).get('/ocpi/default/versions').set('Authorization', `Token ${b64('anything')}`);
    assert.equal(res.status, 403);
  });

  it('sends the partner the locations and tariffs once active', async () => {
    await handshake();
    const sent = await dispatchDue();
    assert.equal(sent, 2);
    const tariff = received.find((r) => r.url.includes('/tariffs/GB/CPO/DEFAULT'));
    const location = received.find((r) => r.url.includes(`/locations/GB/CPO/${station.id}`));
    assert.equal(tariff.method, 'PUT');
    assert.equal(tariff.auth, `Token ${b64(EMSP_TOKEN)}`, 'we call the partner with its own token');
    assert.equal(tariff.body.currency, 'EUR');
    assert.equal(tariff.body.elements[0].price_components[0].price, '18.00');
    assert.equal(location.body.evses[0].evse_id, 'GB*CPO*EOCPI11');
  });
});

describe('partner reads our data', () => {
  it('lists published locations with our token, and refuses no token or a wrong one', async () => {
    const { ourToken } = await handshake();
    const res = await request(app).get('/ocpi/default/2.2.1/locations').set('Authorization', `Token ${b64(ourToken)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status_code, 1000);
    assert.equal(res.body.data[0].id, station.id);
    assert.equal(res.headers['x-total-count'], '1');
    assert.equal((await request(app).get('/ocpi/default/2.2.1/locations')).status, 401);
    assert.equal((await request(app).get('/ocpi/default/2.2.1/locations').set('Authorization', `Token ${b64('wrong')}`)).status, 401);
  });

  it('a partner\'s token does not open another site', async () => {
    const { ourToken } = await handshake();
    await rawPrisma.tenant.create({ data: { id: 'site-b', slug: 'site-b', name: 'Site B' } });
    await setRoaming('site-b', true);
    const res = await request(app).get('/ocpi/site-b/2.2.1/locations').set('Authorization', `Token ${b64(ourToken)}`);
    assert.equal(res.status, 401);
  });

  it('revoking a partner stops its access and drops its queued messages', async () => {
    const { partnerId, ourToken } = await handshake();
    await request(app).post(`/api/admin/ocpi/partners/${partnerId}/revoke`).set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app).get('/ocpi/default/2.2.1/locations').set('Authorization', `Token ${b64(ourToken)}`);
    assert.equal(res.status, 401);
    const pending = await rawPrisma.ocpiOutbox.count({ where: { partnerId, status: 'PENDING' } });
    assert.equal(pending, 0);
  });
});

describe('tokens and real-time authorization', () => {
  it('stores a token the partner pushes, and refuses one for another party', async () => {
    const { ourToken } = await handshake();
    const url = '/ocpi/default/2.2.1/tokens/NL/EMS/TOKEN1';
    const good = {
      country_code: EMSP_CC,
      party_id: EMSP_PARTY,
      uid: 'TOKEN1',
      type: 'RFID',
      contract_id: 'NL-C-1',
      valid: true,
      whitelist: 'ALLOWED',
      last_updated: '2026-11-05T10:00:00Z',
    };
    const ok = await request(app).put(url).set('Authorization', `Token ${b64(ourToken)}`).send(good);
    assert.equal(ok.status, 200);
    const stored = await rawPrisma.ocpiToken.findFirst({ where: { uid: 'TOKEN1' } });
    assert.equal(stored.contractId, 'NL-C-1');

    const wrongParty = await request(app)
      .put('/ocpi/default/2.2.1/tokens/DE/XYZ/TOKEN2')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ ...good, uid: 'TOKEN2', country_code: 'DE', party_id: 'XYZ' });
    assert.equal(wrongParty.status, 400);
  });

  it('a roaming token is allowed when the partner allows it in real time', async () => {
    const { ourToken } = await handshake();
    await request(app)
      .put('/ocpi/default/2.2.1/tokens/NL/EMS/TOKEN1')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ country_code: EMSP_CC, party_id: EMSP_PARTY, uid: 'TOKEN1', type: 'RFID', contract_id: 'NL-C-1', valid: true, whitelist: 'ALLOWED', last_updated: '2026-11-05T10:00:00Z' });

    authorizeAnswer = 'ALLOWED';
    const allowed = await runWithTenant(DEFAULT_TENANT_ID, () => roamingAuthorize(station.id, 'TOKEN1'));
    assert.equal(allowed.ok, true);
    const call = received.find((r) => r.url.endsWith('/tokens/NL/EMS/TOKEN1/authorize'));
    assert.ok(call, 'asked the partner in real time');

    authorizeAnswer = 'BLOCKED';
    const blocked = await runWithTenant(DEFAULT_TENANT_ID, () => roamingAuthorize(station.id, 'TOKEN1'));
    assert.equal(blocked.ok, false);
  });

  it('a connector held for a waitlisted driver is not given to a roaming token', async () => {
    const { ourToken } = await handshake();
    await request(app)
      .put('/ocpi/default/2.2.1/tokens/NL/EMS/TOKEN1')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ country_code: EMSP_CC, party_id: EMSP_PARTY, uid: 'TOKEN1', type: 'RFID', contract_id: 'NL-C-1', valid: true, whitelist: 'ALLOWED', last_updated: '2026-11-05T10:00:00Z' });
    const entry = await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Waiting', contact: 'w@example.test', idTag: 'TAG-W', position: 1, status: 'NOTIFIED' },
    });
    await prisma.reservation.create({
      data: { queueEntryId: entry.id, stationId: station.id, connectorId: 1, expiresAt: new Date(Date.now() + 60_000) },
    });
    const result = await runWithTenant(DEFAULT_TENANT_ID, () => roamingAuthorize(station.id, 'TOKEN1'));
    assert.equal(result.ok, false);
  });
});

describe('sessions, CDRs and billing', () => {
  it('a finished roaming session is sent as a session and a CDR, and not billed by a payment link', async () => {
    const { partnerId, ourToken } = await handshake();
    await request(app)
      .put('/ocpi/default/2.2.1/tokens/NL/EMS/TOKEN1')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ country_code: EMSP_CC, party_id: EMSP_PARTY, uid: 'TOKEN1', type: 'RFID', contract_id: 'NL-C-1', valid: true, whitelist: 'ALLOWED', last_updated: '2026-11-05T10:00:00Z' });

    const startedAt = new Date(Date.now() - 10 * 60_000);
    const tx = await prisma.transaction.create({
      data: { stationId: station.id, connectorId: 1, idTag: 'TOKEN1', ocppTransactionId: 4242, meterStart: 0, meterStop: 2000, startedAt, stoppedAt: new Date(), partnerId },
    });
    await enqueue(partnerId, 'SESSION', tx.id);
    await enqueue(partnerId, 'CDR', tx.id);
    received = [];
    await dispatchDue();

    const session = received.find((r) => r.method === 'PUT' && r.url.includes(`/sessions/GB/CPO/${tx.id}`));
    assert.ok(session, 'session sent');
    assert.equal(session.body.kwh, '2.000');
    assert.equal(session.body.status, 'COMPLETED');
    assert.equal(session.body.cdr_token.contract_id, 'NL-C-1');

    const cdr = received.find((r) => r.method === 'POST' && r.url.endsWith('/cdrs'));
    assert.ok(cdr, 'CDR sent');
    assert.equal(cdr.body.total_energy, '2.000');
    assert.equal(cdr.body.total_cost.excl_vat, '3.00', '10 minutes at 30 cents');
    assert.equal(cdr.body.currency, 'EUR');

    assert.equal(await createChargeForTransaction(station.id, 4242), null, 'no payment link for roaming');
  });

  it('a partner that refuses a message is retried later, and not sent again straight away', async () => {
    const { partnerId } = await handshake();
    await dispatchDue();
    received = [];
    const tx = await prisma.transaction.create({
      data: { stationId: station.id, connectorId: 1, idTag: 'TOKEN1', ocppTransactionId: 7, meterStart: 0, meterStop: 100, startedAt: new Date(), stoppedAt: new Date(), partnerId },
    });
    await enqueue(partnerId, 'SESSION', tx.id);
    failNext = true;
    await dispatchDue();
    const row = await rawPrisma.ocpiOutbox.findFirst({ where: { partnerId, kind: 'SESSION', refId: tx.id } });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.attempts, 1);
    received = [];
    await dispatchDue();
    assert.equal(received.length, 0, 'not due yet');
  });
});

describe('commands from the partner', () => {
  it('starts a session on a connected charge point and reports the result', async () => {
    const { ourToken } = await handshake();
    await request(app)
      .put('/ocpi/default/2.2.1/tokens/NL/EMS/TOKEN1')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ country_code: EMSP_CC, party_id: EMSP_PARTY, uid: 'TOKEN1', type: 'RFID', contract_id: 'NL-C-1', valid: true, whitelist: 'ALLOWED', last_updated: '2026-11-05T10:00:00Z' });

    const res = await request(app)
      .post('/ocpi/default/2.2.1/commands/START_SESSION')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ response_url: `${fake.base}/ocpi/2.2.1/results`, token: { uid: 'TOKEN1' }, location_id: station.id, evse_uid: 'OCPI-1-1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.result, 'ACCEPTED');

    const start = chargePoint.calls.find((c) => c.action === 'RemoteStartTransaction');
    assert.deepEqual(start.payload, { connectorId: 1, idTag: 'TOKEN1' });
    await new Promise((r) => setTimeout(r, 50));
    const result = received.find((r) => r.url.endsWith('/results'));
    assert.deepEqual(result.body, { result: 'ACCEPTED' });
  });

  it('stops a roaming session by its ID', async () => {
    const { partnerId, ourToken } = await handshake();
    const tx = await prisma.transaction.create({
      data: { stationId: station.id, connectorId: 1, idTag: 'TOKEN1', ocppTransactionId: 99, meterStart: 0, startedAt: new Date(), partnerId },
    });
    const res = await request(app)
      .post('/ocpi/default/2.2.1/commands/STOP_SESSION')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ response_url: `${fake.base}/ocpi/2.2.1/results`, session_id: tx.id });
    assert.equal(res.body.data.result, 'ACCEPTED');
    assert.deepEqual(chargePoint.calls.find((c) => c.action === 'RemoteStopTransaction').payload, { transactionId: 99 });
  });

  it('refuses a token it does not know, and an unknown command', async () => {
    const { ourToken } = await handshake();
    const unknownToken = await request(app)
      .post('/ocpi/default/2.2.1/commands/START_SESSION')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ response_url: `${fake.base}/x`, token: { uid: 'NOBODY' }, location_id: station.id, evse_uid: 'OCPI-1-1' });
    assert.equal(unknownToken.body.data.result, 'REJECTED');

    const unknownCommand = await request(app)
      .post('/ocpi/default/2.2.1/commands/RESET')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({});
    assert.equal(unknownCommand.status, 404);
  });

  it('reports a charge point that is not connected as rejected', async () => {
    const { ourToken } = await handshake();
    await request(app)
      .put('/ocpi/default/2.2.1/tokens/NL/EMS/TOKEN1')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ country_code: EMSP_CC, party_id: EMSP_PARTY, uid: 'TOKEN1', type: 'RFID', contract_id: 'NL-C-1', valid: true, whitelist: 'ALLOWED', last_updated: '2026-11-05T10:00:00Z' });
    registry.remove('OCPI-1');
    const res = await request(app)
      .post('/ocpi/default/2.2.1/commands/START_SESSION')
      .set('Authorization', `Token ${b64(ourToken)}`)
      .send({ response_url: `${fake.base}/x`, token: { uid: 'TOKEN1' }, location_id: station.id, evse_uid: 'OCPI-1-1' });
    assert.equal(res.body.data.result, 'REJECTED');
  });
});
