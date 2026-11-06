import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { registry } from '../src/services/stationRegistry.js';
import { checkEnergy } from '../src/services/payments/energyCheck.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';
import { normalizeReading, storeMeterValues, latestReadings, ENERGY } from '../src/services/meterService.js';
import { configureMetering } from '../src/services/stationConfigure.js';
import { isManualHoldAuthorized } from '../src/services/manualHolds.js';
import { onConnectorFreed } from '../src/services/dispatcher.js';
import { watchStations, closeStaleSessions, SILENT_AFTER_MS, OFFLINE_GRACE_MS, STALE_AFTER_MS } from '../src/services/stationWatch.js';
import { notifyAdmins } from '../src/services/adminAlerts.js';
import { resetSeenThrottle, noteSeen } from '../src/services/stationEvents.js';

const SETTINGS = { meterSampleSeconds: 60, meterToleranceWh: 100, meterTolerancePct: 5, meterMinSessionMinutes: 2, meterMaxJumpWh: 50000 };
const PASSWORD = 'CorrectHorse1!';
const realLog = console.log;
const realError = console.error;

let token;
let viewerToken;
let station;

beforeEach(async () => {
  await resetDb();
  resetSeenThrottle();
  await createAdmin({ email: 'ops@example.test', password: PASSWORD });
  const viewer = await createAdmin({ email: 'viewer@example.test', password: PASSWORD });
  await prisma.admin.update({ where: { id: viewer.id }, data: { role: 'VIEWER' } });
  token = (await request(app).post('/api/auth/login').send({ email: 'ops@example.test', password: PASSWORD })).body.token;
  viewerToken = (await request(app).post('/api/auth/login').send({ email: 'viewer@example.test', password: PASSWORD })).body.token;
  station = await prisma.station.create({ data: { identity: 'CP-OPS', name: 'Garage C' } });
  await prisma.connector.createMany({
    data: [
      { stationId: station.id, connectorId: 1, status: 'Available' },
      { stationId: station.id, connectorId: 2, status: 'Available' },
    ],
  });
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  registry.remove('CP-OPS');
});

const authed = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

// A fake charge point connection. `replies` maps an OCPP method to the reply (or a function returning one).
function connectFake(replies = {}) {
  const calls = [];
  const client = {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      const reply = replies[method];
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'function') return reply(params);
      return reply ?? {};
    },
  };
  registry.add('CP-OPS', client);
  return client;
}

function captureLog() {
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  return lines;
}

const T = (iso) => new Date(iso);

describe('energy check', () => {
  const readings = (values, start = '2026-01-01T10:00:00Z') =>
    values.map((value, i) => ({ value, at: T(new Date(Date.parse(start) + i * 60_000).toISOString()) }));

  it('uses the charger readings when they agree with the end-of-session reading', () => {
    const r = checkEnergy({ meterStart: 1000, meterStop: 6010, energy: readings([1000, 3000, 6000]), power: readings([7400, 7400, 7400]), durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.energyWh, 5000);
    assert.equal(r.source, 'METER_VALUES');
    assert.equal(r.needsReview, false);
  });

  it('uses the charger readings when the end-of-session reading is zero', () => {
    const r = checkEnergy({ meterStart: 1000, meterStop: 1000, energy: readings([1000, 4000]), power: readings([7400, 7400]), durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.energyWh, 3000);
    assert.equal(r.needsReview, false);
  });

  it('never bills a zero reading when the meter did not move while the connector drew power', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 0, energy: readings([500, 500, 500]), power: readings([7400, 7400, 7400]), durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.needsReview, true);
    assert.equal(r.energyWh, null);
    assert.match(r.note, /did not move/);
  });

  it('flags readings that disagree with the end-of-session reading beyond the tolerance', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 9000, energy: readings([0, 3000]), power: readings([7400, 7400]), durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.needsReview, true);
    assert.match(r.note, /disagree/);
  });

  it('allows a percentage of tolerance on large sessions', () => {
    // 100 Wh tolerance is too small here, but 5% of 100 kWh (5 kWh) covers the 3 kWh difference.
    const r = checkEnergy({ meterStart: 0, meterStop: 100_000, energy: readings([0, 40_000, 80_000, 103_000]), power: [], durationSeconds: 3600, settings: SETTINGS });
    assert.equal(r.needsReview, false);
    assert.equal(r.energyWh, 103_000);
  });

  it('flags readings that go backwards', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 4000, energy: readings([3000, 1000]), power: [], durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.needsReview, true);
    assert.match(r.note, /backwards/);
  });

  it('flags a single implausible jump', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 900_000, energy: readings([0, 900_000]), power: readings([7400, 7400]), durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.needsReview, true);
    assert.match(r.note, /jumped/);
  });

  it('uses the end-of-session reading when the charge point sent no readings', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 4200, energy: [], power: [], durationSeconds: 1800, settings: SETTINGS });
    assert.equal(r.energyWh, 4200);
    assert.equal(r.source, 'STOP_TRANSACTION');
    assert.equal(r.needsReview, false);
  });

  it('flags a long session with no usable reading instead of billing it as free', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 0, energy: [], power: [], durationSeconds: 600, settings: SETTINGS });
    assert.equal(r.needsReview, true);
  });

  it('lets a very short session with no reading bill nothing without review', () => {
    const r = checkEnergy({ meterStart: 0, meterStop: 0, energy: [], power: [], durationSeconds: 60, settings: SETTINGS });
    assert.equal(r.energyWh, 0);
    assert.equal(r.needsReview, false);
  });
});

describe('meter values', () => {
  it('converts units to the stored unit and skips what it cannot use', () => {
    assert.equal(normalizeReading(ENERGY, '2.5', 'kWh'), 2500);
    assert.equal(normalizeReading('Power.Active.Import', '7.4', 'kW'), 7400);
    assert.equal(normalizeReading('Temperature', '212', 'Fahrenheit'), 100);
    assert.equal(normalizeReading(ENERGY, '-5', 'Wh'), null);
    assert.equal(normalizeReading(ENERGY, 'abc', 'Wh'), null);
    assert.equal(normalizeReading('Frequency', '50', 'Hz'), null);
    assert.equal(normalizeReading(ENERGY, '10', 'Ah'), null);
  });

  it('stores readings, marks the station as reporting, and returns the latest per connector', async () => {
    const now = Date.now();
    const stored = await storeMeterValues(station.id, 1, 7, [
      {
        timestamp: new Date(now - 60_000).toISOString(),
        sampledValue: [
          { measurand: ENERGY, value: '1.0', unit: 'kWh', context: 'Transaction.Begin' },
          { measurand: 'Power.Active.Import', value: '7400', unit: 'W' },
          { measurand: 'Current.Import', value: '12', phase: 'L1' },
        ],
      },
      { timestamp: new Date(now).toISOString(), sampledValue: [{ measurand: ENERGY, value: '1500', unit: 'Wh' }] },
    ]);
    assert.equal(stored, 3);
    const st = await prisma.station.findUnique({ where: { id: station.id } });
    assert.equal(st.meterStatus, 'REPORTING');
    const latest = await latestReadings(station.id);
    const energy = latest.find((r) => r.connectorId === 1 && r.measurand === ENERGY);
    assert.equal(energy.value, 1500);
  });
});

describe('station commands', () => {
  it('sends a trigger and records it', async () => {
    const client = connectFake({ TriggerMessage: { status: 'Accepted' } });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/trigger`)).send({ requestedMessage: 'MeterValues', connectorId: 1 });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.deepEqual(client.calls[0], { method: 'TriggerMessage', params: { requestedMessage: 'MeterValues', connectorId: 1 } });
    const events = await prisma.stationEvent.findMany({ where: { stationId: station.id, kind: 'COMMAND' } });
    assert.equal(events.length, 1);
  });

  it('refuses a trigger the charge point does not know about', async () => {
    connectFake();
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/trigger`)).send({ requestedMessage: 'Explode' });
    assert.equal(res.status, 400);
  });

  it('says so when the charge point is offline', async () => {
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/trigger`)).send({ requestedMessage: 'Heartbeat' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /not connected/);
  });

  it('does not let a viewer send commands', async () => {
    connectFake({ Reset: { status: 'Accepted' } });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/reset`), viewerToken).send({ type: 'Soft' });
    assert.equal(res.status, 403);
  });

  it('stops an open session with RemoteStopTransaction', async () => {
    const client = connectFake({ RemoteStopTransaction: { status: 'Accepted' } });
    const tx = await prisma.transaction.create({ data: { stationId: station.id, connectorId: 1, idTag: 'DRV1', ocppTransactionId: 41, meterStart: 0 } });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/transactions/${tx.id}/stop`)).send({});
    assert.equal(res.status, 202);
    assert.deepEqual(client.calls[0].params, { transactionId: 41 });
  });

  it('does not stop a session that is already closed', async () => {
    connectFake({ RemoteStopTransaction: { status: 'Accepted' } });
    const tx = await prisma.transaction.create({ data: { stationId: station.id, connectorId: 1, idTag: 'DRV1', ocppTransactionId: 42, meterStart: 0, stoppedAt: new Date() } });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/transactions/${tx.id}/stop`)).send({});
    assert.equal(res.status, 404);
  });

  it('asks before unlocking a connector with a session in progress, then unlocks', async () => {
    const client = connectFake({ UnlockConnector: { status: 'Unlocked' } });
    await prisma.transaction.create({ data: { stationId: station.id, connectorId: 1, idTag: 'DRV1', ocppTransactionId: 43, meterStart: 0 } });
    const url = `/api/admin/station-commands/${station.id}/connectors/1/unlock`;
    const first = await authed(request(app).post(url)).send({});
    assert.equal(first.status, 409);
    assert.equal(first.body.needsConfirmation, true);
    assert.equal(client.calls.length, 0);
    const second = await authed(request(app).post(url)).send({ confirmEndSession: true });
    assert.equal(second.status, 202);
    assert.equal(client.calls[0].method, 'UnlockConnector');
  });

  it('keeps the admin choice for an out-of-service connector and stops dispatch to it', async () => {
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/connectors/1/availability`)).send({ operative: false });
    assert.equal(res.status, 200);
    assert.match(res.body.message, /once the charge point is connected/);
    const connector = await prisma.connector.findUnique({ where: { stationId_connectorId: { stationId: station.id, connectorId: 1 } } });
    assert.equal(connector.operative, false);

    await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Dana', contact: 'dana@example.test', idTag: 'WAIT1', position: 1, status: 'WAITING' },
    });
    await onConnectorFreed(station.id, 1);
    assert.equal(await prisma.reservation.count({ where: { stationId: station.id } }), 0);
  });

  it('places a manual hold without a waitlist entry, and releases it', async () => {
    connectFake({ ReserveNow: { status: 'Accepted' }, CancelReservation: { status: 'Accepted' } });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/connectors/2/hold`)).send({ idTag: 'VIP-7', minutes: 30, note: 'Accessible bay' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const hold = await prisma.reservation.findUnique({ where: { id: res.body.id } });
    assert.equal(hold.queueEntryId, null);
    assert.equal(hold.idTag, 'VIP-7');
    assert.ok(hold.ocppReservationId);
    assert.equal(await isManualHoldAuthorized(station.id, 'VIP-7'), true);
    assert.equal(await isManualHoldAuthorized(station.id, 'OTHER'), false);

    const again = await authed(request(app).post(`/api/admin/station-commands/${station.id}/connectors/2/hold`)).send({ idTag: 'X', minutes: 10 });
    assert.equal(again.status, 409);

    const released = await authed(request(app).delete(`/api/admin/station-commands/${station.id}/holds/${hold.id}`)).send();
    assert.equal(released.status, 200);
    assert.equal((await prisma.reservation.findUnique({ where: { id: hold.id } })).status, 'CANCELLED');
  });

  it('falls back to an app-only hold when the charge point has no reservations', async () => {
    connectFake({ ReserveNow: Object.assign(new Error('nope'), { rpcErrorCode: 'NotSupported' }) });
    const res = await authed(request(app).post(`/api/admin/station-commands/${station.id}/connectors/1/hold`)).send({ idTag: 'VIP-8', minutes: 15 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const hold = await prisma.reservation.findUnique({ where: { id: res.body.id } });
    assert.equal(hold.ocppReservationId, null);
  });

  it('reads configuration from the saved copy while offline, and refuses read-only and unlisted keys', async () => {
    await prisma.station.update({
      where: { id: station.id },
      data: {
        configurationJson: JSON.stringify({
          keys: [
            { key: 'HeartbeatInterval', value: '300', readonly: false },
            { key: 'MeterValuesSampledData', value: 'Energy.Active.Import.Register', readonly: true },
          ],
          unknownKeys: [],
          at: new Date().toISOString(),
        }),
      },
    });
    const read = await authed(request(app).get(`/api/admin/station-commands/${station.id}/configuration`)).send();
    assert.equal(read.status, 200);
    assert.equal(read.body.fromCache, true);
    assert.equal(read.body.keys.length, 2);

    const readonly = await authed(request(app).put(`/api/admin/station-commands/${station.id}/configuration/MeterValuesSampledData`)).send({ value: 'Energy.Active.Import.Register' });
    assert.equal(readonly.status, 409);
    const unlisted = await authed(request(app).put(`/api/admin/station-commands/${station.id}/configuration/AuthorizationKey`)).send({ value: 'x' });
    assert.equal(unlisted.status, 400);
  });

  it('saves a changed setting once the charge point accepts it', async () => {
    const client = connectFake({ ChangeConfiguration: { status: 'Accepted' } });
    await prisma.station.update({
      where: { id: station.id },
      data: { configurationJson: JSON.stringify({ keys: [{ key: 'HeartbeatInterval', value: '300', readonly: false }], unknownKeys: [] }) },
    });
    const res = await authed(request(app).put(`/api/admin/station-commands/${station.id}/configuration/HeartbeatInterval`)).send({ value: '120' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(client.calls[0].params, { key: 'HeartbeatInterval', value: '120' });
    const saved = JSON.parse((await prisma.station.findUnique({ where: { id: station.id } })).configurationJson);
    assert.equal(saved.keys[0].value, '120');
  });

  it('shows the station status with readings, sessions and history', async () => {
    connectFake();
    await storeMeterValues(station.id, 1, 9, [{ timestamp: new Date().toISOString(), sampledValue: [{ measurand: ENERGY, value: '250', unit: 'Wh' }] }]);
    await prisma.transaction.create({ data: { stationId: station.id, connectorId: 1, idTag: 'DRV1', ocppTransactionId: 9, meterStart: 0 } });
    await prisma.stationEvent.create({ data: { stationId: station.id, kind: 'BOOT', detail: 'Test boot' } });
    const res = await authed(request(app).get(`/api/admin/stations/${station.id}/status`)).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.online, true);
    assert.equal(res.body.meterStatus, 'REPORTING');
    assert.equal(res.body.connectors[0].readings[ENERGY].value, 250);
    assert.equal(res.body.sessions.length, 1);
    assert.equal(res.body.events[0].kind, 'BOOT');
  });
});

describe('boot configuration', () => {
  it('turns on meter sampling with the site interval and marks the station configured', async () => {
    await prisma.paymentSettings.upsert({
      where: { tenantId: 'default' },
      create: { tenantId: 'default', meterSampleSeconds: 45 },
      update: { meterSampleSeconds: 45 },
    });
    const client = connectFake({
      GetConfiguration: {
        configurationKey: [
          { key: 'MeterValuesSampledData', value: 'Energy.Active.Import.Register', readonly: false },
          { key: 'MeterValueSampleInterval', value: '0', readonly: false },
          { key: 'StopTxnSampledData', value: '', readonly: false },
        ],
        unknownKey: [],
      },
      ChangeConfiguration: { status: 'Accepted' },
    });
    await configureMetering(await prisma.station.findUnique({ where: { id: station.id } }));
    const changed = client.calls.filter((c) => c.method === 'ChangeConfiguration').map((c) => c.params.key);
    assert.ok(changed.includes('MeterValueSampleInterval'));
    assert.ok(changed.includes('MeterValuesSampledData'));
    const interval = client.calls.find((c) => c.params?.key === 'MeterValueSampleInterval');
    assert.equal(interval.params.value, '45');
    assert.equal((await prisma.station.findUnique({ where: { id: station.id } })).meterStatus, 'CONFIGURED');
  });

  it('badges a charge point with no meter as having none', async () => {
    connectFake({
      GetConfiguration: { configurationKey: [{ key: 'HeartbeatInterval', value: '300', readonly: false }], unknownKey: ['MeterValuesSampledData'] },
    });
    await configureMetering(await prisma.station.findUnique({ where: { id: station.id } }));
    assert.equal((await prisma.station.findUnique({ where: { id: station.id } })).meterStatus, 'NONE');
  });
});

describe('billing with meter readings', () => {
  it('flags a session whose meter never moved while charging, rather than billing it free', async () => {
    await prisma.paymentSettings.upsert({
      where: { tenantId: 'default' },
      create: { tenantId: 'default', pricingModel: 'ENERGY', ratePerKwhCents: 30, energyPricingAcknowledgedAt: new Date() },
      update: { pricingModel: 'ENERGY', ratePerKwhCents: 30, energyPricingAcknowledgedAt: new Date() },
    });
    const started = new Date(Date.now() - 30 * 60_000);
    await prisma.transaction.create({
      data: { stationId: station.id, connectorId: 1, idTag: 'DRV9', ocppTransactionId: 77, meterStart: 0, meterStop: 0, startedAt: started, stoppedAt: new Date() },
    });
    await storeMeterValues(station.id, 1, 77, [
      { timestamp: started.toISOString(), sampledValue: [{ measurand: ENERGY, value: '500', unit: 'Wh' }, { measurand: 'Power.Active.Import', value: '7400', unit: 'W' }] },
      { timestamp: new Date(started.getTime() + 600_000).toISOString(), sampledValue: [{ measurand: ENERGY, value: '500', unit: 'Wh' }, { measurand: 'Power.Active.Import', value: '7400', unit: 'W' }] },
    ]);
    const charge = await createChargeForTransaction(station.id, 77);
    assert.equal(charge.status, 'NEEDS_REVIEW');
    assert.equal(charge.energySource, 'METER_VALUES');
    assert.match(charge.energyNote, /did not move/);
    assert.equal(charge.amountCents, 0);
  });
});

describe('watching stations', () => {
  it('alerts the admins who chose offline alerts once, and says when the charge point is back', async () => {
    await createAdmin({ email: 'wants-alerts@example.test' });
    await prisma.admin.update({ where: { email: 'wants-alerts@example.test' }, data: { alertOffline: true } });
    const lines = captureLog();
    const now = Date.now();
    await prisma.station.update({ where: { id: station.id }, data: { offlineSince: new Date(now - OFFLINE_GRACE_MS - 60_000) } });

    await watchStations(now);
    await watchStations(now + 60_000);
    const alerts = lines.filter((l) => l.includes('[alert -> wants-alerts@example.test]'));
    assert.equal(alerts.length, 1, lines.join('\n'));
    assert.equal((await prisma.station.findUnique({ where: { id: station.id } })).offlineAlertSent, true);

    connectFake();
    await watchStations(now + 120_000);
    assert.equal((await prisma.station.findUnique({ where: { id: station.id } })).offlineAlertSent, false);
    const events = await prisma.stationEvent.findMany({ where: { stationId: station.id }, orderBy: { at: 'asc' } });
    assert.deepEqual(events.map((e) => e.kind), ['OFFLINE', 'ONLINE']);
  });

  it('treats a connected charge point that has gone quiet as silent', async () => {
    connectFake();
    const now = Date.now();
    await prisma.station.update({ where: { id: station.id }, data: { lastSeenAt: new Date(now - SILENT_AFTER_MS - 1000) } });
    await watchStations(now);
    const st = await prisma.station.findUnique({ where: { id: station.id } });
    assert.equal(st.offlineAlertSent, true);
    const events = await prisma.stationEvent.findMany({ where: { stationId: station.id, kind: 'OFFLINE' } });
    assert.match(events[0].detail, /sent nothing/);
  });

  it('closes a session left open by a charge point that has been gone for hours', async () => {
    await prisma.paymentSettings.upsert({
      where: { tenantId: 'default' },
      create: { tenantId: 'default', pricingModel: 'FREE' },
      update: { pricingModel: 'FREE' },
    });
    const started = new Date(Date.now() - (STALE_AFTER_MS + 3_600_000));
    await prisma.transaction.create({ data: { stationId: station.id, connectorId: 1, idTag: 'DRV5', ocppTransactionId: 88, meterStart: 0, startedAt: started } });
    await storeMeterValues(station.id, 1, 88, [{ timestamp: started.toISOString(), sampledValue: [{ measurand: ENERGY, value: '3000', unit: 'Wh' }] }]);
    await closeStaleSessions();
    const tx = await prisma.transaction.findFirst({ where: { ocppTransactionId: 88 } });
    assert.ok(tx.stoppedAt);
    assert.equal(tx.stopReason, 'Stale');
    assert.equal(tx.meterStop, 3000);
    assert.ok(await prisma.charge.findFirst({ where: { transactionId: tx.id } }));
  });

  it('does not close a session while its charge point is connected', async () => {
    connectFake();
    const started = new Date(Date.now() - (STALE_AFTER_MS + 3_600_000));
    await prisma.transaction.create({ data: { stationId: station.id, connectorId: 1, idTag: 'DRV6', ocppTransactionId: 89, meterStart: 0, startedAt: started } });
    await closeStaleSessions();
    assert.equal((await prisma.transaction.findFirst({ where: { ocppTransactionId: 89 } })).stoppedAt, null);
  });

  it('records when a message was last seen, at most once a minute', async () => {
    const t0 = Date.now();
    await noteSeen(station.id, t0);
    await noteSeen(station.id, t0 + 10_000);
    const st = await prisma.station.findUnique({ where: { id: station.id } });
    assert.equal(st.lastSeenAt.getTime(), t0);
  });
});

describe('admin alerts', () => {
  it('goes only to the admins who chose that alert', async () => {
    await createAdmin({ email: 'fault-only@example.test' });
    await prisma.admin.update({ where: { email: 'fault-only@example.test' }, data: { alertOnFault: true } });
    await createAdmin({ email: 'offline-only@example.test' });
    await prisma.admin.update({ where: { email: 'offline-only@example.test' }, data: { alertOffline: true } });
    const lines = captureLog();
    const count = await notifyAdmins('FAULT', 'Fault', 'Body');
    assert.equal(count, 1);
    assert.ok(lines.some((l) => l.includes('[alert -> fault-only@example.test]')));
    assert.ok(!lines.some((l) => l.includes('offline-only@example.test')));
  });

  it('lets an admin change their own alert choices', async () => {
    const res = await authed(request(app).put('/api/auth/alerts')).send({ alertOnFault: true, alertOffline: false });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.alertOnFault, true);
    const me = await authed(request(app).get('/api/auth/me')).send();
    assert.equal(me.body.alertOnFault, true);
    const bad = await authed(request(app).put('/api/auth/alerts')).send({ alertOnFault: 'yes' });
    assert.equal(bad.status, 400);
  });
});

describe('meter settings', () => {
  it('saves the sampling and billing check settings, and refuses out-of-range values', async () => {
    const ok = await authed(request(app).put('/api/admin/payments/meter')).send({ meterSampleSeconds: 30, meterToleranceWh: 200 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.settings.meterSampleSeconds, 30);
    const bad = await authed(request(app).put('/api/admin/payments/meter')).send({ meterSampleSeconds: 2 });
    assert.equal(bad.status, 400);
  });
});
