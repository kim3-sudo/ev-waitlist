import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  planPhaseLimits,
  scheduleCapAt,
  phaseCapacityAt,
  windowCovers,
  connectorPhases,
  SmartChargingConfigError,
  MIN_AMPS,
} from '../src/services/smartCharging.js';

const ALL = ['L1', 'L2', 'L3'];
const cap = (L1, L2 = L1, L3 = L1) => ({ L1, L2, L3 });
const conn = (key, { active = true, maxAmps = 32, phases = ALL } = {}) => ({ key, active, maxAmps, phases });
const limitsOf = (out) => Object.fromEntries(out.limits.map((l) => [l.key, l.limitAmps]));

describe('configuration checks', () => {
  it('accepts a full configuration and gives schedules and events their ids', () => {
    const c = normalizeConfig({
      timeZone: 'Europe/London',
      phaseCapacityA: cap(100),
      schedules: [{ name: 'Evening', days: [1, 2], start: '17:00', end: '21:00', limitAmps: 16 }],
      events: [{ name: 'Curtailment', startsAt: '2026-11-09T16:00:00Z', endsAt: '2026-11-09T18:00:00Z', phaseCapacityA: cap(40) }],
    });
    assert.equal(c.schedules[0].limitAmps, 16);
    assert.ok(c.schedules[0].id && c.events[0].id, 'every item has an id');
    assert.equal(c.events[0].startsAt, '2026-11-09T16:00:00.000Z');
  });

  it('refuses a bad time zone, a limit outside the charging range, and an event with no phase capacity', () => {
    assert.throws(() => normalizeConfig({ timeZone: 'Mars/Olympus' }), SmartChargingConfigError);
    assert.throws(
      () => normalizeConfig({ schedules: [{ name: 'x', days: [1], start: '01:00', end: '02:00', limitAmps: 3 }] }),
      /limit in whole amps from 6 to 80/,
    );
    assert.throws(
      () => normalizeConfig({ events: [{ name: 'e', startsAt: '2026-01-01T00:00Z', endsAt: '2026-01-01T01:00Z', phaseCapacityA: cap(10) }] }),
      /phase capacity must be set first/,
    );
  });

  it('refuses a schedule with the same start and end, a bad time, and an event that ends before it starts', () => {
    assert.throws(() => normalizeConfig({ schedules: [{ name: 'x', days: [1], start: '10:00', end: '10:00', limitAmps: 16 }] }), /different times/);
    assert.throws(() => normalizeConfig({ schedules: [{ name: 'x', days: [1], start: '25:00', end: '10:00', limitAmps: 16 }] }), /HH:MM/);
    assert.throws(
      () => normalizeConfig({ phaseCapacityA: cap(50), events: [{ name: 'e', startsAt: '2026-01-02T00:00Z', endsAt: '2026-01-01T00:00Z', phaseCapacityA: cap(10) }] }),
      /end after it starts/,
    );
  });
});

describe('time-of-day windows', () => {
  const day = (d, minute) => ({ day: d, minute });

  it('covers the hours from start up to, but not including, end', () => {
    const s = { days: [1], start: '17:00', end: '21:00' };
    assert.equal(windowCovers(s, day(1, 17 * 60)), true);
    assert.equal(windowCovers(s, day(1, 21 * 60 - 1)), true);
    assert.equal(windowCovers(s, day(1, 21 * 60)), false);
    assert.equal(windowCovers(s, day(2, 18 * 60)), false, 'not on a day in the list');
  });

  it('an overnight window belongs to the day it starts on, and runs into the next morning', () => {
    const s = { days: [5], start: '22:00', end: '06:00' }; // Friday night into Saturday morning
    assert.equal(windowCovers(s, day(5, 23 * 60)), true);
    assert.equal(windowCovers(s, day(6, 5 * 60)), true, 'Saturday early morning is part of Friday night');
    assert.equal(windowCovers(s, day(6, 23 * 60)), false, 'Saturday night is not on the list');
    assert.equal(windowCovers(s, day(0, 5 * 60)), false, 'Sunday early morning belongs to Saturday, which is not listed');
  });

  it('uses the local time of the site, not the server clock', () => {
    const config = normalizeConfig({
      timeZone: 'America/New_York',
      schedules: [{ name: 'Peak', days: [1, 2, 3, 4, 5], start: '17:00', end: '21:00', limitAmps: 16 }],
    });
    // 22:30 UTC on a Monday in November is 17:30 in New York (UTC-5): inside the window.
    assert.equal(scheduleCapAt(config, 'S1', new Date('2026-11-09T22:30:00Z')), 16);
    // 23:30 UTC is 18:30 in New York, still inside. 02:30 UTC Tuesday is 21:30 Monday, outside.
    assert.equal(scheduleCapAt(config, 'S1', new Date('2026-11-10T02:30:00Z')), null);
  });

  it('takes the most restrictive overlapping limit, and applies a schedule only to the charge points it names', () => {
    const config = normalizeConfig({
      timeZone: 'UTC',
      schedules: [
        { name: 'Wide', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', limitAmps: 24 },
        { name: 'Peak', days: [0, 1, 2, 3, 4, 5, 6], start: '17:00', end: '21:00', limitAmps: 12, stationIds: ['S2'] },
      ],
    });
    const at = new Date('2026-11-09T18:00:00Z');
    assert.equal(scheduleCapAt(config, 'S1', at), 24, 'S1 is not in the peak schedule');
    assert.equal(scheduleCapAt(config, 'S2', at), 12, 'S2 takes the stricter limit');
  });
});

describe('dynamic events', () => {
  const config = normalizeConfig({
    timeZone: 'UTC',
    phaseCapacityA: cap(100, 90, 80),
    events: [
      { name: 'Curtail A', startsAt: '2026-11-09T16:00:00Z', endsAt: '2026-11-09T18:00:00Z', phaseCapacityA: cap(40, 60, 50) },
      { name: 'Curtail B', startsAt: '2026-11-09T17:00:00Z', endsAt: '2026-11-09T19:00:00Z', phaseCapacityA: cap(30, 70, 70) },
    ],
  });

  it('keeps the base capacity when no event is active', () => {
    assert.deepEqual(phaseCapacityAt(config, new Date('2026-11-09T12:00:00Z')), cap(100, 90, 80));
  });

  it('applies the lowest capacity per phase while events overlap, and ends them at their end time', () => {
    assert.deepEqual(phaseCapacityAt(config, new Date('2026-11-09T17:30:00Z')), cap(30, 60, 50));
    assert.deepEqual(phaseCapacityAt(config, new Date('2026-11-09T18:00:00Z')), cap(30, 70, 70), 'Curtail A ends at 18:00');
  });
});

describe('phase-aware allocation', () => {
  it('gives a lone three-phase connector its own maximum, while the supply allows', () => {
    const out = planPhaseLimits({ capacityA: cap(100), connectors: [conn('a', { maxAmps: 32 })] });
    assert.equal(limitsOf(out).a, 32);
    assert.equal(out.overCapacity, false);
  });

  it('shares a three-phase supply equally between two connectors', () => {
    const out = planPhaseLimits({ capacityA: cap(40), connectors: [conn('a'), conn('b')] });
    assert.deepEqual(limitsOf(out), { a: 20, b: 20 });
  });

  it('lets a single-phase connector use up its own phase, so the three-phase connector shares only that phase', () => {
    // L1 is the tight phase. A three-phase car and a single-phase car both load L1.
    const out = planPhaseLimits({
      capacityA: cap(20, 40, 40),
      connectors: [conn('three'), conn('one', { phases: ['L1'] })],
    });
    assert.deepEqual(limitsOf(out), { three: 10, one: 10 });
    assert.deepEqual(out.saturatedPhases, ['L1']);
  });

  it('a single-phase connector on a quiet phase does not hold back the three-phase connector', () => {
    const out = planPhaseLimits({
      capacityA: cap(30),
      connectors: [conn('three', { maxAmps: 32 }), conn('l2only', { maxAmps: 32, phases: ['L2'] })],
    });
    // L1 and L3 carry only the three-phase car, and L2 carries both. L2 is the limit: 15 each.
    assert.deepEqual(limitsOf(out), { three: 15, l2only: 15 });
  });

  it('gives the capacity a connector cannot use to the others', () => {
    const out = planPhaseLimits({ capacityA: cap(40), connectors: [conn('a', { maxAmps: 10 }), conn('b', { maxAmps: 32 })] });
    assert.deepEqual(limitsOf(out), { a: 10, b: 30 });
  });

  it('rounds down to whole amps, so no phase is loaded above its capacity', () => {
    const out = planPhaseLimits({ capacityA: cap(40), connectors: [conn('a'), conn('b'), conn('c')] });
    assert.deepEqual(limitsOf(out), { a: 13, b: 13, c: 13 });
  });

  it('leaves idle connectors at their own maximum', () => {
    const out = planPhaseLimits({
      capacityA: cap(30),
      connectors: [conn('a'), conn('idle', { active: false, maxAmps: 16 })],
    });
    assert.deepEqual(limitsOf(out), { a: 30, idle: 16 });
  });

  it('reports an over-capacity supply, and keeps every active connector at the minimum', () => {
    const out = planPhaseLimits({ capacityA: cap(20), connectors: [conn('a'), conn('b'), conn('c'), conn('d')] });
    assert.equal(out.overCapacity, true);
    assert.ok(out.limits.every((l) => l.limitAmps === MIN_AMPS));
  });

  it('treats an unlimited phase as no limit', () => {
    const out = planPhaseLimits({ capacityA: { L1: Infinity, L2: Infinity, L3: Infinity }, connectors: [conn('a', { maxAmps: 20 }), conn('b', { maxAmps: 25 })] });
    assert.deepEqual(limitsOf(out), { a: 20, b: 25 });
  });

  it('never loads a phase above its capacity, for many random combinations of connectors', () => {
    // A small deterministic generator, so the test is repeatable.
    let seed = 42;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const phaseSets = [ALL, ['L1'], ['L2'], ['L3'], ['L1', 'L2'], ['L2', 'L3']];
    for (let run = 0; run < 400; run += 1) {
      const capacityA = cap(10 + rand(90), 10 + rand(90), 10 + rand(90));
      const n = 1 + rand(6);
      const connectors = Array.from({ length: n }, (_, i) => ({
        key: `c${i}`,
        active: rand(4) !== 0,
        maxAmps: 6 + rand(27),
        phases: phaseSets[rand(phaseSets.length)],
      }));
      const out = planPhaseLimits({ capacityA, connectors });
      const limits = limitsOf(out);
      for (const phase of ALL) {
        const load = connectors.filter((c) => c.active && c.phases.includes(phase)).reduce((s, c) => s + limits[c.key], 0);
        const activeOnPhase = connectors.filter((c) => c.active && c.phases.includes(phase)).length;
        if (activeOnPhase * MIN_AMPS <= capacityA[phase]) {
          assert.ok(load <= capacityA[phase] + 1e-9, `run ${run}: ${phase} loaded ${load} above ${capacityA[phase]}`);
        }
      }
      for (const c of connectors) {
        assert.ok(limits[c.key] <= c.maxAmps, `run ${run}: ${c.key} above its maximum`);
        assert.ok(limits[c.key] >= Math.min(MIN_AMPS, c.maxAmps), `run ${run}: ${c.key} below the minimum`);
      }
    }
  });
});

describe('connector wiring', () => {
  it('uses all three phases for a three-phase connector, and its own phase for a single-phase one', () => {
    assert.deepEqual(connectorPhases({ phaseCount: 3, phase: null }), ALL);
    assert.deepEqual(connectorPhases({ phaseCount: 1, phase: 'L2' }), ['L2']);
    assert.deepEqual(connectorPhases({ phaseCount: 1, phase: null }), ['L1']);
  });

  it('counts an unknown connector on every phase, the safe choice for the supply', () => {
    assert.deepEqual(connectorPhases({ phaseCount: null, phase: null }), ALL);
  });
});
