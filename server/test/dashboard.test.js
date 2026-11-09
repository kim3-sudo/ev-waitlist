import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectorCounts, offlineMs, uptimeRows, pricingConfigured, dailyRevenue } from '../src/services/dashboard.js';

const H = 60 * 60 * 1000;

describe('dashboard connector counts', () => {
  const station = (identity, connectors) => ({ identity, connectors });
  const connector = (connectorId, status, operative = true) => ({ connectorId, status, operative });

  it('buckets each physical connector once and counts offline stations separately', () => {
    const stations = [
      station('ON', [connector(0, 'Available'), connector(1, 'Available'), connector(2, 'Charging'), connector(3, 'Faulted'), connector(4, 'Reserved'), connector(5, 'Unavailable'), connector(6, 'Available', false)]),
      station('OFF', [connector(1, 'Charging'), connector(2, 'Available')]),
    ];
    const counts = connectorCounts(stations, (id) => id === 'ON');
    assert.deepEqual(counts, { total: 8, available: 1, inUse: 1, reserved: 1, error: 1, maintenance: 2, offline: 2 });
    const sum = counts.available + counts.inUse + counts.reserved + counts.error + counts.maintenance + counts.offline;
    assert.equal(sum, counts.total);
  });
});

describe('offline time', () => {
  it('sums OFFLINE to ONLINE gaps inside the window', () => {
    const from = 0;
    const to = 10 * H;
    const events = [
      { kind: 'OFFLINE', at: 2 * H },
      { kind: 'ONLINE', at: 3 * H },
      { kind: 'OFFLINE', at: 8 * H },
    ];
    assert.equal(offlineMs(events, false, from, to), 3 * H);
  });

  it('starts offline when the station was already offline at the window start', () => {
    assert.equal(offlineMs([{ kind: 'ONLINE', at: 1 * H }], true, 0, 5 * H), 1 * H);
  });

  it('counts a still-offline station up to the end of the window and clamps events to it', () => {
    assert.equal(offlineMs([{ kind: 'OFFLINE', at: -5 * H }], false, 0, 4 * H), 4 * H);
  });

  it('ignores a repeated OFFLINE while already offline', () => {
    const events = [
      { kind: 'OFFLINE', at: 1 * H },
      { kind: 'OFFLINE', at: 2 * H },
      { kind: 'ONLINE', at: 4 * H },
    ];
    assert.equal(offlineMs(events, false, 0, 10 * H), 3 * H);
  });
});

describe('uptime rows', () => {
  it('does not count time before a station existed', () => {
    const from = 0;
    const to = 10 * H;
    const stations = [{ id: 's1', name: 'New', createdAt: new Date(5 * H) }];
    const [row] = uptimeRows(stations, new Map(), new Map(), from, to);
    assert.equal(row.uptimePercent, 100);
    assert.equal(row.downtimeMinutes, 0);
  });

  it('reports uptime as the share of the window online', () => {
    const stations = [{ id: 's1', name: 'Bay', createdAt: new Date(0) }];
    const events = new Map([['s1', [{ kind: 'OFFLINE', at: 0 }, { kind: 'ONLINE', at: 2.5 * H }]]]);
    const [row] = uptimeRows(stations, events, new Map([['s1', 'ONLINE']]), 0, 10 * H);
    assert.equal(row.uptimePercent, 75);
    assert.equal(row.downtimeMinutes, 150);
  });
});

describe('pricing configured', () => {
  it('is false for a free site and true once a rate is set', () => {
    assert.equal(pricingConfigured({ pricingModel: 'FREE', ratePerMinuteCents: 30, ratePerKwhCents: 0, rateSchedule: null }), false);
    assert.equal(pricingConfigured({ pricingModel: 'TIME', ratePerMinuteCents: 0, ratePerKwhCents: 0, rateSchedule: null }), false);
    assert.equal(pricingConfigured({ pricingModel: 'TIME', ratePerMinuteCents: 30, ratePerKwhCents: 0, rateSchedule: null }), true);
    assert.equal(pricingConfigured({ pricingModel: 'ENERGY', ratePerMinuteCents: 0, ratePerKwhCents: 40, rateSchedule: null }), true);
  });
});

describe('daily revenue', () => {
  it('groups paid amounts by local day, oldest first, including captured holds', () => {
    const charges = [
      { amountCents: 100, holdCapturedCents: 0, paidAt: new Date(2026, 10, 9, 18) },
      { amountCents: 50, holdCapturedCents: 25, paidAt: new Date(2026, 10, 8, 9) },
      { amountCents: 10, holdCapturedCents: 0, paidAt: new Date(2026, 10, 9, 7) },
    ];
    assert.deepEqual(dailyRevenue(charges), [
      { day: '2026-11-08', revenueCents: 75 },
      { day: '2026-11-09', revenueCents: 110 },
    ]);
  });
});
