// Works out what one finished charging session costs. Pure function: no I/O,
// so it can be tested directly.
//
// TIME: billed per started minute. Each minute is priced at the rate in effect
//       when it happens (the time-of-day schedule, else the base rate), then any
//       surge or complimentary change in effect at that minute.
// ENERGY: billed per kWh of meter reading (meterStop - meterStart). Only as
//       accurate as the charger's meter, so sessions without a usable reading
//       are flagged NEEDS_REVIEW rather than billed. One rate applies to all
//       energy, so the schedule does not apply. The price change in effect when
//       the session starts applies to all of its energy.
// FREE: drivers are not charged. Sessions are recorded as NO_CHARGE.

import { rateAt, rateGrid, scheduleFor } from './rates.js';
import { NO_ADJUSTMENT, adjustRate, describeAdjustment } from './priceRules.js';

export const PRICING_MODELS = ['TIME', 'ENERGY', 'FREE'];

export function isInPeakWindow(date, startHour, endHour) {
  if (startHour == null || endHour == null || startHour === endHour) return false;
  const hour = date.getHours();
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

// `energy` is the result of the billing check (payments/energyCheck.js). When it is
// given, its energy is billed and its review flag is respected. Without it, energy is
// the end-of-session reading.
// `adjustmentAt(date)` gives the price change in effect at a moment (see priceRules.js).
// Without it, prices are the site's own rates.
export function computeCharge(
  settings,
  { startedAt, stoppedAt, meterStart, meterStop, energy, adjustmentAt = () => NO_ADJUSTMENT },
) {
  const durationSeconds = Math.max(0, Math.round((stoppedAt - startedAt) / 1000));
  const hasReading = meterStart != null && meterStop != null && meterStop >= meterStart;
  const energyWh = energy ? energy.energyWh : hasReading ? meterStop - meterStart : null;
  const reviewEnergy = energy?.needsReview === true;
  const notes = new Set();
  const noteOf = (adjustment) => {
    if (adjustment.rule) notes.add(describeAdjustment(adjustment));
  };
  const result = (amountCents, status) => ({
    amountCents,
    durationSeconds,
    energyWh,
    status,
    pricingNote: notes.size > 0 ? [...notes].join('; ') : null,
  });

  if (settings.pricingModel === 'FREE') {
    return result(0, 'NO_CHARGE');
  }

  if (settings.pricingModel === 'ENERGY') {
    const adjustment = adjustmentAt(startedAt);
    noteOf(adjustment);
    // Complimentary charging needs no meter reading: there is nothing to bill.
    if (adjustment.free) return result(0, 'NO_CHARGE');
    if (energyWh == null || reviewEnergy) {
      return result(0, 'NEEDS_REVIEW');
    }
    const amountCents = Math.round((energyWh / 1000) * adjustRate(settings.ratePerKwhCents, adjustment));
    return result(amountCents, amountCents > 0 ? 'PENDING' : 'NO_CHARGE');
  }

  const grid = rateGrid(settings.ratePerMinuteCents, scheduleFor(settings));
  // Each started minute (or hour) is billed at the rate in effect when it starts.
  const hourly = settings.timeBillingUnit === 'HOUR';
  const unitSeconds = hourly ? 3600 : 60;
  const units = Math.ceil(durationSeconds / unitSeconds);
  let amountCents = 0;
  for (let u = 0; u < units; u += 1) {
    const at = new Date(startedAt.getTime() + u * unitSeconds * 1000);
    const adjustment = adjustmentAt(at);
    noteOf(adjustment);
    amountCents += adjustRate(rateAt(grid, at), adjustment);
  }
  return result(amountCents, amountCents > 0 ? 'PENDING' : 'NO_CHARGE');
}
