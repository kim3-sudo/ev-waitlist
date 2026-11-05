import { prisma } from '../../db.js';
import { PRICING_MODELS } from './pricing.js';
import { providerStatus, isProviderConfigured } from './providers.js';

const SETTINGS_ID = 'singleton';
export const PAYMENT_PROVIDERS = ['NONE', 'STRIPE', 'BRAINTREE', 'SQUARE'];

export async function getPaymentSettings() {
  const existing = await prisma.paymentSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.paymentSettings.create({ data: { id: SETTINGS_ID } });
}

function isWholeNumber(value, { min = 0 } = {}) {
  return Number.isInteger(value) && value >= min;
}

// Validates and saves pricing. Returns { settings } or { error }.
export async function savePaymentSettings(input) {
  const current = await getPaymentSettings();
  const next = { ...current };

  if (input.pricingModel !== undefined) {
    if (!PRICING_MODELS.includes(input.pricingModel)) return { error: 'pricingModel must be TIME or ENERGY' };
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

  const { id: _id, updatedAt: _updatedAt, ...data } = next;
  const settings = await prisma.paymentSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
  return { settings };
}

export async function paymentSettingsResponse() {
  return { settings: await getPaymentSettings(), providers: providerStatus() };
}
