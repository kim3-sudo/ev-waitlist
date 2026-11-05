import { prisma } from '../../db.js';
import { notify } from '../notifier.js';
import { config } from '../../config.js';
import { getPaymentSettings } from './paymentSettingsService.js';
import { computeCharge } from './pricing.js';
import { isProviderConfigured } from './providers.js';
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
  if (!tx || !tx.stoppedAt || tx.charge) return null;

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
      amountCents: result.amountCents,
      durationSeconds: result.durationSeconds,
      energyWh: result.energyWh,
      status: result.status,
    },
  });

  if (charge.status === 'PENDING' && settings.provider !== 'NONE' && isProviderConfigured(settings.provider)) {
    if (charge.payerContact) {
      const link = `${config.webUrl}/pay/${charge.token}`;
      await notify(
        charge.payerContact,
        `Your charging session at ${tx.station.name} cost ${formatMoney(charge.amountCents, charge.currency)}. Pay here: ${link}`,
      );
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
