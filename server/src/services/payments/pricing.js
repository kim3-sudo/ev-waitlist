// Works out what one finished charging session costs. Pure function: no I/O,
// so it can be tested directly.
//
// TIME: billed per started minute. Each minute is priced at the rate in effect
//       when it happens (the time-of-day schedule, else the base rate).
// ENERGY: billed per kWh of meter reading (meterStop - meterStart). Only as
//       accurate as the charger's meter, so sessions without a usable reading
//       are flagged NEEDS_REVIEW rather than billed. One rate applies to all
//       energy, so the schedule does not apply.
// FREE: drivers are not charged. Sessions are recorded as NO_CHARGE.

import { rateAt, rateGrid, scheduleFor } from './rates.js';

export const PRICING_MODELS = ['TIME', 'ENERGY', 'FREE'];

export function isInPeakWindow(date, startHour, endHour) {
  if (startHour == null || endHour == null || startHour === endHour) return false;
  const hour = date.getHours();
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

export function computeCharge(settings, { startedAt, stoppedAt, meterStart, meterStop }) {
  const durationSeconds = Math.max(0, Math.round((stoppedAt - startedAt) / 1000));
  const hasReading = meterStart != null && meterStop != null && meterStop >= meterStart;
  const energyWh = hasReading ? meterStop - meterStart : null;

  if (settings.pricingModel === 'FREE') {
    return { amountCents: 0, durationSeconds, energyWh, status: 'NO_CHARGE' };
  }

  if (settings.pricingModel === 'ENERGY') {
    if (energyWh == null) {
      return { amountCents: 0, durationSeconds, energyWh, status: 'NEEDS_REVIEW' };
    }
    const amountCents = Math.round((energyWh / 1000) * settings.ratePerKwhCents);
    return { amountCents, durationSeconds, energyWh, status: amountCents > 0 ? 'PENDING' : 'NO_CHARGE' };
  }

  const grid = rateGrid(settings.ratePerMinuteCents, scheduleFor(settings));
  const minutes = Math.ceil(durationSeconds / 60);
  let amountCents = 0;
  for (let m = 0; m < minutes; m += 1) {
    amountCents += rateAt(grid, new Date(startedAt.getTime() + m * 60_000));
  }
  return { amountCents, durationSeconds, energyWh, status: amountCents > 0 ? 'PENDING' : 'NO_CHARGE' };
}
