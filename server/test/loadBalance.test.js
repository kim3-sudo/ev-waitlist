import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb } from './support/db.js';
import { prisma, rawPrisma } from '../src/db.js';
import { registry } from '../src/services/stationRegistry.js';
import { planLimits, rebalanceSite, forgetLimits, MIN_AMPS } from '../src/services/loadBalance.js';

const IDENTITY = 'LB-1';

beforeEach(async () => {
  await resetDb();
  forgetLimits('default');
  await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: false, siteCapacityKw: null } });
});

afterEach(() => {
  registry.remove(IDENTITY);
  registry.remove('LB-2');
});

// A fake charge point that records each command and accepts it.
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

async function site({ identity = IDENTITY, maxAmperage = 32, smart = true } = {}) {
  const s = await prisma.station.create({ data: { identity, name: identity, smartChargingEnabled: smart } });
  await prisma.connector.createMany({
    data: [
      { stationId: s.id, connectorId: 1, status: 'Charging', maxAmperage },
      { stationId: s.id, connectorId: 2, status: 'Available', maxAmperage },
    ],
  });
  return s;
}

describe('the allocation', () => {
  it('shares the supply equally between the connectors that are charging', () => {
    // 10 kW across two charging connectors: 5 kW each, which is 21 A at 230 V.
    const out = planLimits({
      capacityKw: 10,
      connectors: [
        { key: 'a', active: true, maxAmps: 32, voltage: 230 },
        { key: 'b', active: true, maxAmps: 32, voltage: 230 },
      ],
    });
    assert.deepEqual(out.limits.map((l) => l.limitAmps), [21, 21]);
    assert.equal(out.overCapacity, false);
  });

  it('leaves a lone charging connector at its own maximum, and an idle one at its maximum too', () => {
    const out = planLimits({
      capacityKw: 10,
      connectors: [
        { key: 'a', active: true, maxAmps: 32, voltage: 230 },
        { key: 'b', active: false, maxAmps: 16, voltage: 230 },
      ],
    });
    assert.equal(out.limits[0].limitAmps, 32, 'the lone car is capped at the connector, not the supply');
    assert.equal(out.limits[1].limitAmps, 16, 'an idle connector keeps its own maximum for the next car');
  });

  it('never goes below the minimum, and says so when the supply cannot cover it', () => {
    const out = planLimits({
      capacityKw: 2,
      connectors: [
        { key: 'a', active: true, maxAmps: 32, voltage: 230 },
        { key: 'b', active: true, maxAmps: 32, voltage: 230 },
        { key: 'c', active: true, maxAmps: 32, voltage: 230 },
        { key: 'd', active: true, maxAmps: 32, voltage: 230 },
      ],
    });
    assert.ok(out.limits.every((l) => l.limitAmps === MIN_AMPS));
    assert.equal(out.overCapacity, true);
  });
});

describe('running the balance on a site', () => {
  it('does nothing while load balancing is off, and says why', async () => {
    await site();
    const out = await rebalanceSite('default');
    assert.match(out.skipped, /turned off/);
  });

  it('sends each connector its limit, and sends nothing again while the limits are unchanged', async () => {
    const s = await site();
    await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: true, siteCapacityKw: 6.9 } });
    await prisma.transaction.create({
      data: { stationId: s.id, connectorId: 1, idTag: 'T1', ocppTransactionId: 9001, startedAt: new Date() },
    });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);

    const first = await rebalanceSite('default');
    assert.equal(first.sent, 2);
    const byConnector = Object.fromEntries(fake.calls.map((c) => [c.params.connectorId, c.params.csChargingProfiles.chargingSchedule.chargingSchedulePeriod[0].limit]));
    assert.equal(byConnector[1], 30, 'the charging connector gets 6.9 kW, which is 30 A at 230 V');
    assert.equal(byConnector[2], 32, 'the idle connector is left at its maximum');
    assert.equal(fake.calls[0].params.csChargingProfiles.stackLevel, 1, 'the balance overrides a manual limit');
    assert.equal(fake.calls[0].params.csChargingProfiles.chargingProfilePurpose, 'TxDefaultProfile');

    const second = await rebalanceSite('default');
    assert.equal(second.sent, 0, 'unchanged limits are not sent again');
  });

  it('skips a charge point that is offline, and reports it', async () => {
    await site();
    await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: true, siteCapacityKw: 7 } });
    const out = await rebalanceSite('default');
    assert.equal(out.sent, 0);
    assert.equal(out.skippedOffline, 2);
  });

  it('leaves charge points without smart charging alone', async () => {
    await site({ smart: false });
    await rawPrisma.tenant.update({ where: { id: 'default' }, data: { loadBalancingEnabled: true, siteCapacityKw: 7 } });
    const fake = fakeClient();
    registry.add(IDENTITY, fake);
    const out = await rebalanceSite('default');
    assert.match(out.skipped, /No charge point/);
    assert.equal(fake.calls.length, 0);
  });
});
