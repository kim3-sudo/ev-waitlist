import { prisma } from '../../db.js';
import { currentTenantId } from '../../tenancy/context.js';
import { PRICING_MODELS } from './pricing.js';
import { providerStatus, isProviderConfigured } from './providers.js';
import { validateSchedule, scheduleFor } from './rates.js';
import {
  validateCalculatorInputs,
  calculateRate,
  highestPricePerKwhCents,
  priceCheck,
  DEFAULT_REFERENCE_POWER_KW,
  LEVEL_2_MAX_KW,
} from './rateCheck.js';

export const PAYMENT_PROVIDERS = ['NONE', 'STRIPE', 'BRAINTREE', 'SQUARE'];
// Providers that can place a hold on a card and capture a different amount later.
// Square's hosted payment links cannot.
export const HOLD_PROVIDERS = ['STRIPE', 'BRAINTREE'];

// One pricing row per site.
export async function getPaymentSettings() {
  const tenantId = currentTenantId();
  const existing = await prisma.paymentSettings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.paymentSettings.create({ data: { tenantId } });
}

function isWholeNumber(value, { min = 0 } = {}) {
  return Number.isInteger(value) && value >= min;
}

function parseJson(text) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The price check for the settings as saved: the highest price a driver can pay,
// against the cost from the calculator.
export function priceCheckFor(settings) {
  const powerKw = settings.referencePowerKw ?? DEFAULT_REFERENCE_POWER_KW;
  const calc = calculateRate(parseJson(settings.rateCalculatorInputs));
  return priceCheck({
    priceCentsPerKwh: highestPricePerKwhCents(settings, powerKw),
    costCentsPerKwh: calc?.costPerKwhCents ?? 0,
    powerKw,
  });
}

// Applies the input to the current settings without saving. Returns { next } or { error }.
async function applyInput(input) {
  const current = await getPaymentSettings();
  const next = { ...current };

  if (input.pricingModel !== undefined) {
    if (!PRICING_MODELS.includes(input.pricingModel)) return { error: 'pricingModel must be TIME, ENERGY, or FREE' };
    next.pricingModel = input.pricingModel;
  }
  if (input.currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(input.currency)) return { error: 'currency must be a 3-letter ISO code, e.g. USD' };
    next.currency = input.currency;
  }
  for (const key of ['ratePerMinuteCents', 'ratePerKwhCents']) {
    if (input[key] !== undefined) {
      if (!isWholeNumber(input[key])) return { error: `${key} must be a whole number of cents, 0 or more` };
      next[key] = input[key];
    }
  }
  // Legacy single peak window. The API still accepts it; the admin page sends a schedule instead.
  if (input.peakRatePerMinuteCents !== undefined) {
    if (input.peakRatePerMinuteCents !== null && !isWholeNumber(input.peakRatePerMinuteCents)) {
      return { error: 'peakRatePerMinuteCents must be a whole number of cents, or empty' };
    }
    next.peakRatePerMinuteCents = input.peakRatePerMinuteCents;
  }
  for (const key of ['peakStartHour', 'peakEndHour']) {
    if (input[key] !== undefined) {
      if (input[key] !== null && !(Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 23)) {
        return { error: `${key} must be an hour from 0 to 23, or empty` };
      }
      next[key] = input[key];
    }
  }
  if (input.rateSchedule !== undefined) {
    const { rules, error } = validateSchedule(input.rateSchedule ?? []);
    if (error) return { error };
    next.rateSchedule = JSON.stringify(rules);
    // The schedule replaces the legacy single peak window.
    next.peakRatePerMinuteCents = null;
    next.peakStartHour = null;
    next.peakEndHour = null;
  }
  if (input.referencePowerKw !== undefined) {
    if (input.referencePowerKw !== null && !(Number.isFinite(input.referencePowerKw) && input.referencePowerKw > 0 && input.referencePowerKw <= 1000)) {
      return { error: 'Charger power must be a number of kW above zero' };
    }
    next.referencePowerKw = input.referencePowerKw;
  }
  if (input.rateCalculatorInputs !== undefined) {
    const { inputs, error } = validateCalculatorInputs(input.rateCalculatorInputs);
    if (error) return { error };
    next.rateCalculatorInputs = inputs == null ? null : JSON.stringify(inputs);
  }
  if (input.preauthCents !== undefined) {
    if (input.preauthCents !== null && !(Number.isInteger(input.preauthCents) && input.preauthCents > 0)) {
      return { error: 'The pre-authorization amount must be a whole number of cents above zero, or empty' };
    }
    next.preauthCents = input.preauthCents;
  }
  if (input.provider !== undefined) {
    if (!PAYMENT_PROVIDERS.includes(input.provider)) return { error: 'provider must be NONE, STRIPE, BRAINTREE, or SQUARE' };
    if (input.provider !== 'NONE' && !isProviderConfigured(input.provider)) {
      return { error: `${input.provider} isn't configured on the server yet. Save its keys under Admin > Integrations first.` };
    }
    next.provider = input.provider;
  }

  // Power-based billing resells electricity, so the admin must confirm they checked local rules.
  if (input.energyPricingAcknowledged === true) next.energyPricingAcknowledgedAt = new Date();
  if (next.pricingModel === 'ENERGY') {
    if (!next.energyPricingAcknowledgedAt) {
      return { error: 'Confirm that you checked local laws on reselling power before using power-based pricing' };
    }
    if (next.ratePerKwhCents <= 0) return { error: 'Set a price per kWh above zero' };
  }
  // A zero rate is allowed: sessions are recorded as NO_CHARGE.

  if (next.preauthCents != null) {
    if (next.pricingModel === 'FREE') {
      return { error: 'Pre-authorization holds a card for a charge. Turn it off, or choose a paid pricing model.' };
    }
    if (!HOLD_PROVIDERS.includes(next.provider)) {
      return { error: 'Pre-authorization needs Stripe or Braintree. Square and "None" cannot place a hold.' };
    }
  }

  return { next };
}

function highRateMessage(check) {
  const times = check.ratio.toFixed(1);
  const where = check.powerKw <= LEVEL_2_MAX_KW ? ' for a Level 2 charger' : '';
  return check.level === 'STRONG'
    ? `This price is ${times} times what the energy costs${where}. That is far above a normal margin. Check the rate. To save it anyway, confirm the warning.`
    : `This price is ${times} times what the energy costs${where}, which is high. Check the rate. To save it anyway, confirm the warning.`;
}

// Validates and saves pricing. Returns { settings } or { error, code? }.
export async function savePaymentSettings(input) {
  const applied = await applyInput(input);
  if (applied.error) return { error: applied.error };
  const { next } = applied;

  // The price check: a rate far above the cost of the energy needs an explicit confirmation.
  const check = priceCheckFor(next);
  if ((check.level === 'WARN' || check.level === 'STRONG') && input.highRateConfirmed !== true) {
    return { error: highRateMessage(check), code: 'HIGH_RATE', check };
  }

  const { tenantId, updatedAt: _updatedAt, ...data } = next;
  const settings = await prisma.paymentSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return { settings };
}

// Works out the calculator result and price check for input the admin has not saved
// yet, so the form can show them as the admin types. Saves nothing.
export async function previewRates(input) {
  const applied = await applyInput(input);
  if (applied.error) return { error: applied.error };
  const { next } = applied;
  return {
    check: priceCheckFor(next),
    calculator: calculateRate(parseJson(next.rateCalculatorInputs)),
    schedule: scheduleFor(next),
  };
}

export async function paymentSettingsResponse() {
  const settings = await getPaymentSettings();
  return {
    settings,
    providers: providerStatus(),
    schedule: scheduleFor(settings),
    calculatorInputs: parseJson(settings.rateCalculatorInputs),
    calculator: calculateRate(parseJson(settings.rateCalculatorInputs)),
    check: priceCheckFor(settings),
  };
}
