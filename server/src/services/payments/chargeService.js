import { prisma } from '../../db.js';
import { notify } from '../notifier.js';
import { siteConfig } from '../runtimeConfig.js';
import { getPaymentSettings } from './paymentSettingsService.js';
import { computeCharge } from './pricing.js';
import { isProviderConfigured } from './providers.js';
import { settleHoldForTransaction } from './holds.js';
import { randomBytes } from 'node:crypto';

export function formatMoney(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

// Creates the Charge for a finished transaction (called from StopTransaction).
// Idempotent: a transaction is charged at most once.
export async function createChargeForTransaction(stationId, ocppTransactionId) {
  const tx = await prisma.transaction.findFirst({
    where: { stationId, ocppTransactionId },
    include: { station: { select: { name: true } }, charge: true },
  });
  // Roaming sessions are billed by the partner through a CDR, not by a payment link.
  if (!tx || !tx.stoppedAt || tx.charge || tx.partnerId) return null;

  const settings = await getPaymentSettings();
  const result = computeCharge(settings, {
    startedAt: tx.startedAt,
    stoppedAt: tx.stoppedAt,
    meterStart: tx.meterStart,
    meterStop: tx.meterStop,
  });

  // Drivers' contact details come from their waitlist entry for this idTag.
  const entry = await prisma.queueEntry.findFirst({
    where: { idTag: tx.idTag },
    orderBy: { createdAt: 'desc' },
  });

  // A card hold placed before the session pays for it first: capture the actual cost,
  // up to the hold. Only the balance is then charged through a payment link.
  const held = await settleHoldForTransaction(tx.id, result.status === 'PENDING' ? result.amountCents : 0);
  const balance = Math.max(0, result.amountCents - held.capturedCents);
  const status = held.capturedCents > 0 && balance === 0 ? 'PAID' : result.status;

  const charge = await prisma.charge.create({
    data: {
      token: randomBytes(24).toString('base64url'),
      stationId,
      transactionId: tx.id,
      idTag: tx.idTag,
      payerName: entry?.name ?? null,
      payerContact: entry?.contact ?? null,
      pricingModel: settings.pricingModel,
      currency: settings.currency,
      amountCents: balance,
      holdCapturedCents: held.capturedCents,
      durationSeconds: result.durationSeconds,
      energyWh: result.energyWh,
      status,
      ...(status === 'PAID' ? { provider: held.provider, providerRef: held.providerRef, paidAt: new Date() } : {}),
    },
  });

  if (charge.status === 'PENDING' && settings.provider !== 'NONE' && isProviderConfigured(settings.provider)) {
    if (charge.payerContact) {
      const link = `${siteConfig().webUrl}/pay/${charge.token}`;
      const cost = formatMoney(result.amountCents, charge.currency);
      const text = held.capturedCents > 0
        ? `Your charging session at ${tx.station.name} cost ${cost}. Your card hold covered ${formatMoney(held.capturedCents, charge.currency)}. Pay the remaining ${formatMoney(balance, charge.currency)} here: ${link}`
        : `Your charging session at ${tx.station.name} cost ${cost}. Pay here: ${link}`;
      await notify(charge.payerContact, text);
    }
  }
  return charge;
}

// Records a successful payment. Only moves PENDING charges, so a repeated
// webhook or a double submit doesn't count twice.
export async function markChargePaid(chargeId, { provider, providerRef }) {
  const { count } = await prisma.charge.updateMany({
    where: { id: chargeId, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date(), provider, providerRef },
  });
  return count === 1;
}

// The public, unguessable token is the only way to reach a charge from outside.
export async function findChargeByToken(token) {
  return prisma.charge.findUnique({
    where: { token },
    include: { station: { select: { name: true } } },
  });
}
