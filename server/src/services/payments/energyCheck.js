import { energySamplesFor, ENERGY } from '../meterService.js';

// Decides how much energy a session is billed for, from two sources:
//   - the end-of-session reading from StopTransaction (meterStart and meterStop), and
//   - the charge point's own MeterValues readings during the session.
//
// The charger's readings are preferred when they are plausible: they never go backwards,
// no single step is larger than the site's limit, and the register moved while the
// connector was drawing power. The end-of-session reading is the check on them. A zero
// reading, or one that is missing, never counts as a real reading on its own. When the
// readings can't be trusted, the session is flagged for review instead of billed as
// free. (See the plan: "Billing: MeterValues as a cross-check".)

// Pure decision, for tests and for the billing code.
// energy: [{ at, value }] energy readings in Wh, oldest first.
// power:  [{ at, value }] power readings in W, oldest first.
// Returns { energyWh, source, needsReview, note }.
export function checkEnergy({ meterStart, meterStop, energy, power, durationSeconds, settings }) {
  const stopDelta =
    meterStart != null && meterStop != null && meterStop >= meterStart ? meterStop - meterStart : null;
  const stopOk = stopDelta !== null && stopDelta > 0;

  const sampled = sampledDelta(energy, power, settings);
  const plausible = sampled.delta !== null;
  const tolerance = Math.max(
    settings.meterToleranceWh,
    (settings.meterTolerancePct / 100) * Math.max(sampled.delta ?? 0, stopDelta ?? 0),
  );

  if (plausible && stopOk) {
    if (Math.abs(sampled.delta - stopDelta) <= tolerance) {
      return { energyWh: sampled.delta, source: 'METER_VALUES', needsReview: false, note: 'Matches the end-of-session reading.' };
    }
    return {
      energyWh: null,
      source: 'METER_VALUES',
      needsReview: true,
      note: `The charge point's readings (${sampled.delta} Wh) and the end-of-session reading (${stopDelta} Wh) disagree.`,
    };
  }

  if (plausible) {
    return {
      energyWh: sampled.delta,
      source: 'METER_VALUES',
      needsReview: false,
      note: 'The end-of-session reading was missing or zero, so the charge point\'s readings were used.',
    };
  }

  if (stopOk && energy.length <= 1) {
    // No charger readings to check against (none sent, or only a single one): the
    // end-of-session reading is all there is.
    return { energyWh: stopDelta, source: 'STOP_TRANSACTION', needsReview: false, note: null };
  }

  if (energy.length >= 2) {
    return {
      energyWh: null,
      source: 'METER_VALUES',
      needsReview: true,
      note: `The charge point's readings can't be trusted: ${sampled.reason}.`,
    };
  }

  // No readings at all, and no usable end-of-session reading.
  if (durationSeconds >= settings.meterMinSessionMinutes * 60) {
    return {
      energyWh: null,
      source: 'NONE',
      needsReview: true,
      note: `No usable meter reading for a session of ${Math.round(durationSeconds / 60)} minutes.`,
    };
  }
  return { energyWh: 0, source: 'NONE', needsReview: false, note: null };
}

// Works out the energy the charger's own readings show, and whether they look right.
// Returns { delta, reason }; delta is null when the readings can't be used.
function sampledDelta(energy, power, settings) {
  if (energy.length < 2) {
    return { delta: null, reason: energy.length === 1 ? 'only one reading was sent' : 'no readings' };
  }
  for (let i = 1; i < energy.length; i += 1) {
    const step = energy[i].value - energy[i - 1].value;
    if (step < 0) return { delta: null, reason: 'the meter reading went backwards' };
    if (step > settings.meterMaxJumpWh) {
      return { delta: null, reason: `the meter reading jumped by ${Math.round(step)} Wh in one step` };
    }
  }
  const delta = energy[energy.length - 1].value - energy[0].value;
  const drew = power.some((p) => p.value > 0);
  if (delta === 0 && drew) return { delta: null, reason: 'the meter did not move while the connector was drawing power' };
  return { delta, reason: null };
}

// Loads the readings for a transaction and runs the check.
export async function checkTransactionEnergy(tx, settings) {
  const rows = await energySamplesFor(tx.stationId, tx.ocppTransactionId);
  const energy = rows.filter((r) => r.measurand === ENERGY).map((r) => ({ at: r.at, value: r.value }));
  const power = rows.filter((r) => r.measurand !== ENERGY).map((r) => ({ at: r.at, value: r.value }));
  const durationSeconds = Math.max(0, Math.round((tx.stoppedAt - tx.startedAt) / 1000));
  return checkEnergy({
    meterStart: tx.meterStart,
    meterStop: tx.meterStop,
    energy,
    power,
    durationSeconds,
    settings,
  });
}
