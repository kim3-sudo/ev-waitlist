import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb } from './support/db.js';
import { prisma, rawPrisma } from '../src/db.js';
import { registry } from '../src/services/stationRegistry.js';
import { rebalanceSite, rebalanceAllSites, forgetLimits, ceilingWarnings, ceilingWarningFor } from '../src/services/loadBalance.js';

// The balancer, end to end against the database, with a fake charge point that records what it is sent.
const IDENTITY = 'SC-1';
const NOON_UTC = new Date('2026-11-09T12:00:00Z');

beforeEach(async () => {
  await resetDb();
  forgetLimits('default');
  await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: false, siteCapacityKw: null, smartChargingConfig: null } });
});

afterEach(() => {
  registry.remove(IDENTITY);
});

function fakeClient() {
  const calls = [];
  return {
    protocol: 'ocpp1.6',
    calls,
    async call(method, params) {
      calls.push({ method, params });
      return { status: 'Accepted' };
    },
  };
}

// Sent limits, by connector: the last limit sent for each.
function sentLimits(fake) {
  const out = {};
  for (const c of fake.calls) {
    if (c.method !== 'SetChargingProfile') continue;
    out[c.params.connectorId] = c.params.csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0].limit;
  }
  return out;
}

async function setConfig(config) {
  await rawPrisma.tenant.update({ where: { id: 'default' }, data: { smartChargingConfig: JSON.stringify(config) } });
}

// Two connectors on one charge point. Connector 1 is three-phase, connector 2 is single-phase on L1.
async function wiredSite({ connectorTwoStatus = 'Charging' } = {}) {
  const s = await prisma.station.create({ data: { identity: IDENTITY, name: IDENTITY, smartChargingEnabled: true } });
  await prisma.connector.createMany({
    data: [
      { stationId: s.id, connectorId: 1, status: 'Charging', maxAmperage: 32, phaseCount: 3 },
      { stationId: s.id, connectorId: 2, status: connectorTwoStatus, maxAmperage: 32, phaseCount: 1, phase: 'L1' },
    ],
  });
  await prisma.transaction.create({ data: { stationId: s.id, connectorId: 1, idTag: 'T1', ocppTransactionId: 7001, startedAt: new Date() } });
  if (connectorTwoStatus === 'Charging') {
    await prisma.transaction.create({ data: { stationId: s.id, connectorId: 2, idTag: 'T2', ocppTransactionId: 7002, startedAt: new Date() } });
  }
  return s;
}

async function balancingOn() {
  await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: true } });
}

describe('phase-aware balancing on a site', () => {
  it('keeps the phase it shares within its capacity, and says which phase is the limit', async () => {
    await wiredSite();
    await balancingOn();
    await setConfig({ timeZone: 'UTC', phaseCapacityA: { L1: 30, L2: 30, L3: 30 }, schedules: [], events: [] });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    const out = await rebalanceSite('default', NOON_UTC);
    assert.equal(out.mode, 'phase');
    assert.deepEqual(out.saturatedPhases, ['L1']);
    // Both connectors draw on L1, so they share it: 15 A each.
    assert.deepEqual(sentLimits(fake), { 1: 15, 2: 15 });
  });

  it('ignores the phase capacity while load balancing is off', async () => {
    await wiredSite();
    await setConfig({ timeZone: 'UTC', phaseCapacityA: { L1: 30, L2: 30, L3: 30 }, schedules: [], events: [] });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    const out = await rebalanceSite('default', NOON_UTC);
    assert.match(out.skipped, /turned off/);
    assert.deepEqual(sentLimits(fake), {}, 'nothing is sent');
  });

  it('applies a dynamic event that is active now, and returns to the base capacity when it ends', async () => {
    await wiredSite();
    await balancingOn();
    await setConfig({
      timeZone: 'UTC',
      phaseCapacityA: { L1: 60, L2: 60, L3: 60 },
      schedules: [],
      events: [{ name: 'Utility curtailment', startsAt: '2026-11-09T11:00:00Z', endsAt: '2026-11-09T13:00:00Z', phaseCapacityA: { L1: 20, L2: 20, L3: 20 } }],
    });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    await rebalanceSite('default', NOON_UTC);
    assert.deepEqual(sentLimits(fake), { 1: 10, 2: 10 }, 'the curtailment gives L1 20 A, shared two ways');

    const after = new Date('2026-11-09T13:30:00Z');
    await rebalanceSite('default', after);
    assert.deepEqual(sentLimits(fake), { 1: 30, 2: 30 }, 'after the event, the base of 60 A on L1 is shared two ways: 30 A each, below their 32 A maximum');
  });
});

describe('time-of-day schedules', () => {
  it('caps a connector during its window even when load balancing is off', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setConfig({
      timeZone: 'UTC',
      schedules: [{ name: 'Off-peak only', days: [0, 1, 2, 3, 4, 5, 6], start: '10:00', end: '14:00', limitAmps: 16 }],
      events: [],
    });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    const out = await rebalanceSite('default', NOON_UTC);
    assert.equal(out.mode, 'schedule');
    assert.deepEqual(sentLimits(fake), { 1: 16, 2: 16 }, 'both connectors take the 16 A cap, charging or idle');
  });

  it('lifts the cap when the window ends', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setConfig({
      timeZone: 'UTC',
      schedules: [{ name: 'Midday', days: [0, 1, 2, 3, 4, 5, 6], start: '10:00', end: '14:00', limitAmps: 16 }],
      events: [],
    });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    await rebalanceSite('default', NOON_UTC);
    await rebalanceSite('default', new Date('2026-11-09T15:00:00Z'));
    assert.equal(sentLimits(fake)[1], 32, 'the charge point is sent its own maximum again');
  });

  it('the minute ticker re-runs the balance for every site with a schedule set', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setConfig({
      timeZone: 'UTC',
      schedules: [{ name: 'Always', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', limitAmps: 20 }],
      events: [],
    });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    const results = await rebalanceAllSites(NOON_UTC);
    assert.equal(results.default.mode, 'schedule');
    assert.equal(sentLimits(fake)[1], 20);
  });

  it('a site with nothing set is skipped, as before', async () => {
    await wiredSite();
    const out = await rebalanceSite('default', NOON_UTC);
    assert.match(out.skipped, /turned off/);
  });
});

describe('manual limits as ceilings', () => {
  const ALWAYS = [0, 1, 2, 3, 4, 5, 6];

  async function setManual(connectorId, amps) {
    await prisma.connector.updateMany({ where: { connectorId }, data: { manualLimitAmps: amps } });
  }

  it('the balance never goes above a connector\'s manual limit', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setManual(1, 10);
    await setConfig({ timeZone: 'UTC', schedules: [{ name: 'Wide', days: ALWAYS, start: '00:00', end: '23:59', limitAmps: 16 }], events: [] });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    await rebalanceSite('default', NOON_UTC);
    assert.deepEqual(sentLimits(fake), { 1: 10, 2: 16 }, 'connector 1 is held to its manual 10 A, below the 16 A schedule');
  });

  it('a manual limit above the schedule is held down, and the admin is warned', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setManual(1, 20);
    await setConfig({ timeZone: 'UTC', schedules: [{ name: 'Peak', days: ALWAYS, start: '10:00', end: '14:00', limitAmps: 16 }], events: [] });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    await rebalanceSite('default', NOON_UTC);
    assert.equal(sentLimits(fake)[1], 16, 'the schedule ceiling wins over the manual 20 A');

    const warnings = await ceilingWarnings('default', NOON_UTC);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].manualAmps, 20);
    assert.equal(warnings[0].scheduleAmps, 16);
    assert.equal(warnings[0].scheduleName, 'Peak');
    assert.match(warnings[0].message, /manual limit of 20 A is above the schedule "Peak"/);

    const history = JSON.stringify(await prisma.stationEvent.findMany({ where: { stationId: warnings[0].stationId } }));
    assert.match(history, /manual limit of 20 A is above the schedule/, 'the warning is kept in the charge point history');
  });

  it('gives a warning on setting a limit above the ceiling, and none when it is below', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setConfig({ timeZone: 'UTC', schedules: [{ name: 'Peak', days: ALWAYS, start: '10:00', end: '14:00', limitAmps: 16 }], events: [] });
    const s = await prisma.station.findFirst({ where: { identity: IDENTITY } });

    assert.match(await ceilingWarningFor('default', s.id, 20, NOON_UTC), /above the schedule/);
    assert.equal(await ceilingWarningFor('default', s.id, 12, NOON_UTC), null);
    assert.equal(await ceilingWarningFor('default', s.id, 20, new Date('2026-11-09T15:00:00Z')), null, 'no warning once the schedule is not running');
  });

  it('no warning is listed when the manual limit is at or below the schedule', async () => {
    await wiredSite({ connectorTwoStatus: 'Available' });
    await setManual(1, 16);
    await setConfig({ timeZone: 'UTC', schedules: [{ name: 'Peak', days: ALWAYS, start: '10:00', end: '14:00', limitAmps: 16 }], events: [] });
    assert.deepEqual(await ceilingWarnings('default', NOON_UTC), []);
  });

  it('removes the balance profiles it sent when balancing and schedules are both turned off', async () => {
    await wiredSite();
    await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: true, siteCapacityKw: 6.9 } });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);
    await rebalanceSite('default', NOON_UTC);
    assert.ok(sentLimits(fake)[1] < 32, 'the balance limited connector 1');

    await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: false, siteCapacityKw: null } });
    const out = await rebalanceSite('default', NOON_UTC);
    assert.match(out.skipped, /turned off/);
    const cleared = fake.calls.filter((c) => c.method === 'ClearChargingProfile');
    assert.ok(cleared.some((c) => c.params.id === 201 && c.params.connectorId === 1), 'the balance profile for connector 1 is cleared');
  });
});
