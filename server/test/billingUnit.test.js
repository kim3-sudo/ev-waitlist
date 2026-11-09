import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './support/testApp.js';
import { resetDb } from './support/db.js';
import { createAdmin } from './support/factories.js';
import { computeCharge } from '../src/services/payments/pricing.js';
import { highestPricePerKwhCents } from '../src/services/payments/rateCheck.js';

let token;

beforeEach(async () => {
  await resetDb();
  const admin = await createAdmin({ password: 'CorrectHorse1!' });
  const { body } = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'CorrectHorse1!' });
  token = body.token;
});

function authed(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

const start = new Date(2026, 5, 1, 10, 0, 0); // a Monday, 10:00 local time
const after = (minutes) => new Date(start.getTime() + minutes * 60_000);

describe('time billing unit', () => {
  it('bills every started minute at the per-minute rate', () => {
    const settings = { pricingModel: 'TIME', timeBillingUnit: 'MINUTE', ratePerMinuteCents: 5, rateSchedule: '[]' };
    const charge = computeCharge(settings, { startedAt: start, stoppedAt: after(90) });
    assert.equal(charge.amountCents, 450);
  });

  it('bills every started hour at the per-hour rate', () => {
    const settings = { pricingModel: 'TIME', timeBillingUnit: 'HOUR', ratePerMinuteCents: 500, rateSchedule: '[]' };
    // 90 minutes is two started hours.
    const charge = computeCharge(settings, { startedAt: start, stoppedAt: after(90) });
    assert.equal(charge.amountCents, 1000);
    // Ten minutes is still one started hour.
    assert.equal(computeCharge(settings, { startedAt: start, stoppedAt: after(10) }).amountCents, 500);
  });

  it('prices each started hour by the window in effect when that hour starts', () => {
    const settings = {
      pricingModel: 'TIME',
      timeBillingUnit: 'HOUR',
      ratePerMinuteCents: 300,
      rateSchedule: JSON.stringify([{ days: [1], startHour: 11, endHour: 12, rate: 900 }]),
    };
    // 10:00 at the base rate (300), then 11:00 in the window (900).
    assert.equal(computeCharge(settings, { startedAt: start, stoppedAt: after(120) }).amountCents, 1200);
  });

  it('reads a per-hour price for the price check as cents per kWh at the charger power', () => {
    const perHour = highestPricePerKwhCents(
      { pricingModel: 'TIME', timeBillingUnit: 'HOUR', ratePerMinuteCents: 740, rateSchedule: '[]' },
      7.4,
    );
    assert.equal(Math.round(perHour), 100);
    const perMinute = highestPricePerKwhCents(
      { pricingModel: 'TIME', timeBillingUnit: 'MINUTE', ratePerMinuteCents: 10, rateSchedule: '[]' },
      7.4,
    );
    assert.equal(Math.round(perMinute), 81);
  });

  it('saves the unit and refuses an unknown one', async () => {
    const ok = await authed(request(app).put('/api/admin/payments/settings')).send({
      pricingModel: 'TIME',
      timeBillingUnit: 'HOUR',
      ratePerMinuteCents: 200,
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.settings.timeBillingUnit, 'HOUR');

    const bad = await authed(request(app).put('/api/admin/payments/settings')).send({ timeBillingUnit: 'DAY' });
    assert.equal(bad.status, 400);
  });
});

describe('payments defaults and the calculator', () => {
  it('starts a new site in free charging', async () => {
    const res = await authed(request(app).get('/api/admin/payments/settings'));
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.pricingModel, 'FREE');
    assert.equal(res.body.settings.timeBillingUnit, 'MINUTE');
  });

  it('shows conservative calculator values until the admin saves some', async () => {
    const res = await authed(request(app).get('/api/admin/payments/settings'));
    assert.equal(res.body.calculatorIsDefault, true);
    assert.equal(res.body.calculatorInputs.marginPercent, 20);
    assert.ok(res.body.calculator, 'the defaults give a price');
  });

  it('auto-saves calculator inputs without changing the price', async () => {
    const before = await authed(request(app).get('/api/admin/payments/settings'));
    const res = await authed(request(app).put('/api/admin/payments/calculator')).send({
      rateCalculatorInputs: { ...before.body.calculatorInputs, monthlyKwh: 2500, energyCostPerKwhCents: 28 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.calculatorInputs.monthlyKwh, 2500);
    assert.ok(res.body.calculator.costPerKwhCents > 0);

    const after = await authed(request(app).get('/api/admin/payments/settings'));
    assert.equal(after.body.calculatorIsDefault, false);
    assert.equal(after.body.calculatorInputs.monthlyKwh, 2500);
    assert.equal(after.body.settings.pricingModel, 'FREE', 'the auto-save does not change the charge mode');
  });

  it('refuses invalid calculator input on auto-save', async () => {
    const res = await authed(request(app).put('/api/admin/payments/calculator')).send({
      rateCalculatorInputs: { energyCostPerKwhCents: -5 },
    });
    assert.equal(res.status, 400);
  });
});
