import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma, rawPrisma } from '../src/db.js';
import { computeCharge } from '../src/services/payments/pricing.js';
import {
  NO_ADJUSTMENT,
  adjustRate,
  adjustmentAt,
  appliesTo,
  describeAdjustment,
  powerClassOf,
  ruleShapeError,
} from '../src/services/payments/priceRules.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';

// Pure price-change rules, the per-unit billing with them, and the charge that a
// finished session gets. The admin API is covered in alerts.test.js.

const T0 = new Date(2026, 5, 1, 10, 0, 0); // a Monday, 10:00 local time
const at = (minutes) => new Date(T0.getTime() + minutes * 60_000);
const HOUR = 60 * 60_000;
const ctx = { tenantId: 'default', stationId: 'station-1', zoneId: 'zone-1', powerClass: 'AC' };

// A rule that is active from T0 - 1h to T0 + 2h, unless overridden.
function rule(over = {}) {
  return {
    id: over.id ?? `rule-${Math.random()}`,
    kind: 'SURGE',
    scope: 'SITE',
    tenantId: 'default',
    zoneId: null,
    stationId: null,
    powerClass: null,
    percent: 25,
    label: '',
    startsAt: new Date(T0.getTime() - HOUR),
    endsAt: new Date(T0.getTime() + 2 * HOUR),
    ...over,
  };
}

describe('which price changes apply to a charge point', () => {
  it('matches each scope to the right charge points', () => {
    assert.equal(appliesTo(rule({ scope: 'SITE' }), ctx), true);
    assert.equal(appliesTo(rule({ scope: 'SITE', tenantId: 'other' }), ctx), false);
    assert.equal(appliesTo(rule({ scope: 'NETWORK', tenantId: null }), ctx), true);
    assert.equal(appliesTo(rule({ scope: 'NETWORK', tenantId: 'default' }), ctx), false);
    assert.equal(appliesTo(rule({ scope: 'ZONE', zoneId: 'zone-1' }), ctx), true);
    assert.equal(appliesTo(rule({ scope: 'ZONE', zoneId: 'zone-2' }), ctx), false);
    assert.equal(appliesTo(rule({ scope: 'STATION', stationId: 'station-1' }), ctx), true);
    assert.equal(appliesTo(rule({ scope: 'STATION', stationId: 'station-9' }), ctx), false);
    assert.equal(appliesTo(rule({ scope: 'POWER_TYPE', powerClass: 'AC' }), ctx), true);
    assert.equal(appliesTo(rule({ scope: 'POWER_TYPE', powerClass: 'DC' }), ctx), false);
    assert.equal(appliesTo(rule({ scope: 'POWER_TYPE', powerClass: 'AC' }), { ...ctx, powerClass: null }), false);
  });

  it('is only in effect between its start and end', () => {
    const r = rule({ startsAt: at(0), endsAt: at(10) });
    assert.equal(adjustmentAt([r], at(-1), ctx), NO_ADJUSTMENT);
    assert.equal(adjustmentAt([r], at(0), ctx).percent, 25);
    assert.equal(adjustmentAt([r], at(9), ctx).percent, 25);
    assert.equal(adjustmentAt([r], at(10), ctx), NO_ADJUSTMENT);
  });

  it('lets complimentary charging win over any surge', () => {
    const surge = rule({ id: 's', scope: 'STATION', stationId: 'station-1', percent: 50 });
    const free = rule({ id: 'c', kind: 'COMPLIMENTARY', scope: 'NETWORK', tenantId: null, percent: null });
    assert.equal(adjustmentAt([surge, free], at(0), ctx).free, true);
  });

  it('uses the most specific surge', () => {
    const site = rule({ id: 'site', scope: 'SITE', percent: 10 });
    const station = rule({ id: 'station', scope: 'STATION', stationId: 'station-1', percent: -20 });
    assert.equal(adjustmentAt([site, station], at(0), ctx).percent, -20);
    const zone = rule({ id: 'zone', scope: 'ZONE', zoneId: 'zone-1', percent: 30 });
    const connector = rule({ id: 'ac', scope: 'POWER_TYPE', powerClass: 'AC', percent: 5 });
    assert.equal(adjustmentAt([connector, zone], at(0), ctx).percent, 30);
  });

  it('uses the later-starting surge when two of the same scope overlap', () => {
    const earlier = rule({ id: 'a', scope: 'SITE', percent: 10, startsAt: at(-120) });
    const later = rule({ id: 'b', scope: 'SITE', percent: 40, startsAt: at(-30) });
    assert.equal(adjustmentAt([earlier, later], at(0), ctx).percent, 40);
    assert.equal(adjustmentAt([later, earlier], at(0), ctx).percent, 40);
  });

  it('rounds the adjusted rate to whole cents', () => {
    assert.equal(adjustRate(5, { free: false, percent: 25, rule: null }), 6);
    assert.equal(adjustRate(5, { free: false, percent: -20, rule: null }), 4);
    assert.equal(adjustRate(5, { free: true, percent: 0, rule: null }), 0);
    assert.equal(adjustRate(5, NO_ADJUSTMENT), 5);
  });

  it('describes the change for the charges list', () => {
    const r = rule({ label: 'Event night' });
    assert.equal(describeAdjustment({ free: false, percent: 25, rule: r }), 'Price change +25% (Event night)');
    assert.equal(describeAdjustment({ free: false, percent: -15, rule: rule() }), 'Price change -15%');
    assert.equal(describeAdjustment({ free: true, percent: 0, rule: rule({ kind: 'COMPLIMENTARY' }) }), 'Complimentary charging');
  });

  it('maps a connector power type to AC or DC', () => {
    assert.equal(powerClassOf('DC'), 'DC');
    assert.equal(powerClassOf('AC_3_PHASE'), 'AC');
    assert.equal(powerClassOf(null), null);
  });
});

describe('checking a price change before it is saved', () => {
  const base = {
    kind: 'SURGE',
    scope: 'SITE',
    percent: 25,
    label: '',
    startsAt: at(0),
    endsAt: at(60),
  };

  it('accepts a valid surge and a complimentary change without an end', () => {
    assert.equal(ruleShapeError(base, { now: at(-5), isNew: true }), null);
    assert.equal(ruleShapeError({ ...base, kind: 'COMPLIMENTARY', percent: null, endsAt: null }, { now: at(-5), isNew: true }), null);
  });

  it('refuses a surge without an end, or with a zero or out-of-range change', () => {
    assert.ok(ruleShapeError({ ...base, endsAt: null }, { now: at(-5), isNew: true }));
    assert.ok(ruleShapeError({ ...base, percent: 0 }, { now: at(-5), isNew: true }));
    assert.ok(ruleShapeError({ ...base, percent: 301 }, { now: at(-5), isNew: true }));
    assert.ok(ruleShapeError({ ...base, percent: -100 }, { now: at(-5), isNew: true }));
    assert.ok(ruleShapeError({ ...base, percent: 12.5 }, { now: at(-5), isNew: true }));
  });

  it('refuses a complimentary change that has a percentage, and a power-type change without AC or DC', () => {
    assert.ok(ruleShapeError({ ...base, kind: 'COMPLIMENTARY', endsAt: null }, { now: at(-5), isNew: true }));
    assert.ok(ruleShapeError({ ...base, scope: 'POWER_TYPE', powerClass: null }, { now: at(-5), isNew: true }));
  });

  it('refuses an end before the start, and an end in the past only for a new change', () => {
    assert.ok(ruleShapeError({ ...base, endsAt: at(0) }, { now: at(-5), isNew: true }));
    assert.ok(ruleShapeError({ ...base, startsAt: at(-120), endsAt: at(-60) }, { now: at(-5), isNew: true }));
    // Ending a running change now is allowed.
    assert.equal(ruleShapeError({ ...base, startsAt: at(-120), endsAt: at(-5) }, { now: at(-5), isNew: false }), null);
  });
});

describe('billing a session with price changes', () => {
  const timeSettings = {
    pricingModel: 'TIME',
    timeBillingUnit: 'MINUTE',
    ratePerMinuteCents: 5,
    rateSchedule: '[]',
  };

  it('prices each minute at the change in effect when it starts', () => {
    // +100% from the fifth minute: five minutes at 5c, then five at 10c.
    const surge = rule({ scope: 'NETWORK', tenantId: null, percent: 100, startsAt: at(5), endsAt: at(60) });
    const charge = computeCharge(timeSettings, {
      startedAt: T0,
      stoppedAt: at(10),
      adjustmentAt: (d) => adjustmentAt([surge], d, ctx),
    });
    assert.equal(charge.amountCents, 75);
    assert.equal(charge.pricingNote, 'Price change +100%');
    assert.equal(charge.status, 'PENDING');
  });

  it('makes the first minutes free when complimentary charging starts later in the session', () => {
    const free = rule({ kind: 'COMPLIMENTARY', percent: null, startsAt: at(-5), endsAt: at(3) });
    const charge = computeCharge(timeSettings, {
      startedAt: T0,
      stoppedAt: at(10),
      adjustmentAt: (d) => adjustmentAt([free], d, ctx),
    });
    // Minutes 0-2 are free; minutes 3-9 cost 5c each.
    assert.equal(charge.amountCents, 35);
    assert.equal(charge.pricingNote, 'Complimentary charging');
  });

  it('is free and recorded as no charge when complimentary charging covers the session', () => {
    const free = rule({ kind: 'COMPLIMENTARY', percent: null, startsAt: at(-5), endsAt: at(60) });
    const charge = computeCharge(timeSettings, {
      startedAt: T0,
      stoppedAt: at(10),
      adjustmentAt: (d) => adjustmentAt([free], d, ctx),
    });
    assert.equal(charge.amountCents, 0);
    assert.equal(charge.status, 'NO_CHARGE');
  });

  it('applies a change to energy billing at the time the session starts', () => {
    const energySettings = { pricingModel: 'ENERGY', ratePerKwhCents: 30, energyPricingAcknowledgedAt: T0 };
    const discount = rule({ scope: 'SITE', percent: -50, startsAt: at(-5), endsAt: at(60) });
    const charge = computeCharge(energySettings, {
      startedAt: T0,
      stoppedAt: at(40),
      meterStart: 0,
      meterStop: 10_000,
      adjustmentAt: (d) => adjustmentAt([discount], d, ctx),
    });
    assert.equal(charge.amountCents, 150);
    assert.equal(charge.pricingNote, 'Price change -50%');
  });

  it('does not ask for review when a session is complimentary but has no meter reading', () => {
    const energySettings = { pricingModel: 'ENERGY', ratePerKwhCents: 30, energyPricingAcknowledgedAt: T0 };
    const free = rule({ kind: 'COMPLIMENTARY', percent: null, startsAt: at(-5), endsAt: at(60) });
    const charge = computeCharge(energySettings, {
      startedAt: T0,
      stoppedAt: at(40),
      adjustmentAt: (d) => adjustmentAt([free], d, ctx),
    });
    assert.equal(charge.status, 'NO_CHARGE');
    assert.equal(charge.amountCents, 0);
  });

  it('bills the same as before when there are no price changes', () => {
    const charge = computeCharge(timeSettings, { startedAt: T0, stoppedAt: at(10) });
    assert.equal(charge.amountCents, 50);
    assert.equal(charge.pricingNote, null);
  });
});

describe('charges for finished sessions use the price changes', () => {
  let token;
  let station;

  beforeEach(async () => {
    await resetDb();
    const admin = await createAdmin({ password: 'CorrectHorse1!' });
    token = (await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' })).body.token;
    await prisma.paymentSettings.upsert({
      where: { tenantId: 'default' },
      create: { tenantId: 'default', pricingModel: 'TIME', ratePerMinuteCents: 10, provider: 'NONE' },
      update: { pricingModel: 'TIME', ratePerMinuteCents: 10, provider: 'NONE', rateSchedule: '[]' },
    });
    station = await prisma.station.create({ data: { identity: 'CP-PRICE', name: 'Charger P' } });
    await prisma.connector.create({ data: { stationId: station.id, connectorId: 1, powerType: 'AC_1_PHASE' } });
    await prisma.connector.create({ data: { stationId: station.id, connectorId: 2, powerType: 'DC' } });
  });

  // A finished ten-minute session that started now, on the given connector.
  async function finishedSession(connectorId, ocppTransactionId) {
    const now = Date.now();
    await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId,
        idTag: `TAG-${ocppTransactionId}`,
        ocppTransactionId,
        startedAt: new Date(now - 10 * 60_000),
        stoppedAt: new Date(now),
      },
    });
    return createChargeForTransaction(station.id, ocppTransactionId);
  }

  // A price change through the admin API, active from an hour ago to an hour from now.
  async function postRule(body) {
    const now = Date.now();
    return request(app)
      .post('/api/admin/price-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startsAt: new Date(now - 60 * 60_000).toISOString(),
        endsAt: new Date(now + 60 * 60_000).toISOString(),
        ...body,
      });
  }

  it('bills a session at a surged charge point, with a note', async () => {
    const res = await postRule({ kind: 'SURGE', scope: 'STATION', stationId: station.id, percent: 50, label: 'Busy' });
    assert.equal(res.status, 201);
    const charge = await finishedSession(1, 1);
    assert.equal(charge.amountCents, 150);
    assert.equal(charge.status, 'PENDING');
    assert.equal(charge.pricingNote, 'Price change +50% (Busy)');
  });

  it('makes a session free at a complimentary charge point', async () => {
    const res = await postRule({ kind: 'COMPLIMENTARY', scope: 'STATION', stationId: station.id, label: 'Opening day' });
    assert.equal(res.status, 201);
    const charge = await finishedSession(1, 2);
    assert.equal(charge.amountCents, 0);
    assert.equal(charge.status, 'NO_CHARGE');
    assert.equal(charge.pricingNote, 'Complimentary charging (Opening day)');
  });

  it('applies a DC change to DC connectors only', async () => {
    const res = await postRule({ kind: 'SURGE', scope: 'POWER_TYPE', powerClass: 'DC', percent: 100 });
    assert.equal(res.status, 201);
    assert.equal((await finishedSession(1, 3)).amountCents, 100);
    assert.equal((await finishedSession(2, 4)).amountCents, 200);
  });
});
