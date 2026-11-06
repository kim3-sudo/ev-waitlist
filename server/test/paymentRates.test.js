import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { prisma } from '../src/db.js';
import { setSiteSettings } from './support/siteSettings.js';
import { computeCharge } from '../src/services/payments/pricing.js';
import { validateSchedule, rateGrid, rateAt } from '../src/services/payments/rates.js';
import { calculateRate, priceCheck, highestPricePerKwhCents, validateCalculatorInputs } from '../src/services/payments/rateCheck.js';
import { createChargeForTransaction } from '../src/services/payments/chargeService.js';
import {
  createHoldForEntry,
  isWaitlistAuthorized,
  markHoldInUse,
  releaseOpenHoldsFor,
} from '../src/services/payments/holds.js';
import { setHoldAdapterForTests, resetHoldAdaptersForTests } from '../src/services/payments/holdAdapters.js';
import { tariffOf } from '../src/ocpi/mappers.js';

// Saturday 2026-01-03 and Monday 2026-01-05 (local time).
const SATURDAY_10 = new Date(2026, 0, 3, 10, 0, 0);
const MONDAY_10 = new Date(2026, 0, 5, 10, 0, 0);

describe('time-of-day rates (pure)', () => {
  const base = { pricingModel: 'TIME', ratePerMinuteCents: 30, peakRatePerMinuteCents: null, peakStartHour: null, peakEndHour: null, ratePerKwhCents: 0 };

  it('bills weekend minutes at a cheaper window rate and weekdays at the base rate', () => {
    const schedule = [{ days: [0, 6], startHour: 0, endHour: 24, rate: 10 }];
    const settings = { ...base, rateSchedule: JSON.stringify(schedule) };
    const weekend = computeCharge(settings, { startedAt: SATURDAY_10, stoppedAt: new Date(SATURDAY_10.getTime() + 60_000) });
    const weekday = computeCharge(settings, { startedAt: MONDAY_10, stoppedAt: new Date(MONDAY_10.getTime() + 60_000) });
    assert.equal(weekend.amountCents, 10);
    assert.equal(weekday.amountCents, 30);
  });

  it('handles a window that runs past midnight, on the day it starts and the next day', () => {
    const grid = rateGrid(30, validateSchedule([{ days: [5], startHour: 22, endHour: 6, rate: 5 }]).rules);
    assert.equal(rateAt(grid, new Date(2026, 0, 2, 23, 0)), 5, 'Friday 23:00 is in the window');
    assert.equal(rateAt(grid, new Date(2026, 0, 3, 3, 0)), 5, 'Saturday 03:00 is the tail of the window');
    assert.equal(rateAt(grid, new Date(2026, 0, 3, 12, 0)), 30, 'Saturday noon is the base rate');
    assert.equal(rateAt(grid, new Date(2026, 0, 2, 3, 0)), 30, 'Friday 03:00 is not in the window');
  });

  it('refuses overlapping windows and names the hour where they clash', () => {
    const result = validateSchedule([
      { days: [1], startHour: 8, endHour: 18, rate: 20 },
      { days: [1, 2], startHour: 17, endHour: 20, rate: 40 },
    ]);
    assert.match(result.error, /overlap on MONDAY at 17:00/);
  });

  it('refuses a window whose start and end are the same hour, and a window with no days', () => {
    assert.match(validateSchedule([{ days: [1], startHour: 9, endHour: 9, rate: 10 }]).error, /same hour/);
    assert.match(validateSchedule([{ days: [], startHour: 9, endHour: 10, rate: 10 }]).error, /at least one day/);
  });

  it('makes the free model charge nothing and record the session as NO_CHARGE', () => {
    const out = computeCharge({ ...base, pricingModel: 'FREE' }, { startedAt: MONDAY_10, stoppedAt: new Date(MONDAY_10.getTime() + 3_600_000) });
    assert.equal(out.amountCents, 0);
    assert.equal(out.status, 'NO_CHARGE');
  });
});

describe('rate calculator and price check (pure)', () => {
  it('works out the cost per kWh from grid energy, distribution and fixed monthly charges, then adds the margin', () => {
    // 1000 kWh a month: 20c energy + 5c distribution per kWh, 50 + 150 a month fixed.
    const out = calculateRate({
      energyCostPerKwhCents: 20,
      distributionPerKwhCents: 5,
      customerChargePerMonthCents: 5000,
      infrastructurePerMonthCents: 15000,
      monthlyKwh: 1000,
      marginPercent: 20,
    });
    assert.equal(out.costPerKwhCents, 45);
    assert.ok(Math.abs(out.pricePerKwhCents - 56.25) < 1e-9);
  });

  it('lets solar cover the first kWh it makes, so only the rest is bought from the grid', () => {
    // 5 kW x 1200 kWh/kW/yr = 500 kWh a month from solar, free to run. The grid covers the other 500.
    const out = calculateRate({
      energyCostPerKwhCents: 20,
      distributionPerKwhCents: 5,
      solarKw: 5,
      solarKwhPerKwPerYear: 1200,
      customerChargePerMonthCents: 5000,
      infrastructurePerMonthCents: 15000,
      monthlyKwh: 1000,
      marginPercent: 0,
    });
    assert.equal(out.solarKwhPerMonth, 500);
    assert.equal(out.gridKwhPerMonth, 500);
    assert.equal(out.costPerKwhCents, 32.5);
  });

  it('refuses solar capacity without a yield, and a margin of 100 percent or more', () => {
    assert.match(validateCalculatorInputs({ solarKw: 5, monthlyKwh: 100 }).error, /solar yield/);
    assert.match(validateCalculatorInputs({ monthlyKwh: 100, marginPercent: 100 }).error, /under 100/);
    assert.equal(calculateRate({ energyCostPerKwhCents: 20 }), null, 'no expected energy means no result');
  });

  it('flags a Level 2 price far above cost, with a stricter limit than for high-power chargers', () => {
    const level2 = priceCheck({ priceCentsPerKwh: 120, costCentsPerKwh: 45, powerKw: 7.4 });
    assert.equal(level2.level, 'WARN', '2.7x the cost on Level 2 warns');
    assert.equal(priceCheck({ priceCentsPerKwh: 200, costCentsPerKwh: 45, powerKw: 7.4 }).level, 'STRONG');
    assert.equal(priceCheck({ priceCentsPerKwh: 120, costCentsPerKwh: 45, powerKw: 50 }).level, 'OK', '2.7x is fine for a 50 kW charger');
  });

  it('has nothing to compare with until the calculator has been used', () => {
    assert.equal(priceCheck({ priceCentsPerKwh: 999, costCentsPerKwh: 0, powerKw: 7.4 }).level, 'NONE');
  });

  it('converts a per-minute rate to a per-kWh price using the charger power', () => {
    const settings = { pricingModel: 'TIME', ratePerMinuteCents: 20, peakRatePerMinuteCents: null, peakStartHour: null, peakEndHour: null, ratePerKwhCents: 0 };
    // 20c a minute at 6 kW is 20 * 60 / 6 = 200c a kWh.
    assert.equal(highestPricePerKwhCents(settings, 6), 200);
  });
});

describe('payment settings: rates, price check and holds', () => {
  let adminToken;
  const admin = (method, path) => request(app)[method](`/api/admin/payments${path}`).set('Authorization', `Bearer ${adminToken}`);

  beforeEach(async () => {
    await resetDb();
    await setSiteSettings({ 'stripe.secretKey': 'sk_test_fake', 'stripe.webhookSecret': 'whsec_fake', 'braintree.merchantId': '' });
    const user = await createAdmin();
    const { body } = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
    adminToken = body.token;
  });

  it('saves a free-charging site, which records sessions as no charge', async () => {
    const res = await admin('put', '/settings').send({ pricingModel: 'FREE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.pricingModel, 'FREE');
  });

  it('refuses an overlapping schedule with the reason', async () => {
    const res = await admin('put', '/settings').send({
      ratePerMinuteCents: 30,
      rateSchedule: [
        { days: [0, 6], startHour: 0, endHour: 24, rate: 10 },
        { days: [6], startHour: 12, endHour: 14, rate: 20 },
      ],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /overlap/);
  });

  it('asks for confirmation before saving a rate far above the cost, and saves once confirmed', async () => {
    const calculatorInputs = { energyCostPerKwhCents: 20, monthlyKwh: 1000, marginPercent: 10 };
    // Cost is 20c a kWh. An 8c-a-minute rate at 7.4 kW is about 65c a kWh, 3.2x cost: a warning on Level 2 (2.5x), not yet strong (4x).
    const payload = { pricingModel: 'TIME', ratePerMinuteCents: 8, referencePowerKw: 7.4, rateCalculatorInputs: calculatorInputs };
    const refused = await admin('put', '/settings').send(payload);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'HIGH_RATE');
    assert.equal(refused.body.check.level, 'WARN');

    const confirmed = await admin('put', '/settings').send({ ...payload, highRateConfirmed: true });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.check.level, 'WARN');
  });

  it('previews the calculator and the price check without saving anything', async () => {
    const res = await admin('post', '/preview').send({
      pricingModel: 'ENERGY',
      ratePerKwhCents: 60,
      energyPricingAcknowledged: true,
      rateCalculatorInputs: { energyCostPerKwhCents: 20, monthlyKwh: 1000, marginPercent: 10 },
    });
    assert.equal(res.status, 200);
    // 60c against a 20c cost is 3x. With no charger power set, the check assumes Level 2, where 2.5x warns.
    assert.equal(res.body.check.level, 'WARN');
    assert.ok(res.body.calculator.pricePerKwhCents > 0);
    const current = await admin('get', '/settings');
    assert.equal(current.body.settings.pricingModel, 'FREE', 'the preview saved nothing');
  });

  it('refuses card holds with Square, and with free charging', async () => {
    await setSiteSettings({ 'square.accessToken': 'EAAA', 'square.locationId': 'L1', 'square.webhookSignatureKey': 'k' });
    const square = await admin('put', '/settings').send({ pricingModel: 'TIME', provider: 'SQUARE', preauthCents: 5000 });
    assert.equal(square.status, 400);
    assert.match(square.body.error, /Stripe or Braintree/);

    const free = await admin('put', '/settings').send({ pricingModel: 'FREE', preauthCents: 5000 });
    assert.equal(free.status, 400);
    assert.match(free.body.error, /Pre-authorization holds/);
  });
});

describe('card holds (pre-authorization)', () => {
  let captures;
  let releases;
  let adapter;

  async function fixtures({ preauthCents = 5000, ratePerMinuteCents = 25 } = {}) {
    await prisma.paymentSettings.create({ data: { provider: 'STRIPE', preauthCents, ratePerMinuteCents } });
    const station = await prisma.station.create({ data: { identity: 'HOLD-001', name: 'Garage Bay 2' } });
    const entry = await prisma.queueEntry.create({
      data: { stationId: station.id, name: 'Driver', contact: 'driver@example.test', idTag: 'TAGHOLD000001', position: 1, status: 'NOTIFIED' },
    });
    await prisma.reservation.create({
      data: { queueEntryId: entry.id, stationId: station.id, connectorId: 1, expiresAt: new Date(Date.now() + 600_000) },
    });
    return { station, entry };
  }

  // What the driver's browser does: start Checkout, then come back and confirm.
  async function placeStripeHold(hold) {
    await request(app).post(`/api/pay/hold/${hold.token}/stripe`).send({});
    const confirmed = await request(app).post(`/api/pay/hold/${hold.token}/stripe/confirm`).send({});
    assert.equal(confirmed.body.status, 'HELD');
  }

  async function finishedSession(station, { minutes = 10, ocppId = 501 } = {}) {
    const tx = await prisma.transaction.create({
      data: {
        stationId: station.id,
        connectorId: 1,
        idTag: 'TAGHOLD000001',
        ocppTransactionId: ocppId,
        meterStart: 0,
        meterStop: 2000,
        startedAt: new Date(Date.now() - minutes * 60_000),
        stoppedAt: new Date(),
      },
    });
    return tx;
  }

  beforeEach(async () => {
    await resetDb();
    await setSiteSettings({ 'stripe.secretKey': 'sk_test_fake', 'stripe.webhookSecret': 'whsec_fake' });
    captures = [];
    releases = [];
    adapter = {
      async startCheckout() {
        return { sessionRef: 'cs_test_1', url: 'https://checkout.example.test/cs_test_1' };
      },
      async confirmCheckout() {
        return { held: true, providerRef: 'pi_test_1' };
      },
      async capture(ref, amount) {
        captures.push([ref, amount]);
      },
      async release(ref) {
        releases.push(ref);
      },
    };
    setHoldAdapterForTests('STRIPE', adapter);
  });

  afterEach(() => resetHoldAdaptersForTests());

  it('holds the driver to the hold: no authorization until the card is held', async () => {
    const { station, entry } = await fixtures();
    const hold = await createHoldForEntry(entry);
    assert.equal(hold.status, 'AWAITING');
    assert.equal(await isWaitlistAuthorized(station.id, entry.idTag), false, 'not yet held');

    const started = await request(app).post(`/api/pay/hold/${hold.token}/stripe`).send({});
    assert.equal(started.status, 200);
    assert.equal(started.body.url, 'https://checkout.example.test/cs_test_1');

    const confirmed = await request(app).post(`/api/pay/hold/${hold.token}/stripe/confirm`).send({});
    assert.equal(confirmed.body.status, 'HELD');
    assert.equal(await isWaitlistAuthorized(station.id, entry.idTag), true);
  });

  it('captures the actual cost when the session stops, and the charge is paid in full', async () => {
    const { station, entry } = await fixtures({ preauthCents: 5000, ratePerMinuteCents: 25 });
    const hold = await createHoldForEntry(entry);
    await placeStripeHold(hold);
    const tx = await finishedSession(station);
    await markHoldInUse(entry.idTag, tx.id);

    const charge = await createChargeForTransaction(station.id, 501);
    assert.equal(charge.status, 'PAID');
    assert.equal(charge.holdCapturedCents, 250, 'ten minutes at 25c');
    assert.equal(charge.amountCents, 0, 'nothing left owed');
    assert.deepEqual(captures, [['pi_test_1', 250]], 'only the actual cost is taken');
    assert.equal((await prisma.paymentHold.findUnique({ where: { id: hold.id } })).status, 'CAPTURED');
  });

  it('takes the whole hold when the session costs more, and sends a payment link for the rest', async () => {
    // Ten minutes at 600c a minute is 6000c: the 5000c hold covers part, and 1000c is still owed.
    const { station, entry } = await fixtures({ preauthCents: 5000, ratePerMinuteCents: 600 });
    const hold = await createHoldForEntry(entry);
    await placeStripeHold(hold);
    const tx = await finishedSession(station);
    await markHoldInUse(entry.idTag, tx.id);

    const charge = await createChargeForTransaction(station.id, 501);
    assert.equal(charge.status, 'PENDING');
    assert.equal(charge.holdCapturedCents, 5000, 'the whole hold');
    assert.equal(charge.amountCents, 1000, 'the balance, paid through the link');
    assert.deepEqual(captures, [['pi_test_1', 5000]]);
  });

  it('releases the hold, not charges it, when the driver cancels before starting', async () => {
    const { station, entry } = await fixtures();
    const hold = await createHoldForEntry(entry);
    await placeStripeHold(hold);
    await releaseOpenHoldsFor(entry.idTag);
    assert.deepEqual(releases, ['pi_test_1']);
    assert.equal((await prisma.paymentHold.findUnique({ where: { id: hold.id } })).status, 'RELEASED');
    assert.equal(await isWaitlistAuthorized(station.id, entry.idTag), false);
  });

  it('falls back to a payment link for the whole amount when the capture fails', async () => {
    const { station, entry } = await fixtures({ preauthCents: 5000, ratePerMinuteCents: 25 });
    const hold = await createHoldForEntry(entry);
    await placeStripeHold(hold);
    const tx = await finishedSession(station);
    await markHoldInUse(entry.idTag, tx.id);
    adapter.capture = async () => {
      throw new Error('hold expired');
    };

    const charge = await createChargeForTransaction(station.id, 501);
    assert.equal(charge.status, 'PENDING');
    assert.equal(charge.holdCapturedCents, 0);
    assert.equal(charge.amountCents, 250, 'the driver pays the whole amount through the link');
    assert.equal((await prisma.paymentHold.findUnique({ where: { id: hold.id } })).status, 'FAILED');
  });

  it('does not place a hold when holds are off for the site', async () => {
    const { entry } = await fixtures({ preauthCents: null });
    assert.equal(await createHoldForEntry(entry), null);
  });
});

describe('OCPI tariff from the schedule (pure)', () => {
  const operator = { countryCode: 'NL', partyId: 'XYZ' };
  const settings = {
    pricingModel: 'TIME',
    currency: 'EUR',
    ratePerMinuteCents: 30,
    ratePerKwhCents: 0,
    rateSchedule: JSON.stringify([
      { days: [0, 6], startHour: 0, endHour: 24, rate: 10 },
      { days: [5], startHour: 22, endHour: 6, rate: 5 },
    ]),
  };

  it('sends each window as a restricted element, splits a window past midnight, and puts the base rate last', () => {
    const elements = tariffOf(operator, settings).elements;
    // Weekend (one element), Friday night split across Friday and Saturday (two elements), then the base rate.
    assert.equal(elements.length, 4);
    assert.deepEqual(elements[0].restrictions.day_of_week, ['SUNDAY', 'SATURDAY']);
    assert.equal(elements[0].restrictions.start_time, '00:00');
    assert.equal(elements[0].restrictions.end_time, '23:59');
    assert.deepEqual(elements[1].restrictions, { day_of_week: ['FRIDAY'], start_time: '22:00', end_time: '23:59' });
    assert.deepEqual(elements[2].restrictions, { day_of_week: ['SATURDAY'], start_time: '00:00', end_time: '06:00' });
    assert.equal(elements[3].restrictions, undefined, 'the base rate has no restrictions');
    assert.equal(Number(elements[3].price_components[0].price), 18, '30 cents a minute is 18 an hour');
  });

  it('sends free charging as a zero price with no windows', () => {
    const elements = tariffOf(operator, { ...settings, pricingModel: 'FREE' }).elements;
    assert.equal(elements.length, 1);
    assert.equal(Number(elements[0].price_components[0].price), 0);
  });
});
