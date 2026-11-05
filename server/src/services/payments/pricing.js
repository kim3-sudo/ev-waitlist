// Works out what one finished charging session costs. Pure function: no I/O,
// so it can be tested directly.
//
// TIME: billed per started minute. Minutes that fall inside the peak window
//       use peakRatePerMinuteCents when one is set (demand pricing).
// ENERGY: billed per kWh of meter reading (meterStop - meterStart). Only as
//       accurate as the charger's meter, so sessions without a usable reading
//       are flagged NEEDS_REVIEW rather than billed.

export const PRICING_MODELS = ['TIME', 'ENERGY'];

export function isInPeakWindow(date, startHour, endHour) {
  if (startHour == null || endHour == null || startHour === endHour) return false;
  const hour = date.getHours();
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

export function computeCharge(settings, { startedAt, stoppedAt, meterStart, meterStop }) {
  const durationSeconds = Math.max(0, Math.round((stoppedAt - startedAt) / 1000));
  const hasReading = meterStart != null && meterStop != null && meterStop >= meterStart;
  const energyWh = hasReading ? meterStop - meterStart : null;

  if (settings.pricingModel === 'ENERGY') {
    if (energyWh == null) {
      return { amountCents: 0, durationSeconds, energyWh, status: 'NEEDS_REVIEW' };
    }
    const amountCents = Math.round((energyWh / 1000) * settings.ratePerKwhCents);
    return { amountCents, durationSeconds, energyWh, status: amountCents > 0 ? 'PENDING' : 'NO_CHARGE' };
  }

  const minutes = Math.ceil(durationSeconds / 60);
  let amountCents = 0;
  for (let m = 0; m < minutes; m += 1) {
    const minuteStart = new Date(startedAt.getTime() + m * 60_000);
    const peak = isInPeakWindow(minuteStart, settings.peakStartHour, settings.peakEndHour);
    amountCents += peak && settings.peakRatePerMinuteCents != null
      ? settings.peakRatePerMinuteCents
      : settings.ratePerMinuteCents;
  }
  return { amountCents, durationSeconds, energyWh, status: amountCents > 0 ? 'PENDING' : 'NO_CHARGE' };
}
