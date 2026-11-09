import { DAY_NAMES, scheduleFor, windowActiveAt, rateAt, rateGrid } from './rates.js';

// The site's prices as a driver sees them: the base rate, the time-of-day windows, and
// which of them applies right now. Price changes (surge, complimentary) are not here;
// they come with each charge point's notices. Pure apart from `now`, so it can be tested.
//
// Time windows are only offered for per-minute or per-hour (TIME) pricing, the same
// model the charge calculation applies them to.
export function driverPricing(settings, now = new Date()) {
  if (!settings || settings.pricingModel === 'FREE') return { enabled: false };

  if (settings.pricingModel === 'ENERGY') {
    return {
      enabled: true,
      model: 'ENERGY',
      currency: settings.currency,
      unit: 'KWH',
      baseRateCents: settings.ratePerKwhCents,
      currentRateCents: settings.ratePerKwhCents,
      windows: [],
    };
  }

  const baseRateCents = settings.ratePerMinuteCents;
  const schedule = scheduleFor(settings);
  const windows = schedule.map((rule) => ({
    days: rule.days.map((d) => DAY_NAMES[d]),
    startHour: rule.startHour,
    endHour: rule.endHour,
    rateCents: rule.rate,
    active: windowActiveAt(rule, now),
  }));
  const currentRateCents = rateAt(rateGrid(baseRateCents, schedule), now);

  return {
    enabled: true,
    model: 'TIME',
    currency: settings.currency,
    unit: settings.timeBillingUnit === 'HOUR' ? 'HOUR' : 'MINUTE',
    baseRateCents,
    currentRateCents,
    windows,
  };
}
