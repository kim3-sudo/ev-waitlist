import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { windowActiveAt } from '../src/services/payments/rates.js';
import { driverPricing } from '../src/services/payments/driverPricing.js';
import { normalizeHelpContacts, parseHelpContacts } from '../src/services/helpContacts.js';

// 9 Nov 2026 is a Monday (day 1). Local time, as the app reads it.
const at = (day, hour, minute = 0) => new Date(2026, 10, 9 + (day - 1), hour, minute);

describe('windowActiveAt', () => {
  it('covers its own hours on its own days only', () => {
    const peak = { days: [1, 2, 3, 4, 5], startHour: 17, endHour: 22, rate: 40 };
    assert.equal(windowActiveAt(peak, at(1, 18)), true);
    assert.equal(windowActiveAt(peak, at(1, 22)), false, 'the end hour is not in the window');
    assert.equal(windowActiveAt(peak, at(1, 16, 59)), false);
    assert.equal(windowActiveAt(peak, at(6, 18)), false, 'Saturday is not a weekday');
  });

  it('runs an overnight window into the next morning', () => {
    const night = { days: [5], startHour: 22, endHour: 6, rate: 10 };
    assert.equal(windowActiveAt(night, at(5, 23)), true, 'Friday evening');
    assert.equal(windowActiveAt(night, at(6, 3)), true, 'Saturday small hours belong to Friday night');
    assert.equal(windowActiveAt(night, at(6, 7)), false);
    assert.equal(windowActiveAt(night, at(4, 23)), false);
  });
});

describe('driverPricing', () => {
  const base = {
    pricingModel: 'TIME',
    currency: 'USD',
    timeBillingUnit: 'MINUTE',
    ratePerMinuteCents: 25,
    rateSchedule: JSON.stringify([{ days: [1, 2, 3, 4, 5], startHour: 17, endHour: 22, rate: 40 }]),
  };

  it('says nothing is shown for a free site', () => {
    assert.deepEqual(driverPricing({ pricingModel: 'FREE' }, at(1, 18)), { enabled: false });
    assert.deepEqual(driverPricing(null, at(1, 18)), { enabled: false });
  });

  it('gives the peak rate now and marks the peak window as active', () => {
    const pricing = driverPricing(base, at(1, 18));
    assert.equal(pricing.enabled, true);
    assert.equal(pricing.currentRateCents, 40);
    assert.equal(pricing.baseRateCents, 25);
    assert.equal(pricing.unit, 'MINUTE');
    assert.deepEqual(pricing.windows, [
      { days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], startHour: 17, endHour: 22, rateCents: 40, active: true },
    ]);
  });

  it('gives the standard rate when no window applies', () => {
    const pricing = driverPricing(base, at(1, 10));
    assert.equal(pricing.currentRateCents, 25);
    assert.equal(pricing.windows[0].active, false);
  });

  it('uses the legacy single peak window for sites without a saved schedule', () => {
    const legacy = { ...base, rateSchedule: null, peakRatePerMinuteCents: 60, peakStartHour: 8, peakEndHour: 9 };
    const pricing = driverPricing(legacy, at(3, 8, 30));
    assert.equal(pricing.currentRateCents, 60);
    assert.equal(pricing.windows.length, 1);
    assert.equal(pricing.windows[0].days.length, 7);
  });

  it('reports the per-kWh rate for energy pricing, with no windows', () => {
    const pricing = driverPricing({ pricingModel: 'ENERGY', currency: 'EUR', ratePerKwhCents: 32 }, at(1, 18));
    assert.deepEqual(pricing, {
      enabled: true,
      model: 'ENERGY',
      currency: 'EUR',
      unit: 'KWH',
      baseRateCents: 32,
      currentRateCents: 32,
      windows: [],
    });
  });
});

describe('normalizeHelpContacts', () => {
  it('trims entries, drops blanks and keeps the contact form link', () => {
    const result = normalizeHelpContacts({
      emails: [' help@example.com ', ''],
      phones: ['+1 (555) 123-4567'],
      contactFormUrl: ' https://example.com/contact ',
    });
    assert.deepEqual(result.value, {
      emails: ['help@example.com'],
      phones: ['+1 (555) 123-4567'],
      contactFormUrl: 'https://example.com/contact',
    });
  });

  it('accepts empty details', () => {
    assert.deepEqual(normalizeHelpContacts({ emails: [], phones: [], contactFormUrl: '' }).value, emptyResult());
  });

  it('refuses a bad e-mail address', () => {
    assert.match(normalizeHelpContacts({ emails: ['not-an-email'] }).error, /not an e-mail address/);
  });

  it('refuses a phone number with letters or too few digits', () => {
    assert.match(normalizeHelpContacts({ phones: ['call us'] }).error, /only digits/);
    assert.match(normalizeHelpContacts({ phones: ['12-34'] }).error, /between 5 and 15 digits/);
  });

  it('refuses a contact form link that is not a web address', () => {
    assert.match(normalizeHelpContacts({ contactFormUrl: 'example.com/contact' }).error, /full web address/);
    assert.match(normalizeHelpContacts({ contactFormUrl: 'javascript:alert(1)' }).error, /https/);
  });

  it('refuses more entries than the form allows', () => {
    const emails = Array.from({ length: 11 }, (_, i) => `h${i}@example.com`);
    assert.match(normalizeHelpContacts({ emails }).error, /at most 10/);
  });
});

describe('parseHelpContacts', () => {
  it('reads stored JSON and falls back to empty details', () => {
    assert.deepEqual(parseHelpContacts(JSON.stringify({ emails: ['a@b.co'], phones: [], contactFormUrl: '' })), {
      emails: ['a@b.co'],
      phones: [],
      contactFormUrl: '',
    });
    assert.deepEqual(parseHelpContacts('not json'), emptyResult());
    assert.deepEqual(parseHelpContacts(null), emptyResult());
  });
});

function emptyResult() {
  return { emails: [], phones: [], contactFormUrl: '' };
}
