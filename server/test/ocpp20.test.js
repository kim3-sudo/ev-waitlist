import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { RPCClient } from 'ocpp-rpc';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { registry } from '../src/services/stationRegistry.js';
import { createCentralSystem } from '../src/ocpp/centralSystem.js';
import { attachOcpp20, energyWhFrom, toStoredMeterValues } from '../src/ocpp/ocpp20.js';
import { toOcpp20, fromOcpp20Result, OCPP20 } from '../src/services/ocpp20Commands.js';
import { callStation } from '../src/services/stationCommands.js';
import { isBlockedIdTag, sendLocalList, LOCAL_LIST_MAX } from '../src/services/localList.js';
import { resetSeenThrottle } from '../src/services/stationEvents.js';

const PASSWORD = 'CorrectHorse1!';
const IDENTITY = 'CP20-TEST';

// A charge point's end of the connection, recorded: what it was asked, and what it answered.
function fakeClient(protocol, replies = {}) {
  const calls = [];
  return {
    protocol,
    calls,
    async call(method, params) {
      calls.push({ method, params });
      return replies[method] ?? {};
    },
  };
}

// Builds the 2.0.1 handlers for one station and returns a way to send them messages.
function harness(station, { replies } = {}) {
  const handlers = {};
  let fallback;
  const handle = (...args) => {
    const fn = args.at(-1);
    if (args.length === 1) fallback = fn;
    else handlers[args[0]] = fn;
  };
  const client = fakeClient(OCPP20, replies);
  const faults = [];
  const later = (_label, fn) => {
    Promise.resolve().then(fn).catch(() => {});
  };
  attachOcpp20(client, {
    handle,
    stationId: station.id,
    identity: station.identity,
    reportFault: async (...args) => faults.push(args),
    later,
  });
  const send = async (method, params) => {
    const fn = handlers[method];
    if (!fn) throw new Error(`no handler for ${method}`);
    return fn({ params });
  };
  return { client, faults, send, fallback, handlers };
}

async function station(identity = IDENTITY, flags = {}) {
  const s = await prisma.station.create({ data: { identity, name: 'Bay 20', ...flags } });
  await prisma.connector.createMany({
    data: [
      { stationId: s.id, connectorId: 1, status: 'Available' },
      { stationId: s.id, connectorId: 2, status: 'Available' },
    ],
  });
  return s;
}

// A driver whose waitlist turn is active at this station, so the server authorizes their ID tag.
async function authorizedDriver(stationId, idTag) {
  const entry = await prisma.queueEntry.create({
    data: { stationId, name: 'Driver', contact: 'd@example.test', idTag, position: 1, status: 'NOTIFIED' },
  });
  await prisma.reservation.create({
    data: { queueEntryId: entry.id, stationId, connectorId: 1, expiresAt: new Date(Date.now() + 60 * 60_000) },
  });
}

beforeEach(async () => {
  await resetDb();
  resetSeenThrottle();
});

afterEach(() => {
  registry.remove(IDENTITY);
  registry.remove('CP20-OTHER');
});

describe('OCPP 2.0.1 over a websocket', () => {
  let httpServer;
  let port;
  const clients = [];

  before(async () => {
    const central = createCentralSystem();
    httpServer = http.createServer();
    httpServer.on('upgrade', central.handleUpgrade);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  after(async () => {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  async function connect(identity) {
    const client = new RPCClient({
      endpoint: `ws://localhost:${port}/ocpp`,
      identity,
      protocols: [OCPP20],
      strictMode: true,
    });
    await client.connect();
    clients.push(client);
    return client;
  }

  it('negotiates OCPP 2.0.1, and every message passes the official schema on both sides', async () => {
    const s = await station(IDENTITY);
    const cp = await connect(IDENTITY);
    assert.equal(cp.protocol, OCPP20);

    const boot = await cp.call('BootNotification', {
      chargingStation: { vendorName: 'Acme', model: 'AC-22', serialNumber: 'SN-1', firmwareVersion: '3.1.0' },
      reason: 'PowerUp',
    });
    assert.equal(boot.status, 'Accepted');
    const hb = await cp.call('Heartbeat', {});
    assert.ok(!Number.isNaN(Date.parse(hb.currentTime)));

    await cp.call('StatusNotification', {
      timestamp: new Date().toISOString(),
      connectorStatus: 'Available',
      evseId: 1,
      connectorId: 1,
    });

    const stored = await prisma.station.findUnique({ where: { id: s.id } });
    assert.equal(stored.vendor, 'Acme');
    assert.equal(stored.firmwareVersion, '3.1.0');
    const connector = await prisma.connector.findUnique({ where: { stationId_connectorId: { stationId: s.id, connectorId: 1 } } });
    assert.equal(connector.status, 'Available');
  });

  it('refuses an unknown driver on Authorize, and a blocked tag as Blocked', async () => {
    await station(IDENTITY);
    await prisma.localListEntry.create({ data: { tenantId: 'default', idTag: 'STOLEN-1', status: 'BLOCKED' } });
    const cp = await connect(IDENTITY);
    const unknown = await cp.call('Authorize', { idToken: { idToken: 'NOBODY-HERE', type: 'ISO14443' } });
    assert.equal(unknown.idTokenInfo.status, 'Unknown');
    const blocked = await cp.call('Authorize', { idToken: { idToken: 'STOLEN-1', type: 'ISO14443' } });
    assert.equal(blocked.idTokenInfo.status, 'Blocked');
  });

  it('accepts a session for an authorized driver, and bills it when the transaction ends', async () => {
    const s = await station(IDENTITY);
    await authorizedDriver(s.id, 'TAG-DRIVER-1');
    const cp = await connect(IDENTITY);
    const txRef = 'tx-2001-abc';
    const started = await cp.call('TransactionEvent', {
      eventType: 'Started',
      timestamp: new Date().toISOString(),
      triggerReason: 'Authorized',
      seqNo: 0,
      transactionInfo: { transactionId: txRef, chargingState: 'Charging' },
      evse: { id: 1, connectorId: 1 },
      idToken: { idToken: 'TAG-DRIVER-1', type: 'ISO14443' },
      meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: 1000, measurand: 'Energy.Active.Import.Register', unitOfMeasure: { unit: 'Wh' } }] }],
    });
    assert.equal(started.idTokenInfo.status, 'Accepted');

    const tx = await prisma.transaction.findFirst({ where: { stationId: s.id } });
    assert.equal(tx.ocppTransactionRef, txRef);
    assert.equal(tx.meterStart, 1000);

    await cp.call('TransactionEvent', {
      eventType: 'Ended',
      timestamp: new Date().toISOString(),
      triggerReason: 'EVDeparted',
      seqNo: 5,
      transactionInfo: { transactionId: txRef, stoppedReason: 'EVDisconnected' },
      evse: { id: 1, connectorId: 1 },
      meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: 3.5, measurand: 'Energy.Active.Import.Register', unitOfMeasure: { unit: 'kWh' } }] }],
    });
    const ended = await prisma.transaction.findUnique({ where: { id: tx.id } });
    assert.ok(ended.stoppedAt);
    assert.equal(ended.meterStop, 3500, 'kWh readings are converted to Wh');
    assert.equal(ended.stopReason, 'EVDisconnected');
    const charge = await prisma.charge.findUnique({ where: { transactionId: tx.id } });
    assert.ok(charge, 'the finished session is billed');
  });
});

describe('OCPP 2.0.1 message handling', () => {
  it('stores a session under its text ID, and keeps the numeric ID the rest of the app uses', async () => {
    const s = await station(IDENTITY);
    await authorizedDriver(s.id, 'TAG-A');
    const h = harness(s);
    await h.send('TransactionEvent', {
      eventType: 'Started',
      timestamp: new Date().toISOString(),
      triggerReason: 'Authorized',
      seqNo: 0,
      transactionInfo: { transactionId: 'ref-77' },
      evse: { id: 1, connectorId: 2 },
      idToken: { idToken: 'TAG-A', type: 'ISO14443' },
    });
    const tx = await prisma.transaction.findFirst({ where: { stationId: s.id } });
    assert.equal(tx.connectorId, 2);
    assert.equal(tx.ocppTransactionRef, 'ref-77');
    assert.equal(typeof tx.ocppTransactionId, 'number');
  });

  it('stops a session that starts with a tag that is not authorized', async () => {
    const s = await station(IDENTITY);
    const h = harness(s);
    const reply = await h.send('TransactionEvent', {
      eventType: 'Started',
      timestamp: new Date().toISOString(),
      triggerReason: 'Authorized',
      seqNo: 0,
      transactionInfo: { transactionId: 'ref-unauth' },
      evse: { id: 1, connectorId: 1 },
      idToken: { idToken: 'NOT-ALLOWED', type: 'ISO14443' },
    });
    assert.equal(reply.idTokenInfo.status, 'Invalid');
    assert.equal(await prisma.transaction.count({ where: { stationId: s.id } }), 0);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(h.client.calls.map((c) => c.method), ['RequestStopTransaction']);
    assert.equal(h.client.calls[0].params.transactionId, 'ref-unauth');
  });

  it('ignores Updated and Ended events for a session it never accepted', async () => {
    const s = await station(IDENTITY);
    const h = harness(s);
    const reply = await h.send('TransactionEvent', {
      eventType: 'Ended',
      timestamp: new Date().toISOString(),
      triggerReason: 'Local',
      seqNo: 9,
      transactionInfo: { transactionId: 'never-accepted' },
    });
    assert.deepEqual(reply, {});
  });

  it('stores standalone meter values against the open session on the charge point', async () => {
    const s = await station(IDENTITY);
    await prisma.transaction.create({
      data: {
        stationId: s.id,
        connectorId: 1,
        idTag: 'T1',
        ocppTransactionId: 5001,
        ocppTransactionRef: 'open-ref',
        meterStart: 0,
        startedAt: new Date(),
      },
    });
    const h = harness(s);
    await h.send('MeterValues', {
      evseId: 1,
      meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: 2500, measurand: 'Energy.Active.Import.Register', unitOfMeasure: { unit: 'Wh' } }] }],
    });
    const samples = await prisma.meterSample.count({ where: { stationId: s.id } });
    assert.ok(samples >= 1, 'a meter reading was stored');
  });

  it('marks a diagnostics request failed when the charge point reports an upload failure', async () => {
    const s = await station(IDENTITY);
    const log = await prisma.diagnosticsLog.create({
      data: { stationId: s.id, tokenHash: 'h-1', expiresAt: new Date(Date.now() + 3600_000) },
    });
    const h = harness(s);
    await h.send('LogStatusNotification', { status: 'UploadFailure', requestId: 3 });
    const after = await prisma.diagnosticsLog.findUnique({ where: { id: log.id } });
    assert.equal(after.status, 'FAILED');
  });

  it('answers DataTransfer for a vendor it does not know', async () => {
    const s = await station(IDENTITY);
    const h = harness(s);
    const reply = await h.send('DataTransfer', { vendorId: 'acme' });
    assert.equal(reply.status, 'UnknownVendorId');
  });

  it('reads meter units and energy correctly', () => {
    const list = [
      { timestamp: '2026-11-09T10:00:00Z', sampledValue: [{ value: '1.2', measurand: 'Energy.Active.Import.Register', unitOfMeasure: { unit: 'kWh' } }] },
      { timestamp: '2026-11-09T10:05:00Z', sampledValue: [{ value: 2400, measurand: 'Energy.Active.Import.Register', unitOfMeasure: { unit: 'Wh' } }] },
      { timestamp: '2026-11-09T10:06:00Z', sampledValue: [{ value: 11, measurand: 'Current.Import', unitOfMeasure: { unit: 'A' } }] },
    ];
    assert.equal(energyWhFrom(list), 2400, 'the latest energy reading wins');
    const stored = toStoredMeterValues(list);
    assert.equal(stored[0].sampledValue[0].unit, 'kWh');
    assert.equal(stored[0].sampledValue[0].value, '1.2');
  });
});

describe('translating commands for OCPP 2.0.1', () => {
  it('turns a 1.6 stop into a 2.0.1 stop with the charge point\'s own transaction ID', async () => {
    const s = await station(IDENTITY);
    await prisma.transaction.create({
      data: { stationId: s.id, connectorId: 1, idTag: 'T', ocppTransactionId: 42, ocppTransactionRef: 'ref-42', startedAt: new Date() },
    });
    const out = await toOcpp20(s, 'RemoteStopTransaction', { transactionId: 42 });
    assert.deepEqual(out, { method: 'RequestStopTransaction', params: { transactionId: 'ref-42' } });
  });

  it('refuses a stop for a session that has no 2.0.1 ID', async () => {
    const s = await station(IDENTITY);
    await prisma.transaction.create({
      data: { stationId: s.id, connectorId: 1, idTag: 'T', ocppTransactionId: 43, startedAt: new Date() },
    });
    const out = await toOcpp20(s, 'RemoteStopTransaction', { transactionId: 43 });
    assert.ok(out.unsupported);
  });

  it('maps availability, unlock, reset and trigger messages', async () => {
    const s = await station(IDENTITY);
    assert.deepEqual(await toOcpp20(s, 'ChangeAvailability', { connectorId: 2, type: 'Inoperative' }), {
      method: 'ChangeAvailability',
      params: { operationalStatus: 'Inoperative', evse: { id: 1, connectorId: 2 } },
    });
    assert.deepEqual(await toOcpp20(s, 'UnlockConnector', { connectorId: 1 }), {
      method: 'UnlockConnector',
      params: { evseId: 1, connectorId: 1 },
    });
    assert.deepEqual((await toOcpp20(s, 'Reset', { type: 'Hard' })).params, { type: 'Immediate' });
    assert.deepEqual(await toOcpp20(s, 'TriggerMessage', { requestedMessage: 'Heartbeat' }), {
      method: 'TriggerMessage',
      params: { requestedMessage: 'Heartbeat' },
    });
  });

  it('maps firmware and diagnostics: UpdateFirmware, and GetLog for a diagnostics log', async () => {
    const s = await station(IDENTITY);
    const fw = await toOcpp20(s, 'UpdateFirmware', { location: 'https://x/fw.bin', retrieveDate: '2026-11-09T12:00:00.000Z', retries: 3, retryInterval: 300 });
    assert.equal(fw.method, 'UpdateFirmware');
    assert.equal(fw.params.firmware.location, 'https://x/fw.bin');
    assert.equal(fw.params.firmware.retrieveDateTime, '2026-11-09T12:00:00.000Z');
    assert.ok(Number.isInteger(fw.params.requestId));

    const logs = await toOcpp20(s, 'GetDiagnostics', { location: 'https://x/upload' });
    assert.equal(logs.method, 'GetLog');
    assert.equal(logs.params.logType, 'DiagnosticsLog');
    assert.equal(logs.params.log.remoteLocation, 'https://x/upload');
  });

  it('maps charging profiles and local lists to their 2.0.1 shapes', async () => {
    const s = await station(IDENTITY);
    const profile = await toOcpp20(s, 'SetChargingProfile', {
      connectorId: 0,
      csChargingProfiles: {
        chargingProfileId: 100,
        stackLevel: 0,
        chargingProfilePurpose: 'ChargePointMaxProfile',
        chargingProfileKind: 'Absolute',
        chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }] },
      },
    });
    assert.equal(profile.params.evseId, 0);
    assert.equal(profile.params.chargingProfile.chargingProfilePurpose, 'ChargingStationMaxProfile');
    assert.equal(profile.params.chargingProfile.chargingSchedule[0].chargingSchedulePeriod[0].limit, 16);

    const list = await toOcpp20(s, 'SendLocalList', {
      listVersion: 7,
      updateType: 'Full',
      localAuthorizationList: [{ idTag: 'A1', idTagInfo: { status: 'Blocked' } }],
    });
    assert.equal(list.params.versionNumber, 7);
    assert.deepEqual(list.params.localAuthorizationList[0], { idToken: { idToken: 'A1', type: 'ISO14443' }, idTokenInfo: { status: 'Blocked' } });
  });

  it('refuses commands that have no 2.0.1 equivalent in this version', async () => {
    const s = await station(IDENTITY);
    assert.ok((await toOcpp20(s, 'ChangeConfiguration', { key: 'X', value: '1' })).unsupported);
    assert.ok((await toOcpp20(s, 'ReserveNow', {})).unsupported);
  });

  it('brings the 2.0.1 local list version answer back into the 1.6 field name', () => {
    assert.deepEqual(fromOcpp20Result('GetLocalListVersion', { versionNumber: 9 }), { listVersion: 9 });
  });

  it('sends a 2.0.1 charge point the translated message, through the normal command path', async () => {
    const s = await station(IDENTITY);
    const fake = fakeClient(OCPP20, { ChangeAvailability: { status: 'Accepted' } });
    registry.add(IDENTITY, fake);
    const outcome = await callStation(s, 'ChangeAvailability', { connectorId: 1, type: 'Operative' });
    assert.equal(outcome.ok, true);
    assert.equal(fake.calls[0].method, 'ChangeAvailability');
    assert.equal(fake.calls[0].params.operationalStatus, 'Operative');
  });

  it('keeps 1.6 charge points on the 1.6 messages', async () => {
    const s = await station(IDENTITY);
    const fake = fakeClient('ocpp1.6', { Reset: { status: 'Accepted' } });
    registry.add(IDENTITY, fake);
    await callStation(s, 'Reset', { type: 'Soft' });
    assert.deepEqual(fake.calls[0], { method: 'Reset', params: { type: 'Soft' } });
  });
});

describe('smart charging and the local list', () => {
  let adminToken;
  beforeEach(async () => {
    await createAdmin({ email: 'ops@example.test', password: PASSWORD });
    adminToken = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
  });
  const authed = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  it('refuses a power limit while smart charging is off, and sends nothing', async () => {
    const s = await station(IDENTITY);
    const fake = fakeClient('ocpp1.6');
    registry.add(IDENTITY, fake);
    const res = await authed(request(app).post(`/api/admin/station-commands/${s.id}/charging-limit`)).send({ connectorId: 0, limitAmps: 16 });
    assert.equal(res.status, 409);
    assert.equal(fake.calls.length, 0);
  });

  it('sets and clears a power limit when smart charging is on', async () => {
    const s = await station(IDENTITY, { smartChargingEnabled: true });
    const fake = fakeClient('ocpp1.6', { SetChargingProfile: { status: 'Accepted' }, ClearChargingProfile: { status: 'Accepted' } });
    registry.add(IDENTITY, fake);

    const set = await authed(request(app).post(`/api/admin/station-commands/${s.id}/charging-limit`)).send({ connectorId: 1, limitAmps: 20 });
    assert.equal(set.status, 202);
    const profile = fake.calls[0].params;
    assert.equal(fake.calls[0].method, 'SetChargingProfile');
    assert.equal(profile.connectorId, 1);
    assert.equal(profile.csChargingProfiles.chargingProfilePurpose, 'TxDefaultProfile');
    assert.equal(profile.csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0].limit, 20);

    const cleared = await authed(request(app).delete(`/api/admin/station-commands/${s.id}/charging-limit?connectorId=1`));
    assert.equal(cleared.status, 200);
    assert.equal(fake.calls[1].method, 'ClearChargingProfile');
  });

  it('rejects an impossible limit and a connector the charge point does not have', async () => {
    const s = await station(IDENTITY, { smartChargingEnabled: true });
    registry.add(IDENTITY, fakeClient('ocpp1.6'));
    const bad = await authed(request(app).post(`/api/admin/station-commands/${s.id}/charging-limit`)).send({ connectorId: 1, limitAmps: 0 });
    assert.equal(bad.status, 400);
    const missing = await authed(request(app).post(`/api/admin/station-commands/${s.id}/charging-limit`)).send({ connectorId: 9, limitAmps: 10 });
    assert.equal(missing.status, 404);
  });

  it('keeps a list of ID tags, refusing duplicates, and blocks a tag at once', async () => {
    const created = await authed(request(app).post('/api/admin/local-list')).send({ idTag: 'STOLEN-9', status: 'BLOCKED', note: 'lost card' });
    assert.equal(created.status, 201);
    assert.equal(await isBlockedIdTag('STOLEN-9'), true);
    assert.equal(await isBlockedIdTag('FINE-1'), false);
    const dup = await authed(request(app).post('/api/admin/local-list')).send({ idTag: 'STOLEN-9' });
    assert.equal(dup.status, 409);
    const badTag = await authed(request(app).post('/api/admin/local-list')).send({ idTag: 'has space' });
    assert.equal(badTag.status, 400);
  });

  it('sends the whole list to a charge point with local list support on', async () => {
    const s = await station(IDENTITY, { localListEnabled: true });
    await prisma.localListEntry.create({ data: { tenantId: 'default', idTag: 'BAD-1', status: 'BLOCKED' } });
    await prisma.localListEntry.create({ data: { tenantId: 'default', idTag: 'GOOD-1', status: 'ACCEPTED' } });
    const fake = fakeClient('ocpp1.6', { SendLocalList: { status: 'Accepted' } });
    registry.add(IDENTITY, fake);
    const res = await authed(request(app).post(`/api/admin/station-commands/${s.id}/local-list`));
    assert.equal(res.status, 202);
    const sent = fake.calls[0].params;
    assert.equal(fake.calls[0].method, 'SendLocalList');
    assert.equal(sent.updateType, 'Full');
    assert.deepEqual(sent.localAuthorizationList.map((e) => [e.idTag, e.idTagInfo.status]), [['BAD-1', 'Blocked'], ['GOOD-1', 'Accepted']]);
    assert.ok(sent.listVersion > 0);
  });

  it('does not send a local list to a charge point with the feature off', async () => {
    const s = await station(IDENTITY);
    const fake = fakeClient('ocpp1.6');
    registry.add(IDENTITY, fake);
    const res = await authed(request(app).post(`/api/admin/station-commands/${s.id}/local-list`));
    assert.equal(res.status, 409);
    assert.equal(fake.calls.length, 0);
  });

  it('refuses to send a list longer than a charge point takes', async () => {
    const s = await station(IDENTITY, { localListEnabled: true });
    const rows = Array.from({ length: LOCAL_LIST_MAX + 1 }, (_, i) => ({ tenantId: 'default', idTag: `TAG-${i}`, status: 'ACCEPTED' }));
    await prisma.localListEntry.createMany({ data: rows });
    registry.add(IDENTITY, fakeClient('ocpp1.6'));
    const outcome = await sendLocalList(s);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /at most/);
  });
});
