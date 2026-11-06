import { prisma } from '../db.js';

// Meter readings from MeterValues. Each measurand is stored in one normalized unit so
// the rest of the app never has to convert: energy in Wh, power in W, current in A,
// voltage in V, state of charge in percent, temperature in Celsius.
//
// Per-phase readings (a sampled value with a phase) are skipped, so each measurand is
// stored once; a charge point that reports only per-phase values shows no readings.

export const ENERGY = 'Energy.Active.Import.Register';

const MEASURANDS = {
  [ENERGY]: { unit: 'Wh', scale: { Wh: 1, kWh: 1000 } },
  'Power.Active.Import': { unit: 'W', scale: { W: 1, kW: 1000 } },
  'Current.Import': { unit: 'A', scale: { A: 1 } },
  Voltage: { unit: 'V', scale: { V: 1 } },
  SoC: { unit: 'Percent', scale: { Percent: 1 } },
  Temperature: { unit: 'Celsius', scale: { Celsius: 1, Celcius: 1 } },
};

// OCPP's defaults: a sampled value without a unit uses the measurand's default unit.
const DEFAULT_UNIT = {
  [ENERGY]: 'Wh',
  'Power.Active.Import': 'W',
  'Current.Import': 'A',
  Voltage: 'V',
  SoC: 'Percent',
  Temperature: 'Celsius',
};

// Converts one sampled value to the normalized unit. Returns null when it can't be used.
export function normalizeReading(measurand, rawValue, unit) {
  const spec = MEASURANDS[measurand];
  if (!spec) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return null;
  const from = unit ?? DEFAULT_UNIT[measurand];
  if (from === 'Fahrenheit' && measurand === 'Temperature') return (value - 32) * (5 / 9);
  const scale = spec.scale[from];
  if (scale === undefined) return null;
  return value * scale;
}

// Stores the readings from one MeterValues message. Returns how many were stored.
export async function storeMeterValues(stationId, connectorId, ocppTransactionId, meterValue) {
  const rows = [];
  for (const block of Array.isArray(meterValue) ? meterValue : []) {
    const parsed = new Date(block?.timestamp);
    const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    for (const sv of Array.isArray(block?.sampledValue) ? block.sampledValue : []) {
      if (sv?.phase) continue;
      const measurand = sv?.measurand ?? ENERGY;
      const value = normalizeReading(measurand, sv?.value, sv?.unit);
      if (value === null) continue;
      rows.push({
        stationId,
        connectorId,
        ocppTransactionId: Number.isInteger(ocppTransactionId) ? ocppTransactionId : null,
        measurand,
        context: sv.context ?? null,
        value,
        at,
      });
    }
  }
  if (rows.length === 0) return 0;

  await prisma.meterSample.createMany({ data: rows });
  await prisma.station.updateMany({
    where: { id: stationId, meterStatus: { not: 'REPORTING' } },
    data: { meterStatus: 'REPORTING' },
  });
  return rows.length;
}

// The latest value of each measurand on each connector, from the last few minutes.
// Used for the live readings on the station page.
const LIVE_WINDOW_MS = 5 * 60_000;

export async function latestReadings(stationId, now = Date.now()) {
  const samples = await prisma.meterSample.findMany({
    where: { stationId, at: { gte: new Date(now - LIVE_WINDOW_MS) } },
    orderBy: { at: 'desc' },
    take: 500,
  });
  const latest = {};
  for (const s of samples) {
    const key = `${s.connectorId}|${s.measurand}`;
    if (!latest[key]) {
      latest[key] = { connectorId: s.connectorId, measurand: s.measurand, value: s.value, at: s.at };
    }
  }
  return Object.values(latest);
}

// The energy readings for one OCPP transaction, oldest first. Used by the billing check.
export async function energySamplesFor(stationId, ocppTransactionId) {
  return prisma.meterSample.findMany({
    where: { stationId, ocppTransactionId, measurand: { in: [ENERGY, 'Power.Active.Import'] } },
    orderBy: { at: 'asc' },
  });
}
