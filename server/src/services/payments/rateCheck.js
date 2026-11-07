// Rate calculator and price check. Pure functions: no I/O.
//
// The calculator turns the costs an operator pays into a price per kWh, with a
// profit margin on top. It is a planning aid: the figures are only as good as the
// inputs, and the operator should check them against real bills.
//
// The price check (the "circuit breaker") compares the highest price a driver can
// be charged with the cost of the energy. It warns when the price is far above
// that cost. Level 2 chargers (up to 22 kW) get a stricter limit, because their
// prices are usually lower and a high rate there is more likely to be a typing
// mistake.

import { highestRate, rateGrid, scheduleFor } from './rates.js';

export const LEVEL_2_MAX_KW = 22;
export const DEFAULT_REFERENCE_POWER_KW = 7.4;

// Ratios of price to cost at which the check warns, and at which it strongly warns.
export const PRICE_LIMITS = {
  level2: { warn: 2.5, strong: 4 },
  highPower: { warn: 4, strong: 6 },
};

const MONEY_FIELDS = [
  'energyCostPerKwhCents', // what you pay for each kWh from the grid
  'distributionPerKwhCents', // network / distribution charge per grid kWh
  'solarCostPerKwhCents', // operating cost of each solar kWh (often 0)
  'customerChargePerMonthCents', // fixed account or meter charges
  'infrastructurePerMonthCents', // chargers' lease, maintenance, network, demand charges
];

// Validates calculator inputs. Returns { inputs } (normalized) or { error }.
export function validateCalculatorInputs(input) {
  if (input == null) return { inputs: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Calculator inputs must be an object' };

  const inputs = {};
  for (const key of MONEY_FIELDS) {
    const value = input[key] ?? 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { error: `${key} must be a number, 0 or more` };
    }
    inputs[key] = value;
  }
  const solarKw = input.solarKw ?? 0;
  const solarYield = input.solarKwhPerKwPerYear ?? 0;
  const monthlyKwh = input.monthlyKwh ?? 0;
  const margin = input.marginPercent ?? 0;
  for (const [key, value] of [['solarKw', solarKw], ['solarKwhPerKwPerYear', solarYield], ['monthlyKwh', monthlyKwh]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return { error: `${key} must be a number, 0 or more` };
  }
  if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0 || margin >= 100) {
    return { error: 'The profit margin must be from 0 to under 100 percent' };
  }
  if (solarKw > 0 && solarYield <= 0) return { error: 'Enter the solar yield (kWh per kW per year) to use solar generation' };
  inputs.solarKw = solarKw;
  inputs.solarKwhPerKwPerYear = solarYield;
  inputs.monthlyKwh = monthlyKwh;
  inputs.marginPercent = margin;
  return { inputs };
}

// Works out the price from the inputs. Returns null when there is not enough
// to work with (no expected energy).
export function calculateRate(input) {
  const { inputs, error } = validateCalculatorInputs(input);
  if (error || !inputs || !(inputs.monthlyKwh > 0)) return null;

  // Solar covers the first kWh it generates in the month; the grid covers the rest.
  const solarKwhPerMonth = (inputs.solarKw * inputs.solarKwhPerKwPerYear) / 12;
  const solarKwh = Math.min(solarKwhPerMonth, inputs.monthlyKwh);
  const gridKwh = inputs.monthlyKwh - solarKwh;

  const energyCostMonthly =
    gridKwh * (inputs.energyCostPerKwhCents + inputs.distributionPerKwhCents) +
    solarKwh * inputs.solarCostPerKwhCents;
  const fixedMonthly = inputs.customerChargePerMonthCents + inputs.infrastructurePerMonthCents;
  const costPerKwhCents = (energyCostMonthly + fixedMonthly) / inputs.monthlyKwh;
  const pricePerKwhCents = costPerKwhCents / (1 - inputs.marginPercent / 100);

  return {
    solarKwhPerMonth: solarKwh,
    gridKwhPerMonth: gridKwh,
    costPerKwhCents,
    pricePerKwhCents,
    marginCentsPerKwh: pricePerKwhCents - costPerKwhCents,
    fixedCostPerKwhCents: fixedMonthly / inputs.monthlyKwh,
  };
}

// The price per kWh that a driver can be charged at its highest, for the price check.
// Per-minute rates are converted with the charger's power.
export function highestPricePerKwhCents(settings, powerKw = DEFAULT_REFERENCE_POWER_KW) {
  if (settings.pricingModel === 'FREE') return 0;
  if (settings.pricingModel === 'ENERGY') return settings.ratePerKwhCents;
  const grid = rateGrid(settings.ratePerMinuteCents, scheduleFor(settings));
  // A rate is per minute or per hour, depending on the time billing unit.
  const perHour = settings.timeBillingUnit === 'HOUR' ? highestRate(grid) : highestRate(grid) * 60;
  return perHour / powerKw;
}

// Conservative starting values for a new calculator: the costs are on the low side, so
// the price check flags a high price by default. The admin replaces them with their own
// figures from their bills, and must explicitly choose a higher price to avoid the warning.
export const DEFAULT_CALCULATOR_INPUTS = {
  energyCostPerKwhCents: 12,
  distributionPerKwhCents: 3,
  solarCostPerKwhCents: 0,
  customerChargePerMonthCents: 500,
  infrastructurePerMonthCents: 1000,
  solarKw: 0,
  solarKwhPerKwPerYear: 0,
  monthlyKwh: 1000,
  marginPercent: 20,
};

// Compares a price with the cost. Returns { level: 'NONE' | 'OK' | 'WARN' | 'STRONG', ratio, limits }.
// NONE means there is no cost to compare with (the calculator has not been used).
export function priceCheck({ priceCentsPerKwh, costCentsPerKwh, powerKw }) {
  if (!(costCentsPerKwh > 0)) return { level: 'NONE', ratio: null, limits: null };
  const limits = powerKw <= LEVEL_2_MAX_KW ? PRICE_LIMITS.level2 : PRICE_LIMITS.highPower;
  const ratio = priceCentsPerKwh / costCentsPerKwh;
  const level = ratio >= limits.strong ? 'STRONG' : ratio >= limits.warn ? 'WARN' : 'OK';
  return { level, ratio, limits, powerKw };
}
