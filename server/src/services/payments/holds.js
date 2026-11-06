// Pre-authorization: a card hold placed before a waitlisted driver starts charging.
//
// Life of a hold:
//   AWAITING  the driver is called (NOTIFIED) and gets a link to place the hold
//   HELD      the card hold is in place; the driver may now be authorized
//   IN_USE    the driver's session has started (StartTransaction)
//   CAPTURED  the session stopped; the hold paid for its actual cost, up to the hold amount
//   RELEASED  the hold was let go (the driver never started, cancelled, or the session cost nothing)
//   FAILED    the provider refused the capture; the driver is sent a normal payment link instead
//
// While pre-authorization is on, a waitlisted driver is authorized at a charger only
// when their hold is HELD. Roaming drivers never need a hold.
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db.js';
import { siteConfig } from '../runtimeConfig.js';
import { isIdTagAuthorizedAt } from '../queueService.js';
import { getPaymentSettings, HOLD_PROVIDERS } from './paymentSettingsService.js';
import { holdAdapter } from './holdAdapters.js';

const OPEN_STATUSES = ['AWAITING', 'HELD'];

// True when pre-authorization is on for this site.
export async function holdsEnabled() {
  const settings = await getPaymentSettings();
  return settings.preauthCents != null && HOLD_PROVIDERS.includes(settings.provider);
}

// Called when a driver is told their charger is ready. Returns the hold they need to
// place, or null when holds are off. Reuses an open hold for the same driver.
export async function createHoldForEntry(entry) {
  const settings = await getPaymentSettings();
  if (settings.preauthCents == null || !HOLD_PROVIDERS.includes(settings.provider)) return null;

  const open = await prisma.paymentHold.findFirst({
    where: { idTag: entry.idTag, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: 'desc' },
  });
  if (open) return open;

  return prisma.paymentHold.create({
    data: {
      token: randomBytes(24).toString('base64url'),
      idTag: entry.idTag,
      payerName: entry.name || null,
      payerContact: entry.contact || null,
      amountCents: settings.preauthCents,
      currency: settings.currency,
      provider: settings.provider,
      status: 'AWAITING',
    },
  });
}

// True when the driver may charge: their turn is up, and any hold the site
// requires is in place.
export async function isWaitlistAuthorized(stationId, idTag) {
  if (!(await isIdTagAuthorizedAt(stationId, idTag))) return false;
  if (!(await holdsEnabled())) return true;
  const held = await prisma.paymentHold.findFirst({ where: { idTag, status: 'HELD' } });
  return Boolean(held);
}

// Called when a session starts: the driver's hold now belongs to that session.
export async function markHoldInUse(idTag, transactionId) {
  // Not gated on holdsEnabled(): a hold placed before the admin turned holds off must still be settled.
  await prisma.paymentHold.updateMany({
    where: { idTag, status: 'HELD' },
    data: { status: 'IN_USE', transactionId },
  });
}

// Called when a session stops. Captures what the session cost, up to the hold, and
// releases the hold if nothing is owed. Returns how much was captured.
export async function settleHoldForTransaction(transactionId, amountCents) {
  const hold = await prisma.paymentHold.findFirst({ where: { transactionId, status: 'IN_USE' } });
  if (!hold) return { capturedCents: 0 };
  const adapter = holdAdapter(hold.provider);

  if (amountCents <= 0) {
    await releaseHold(hold);
    return { capturedCents: 0 };
  }

  const amount = Math.min(amountCents, hold.amountCents);
  try {
    await adapter.capture(hold.providerRef, amount);
    await prisma.paymentHold.update({ where: { id: hold.id }, data: { status: 'CAPTURED' } });
    return { capturedCents: amount, provider: hold.provider, providerRef: hold.providerRef };
  } catch (err) {
    // The driver gets a normal payment link for the whole amount instead.
    console.error(`Capturing card hold ${hold.id} failed:`, err.message);
    await releaseHold(hold, 'FAILED');
    return { capturedCents: 0 };
  }
}

// Releases the holds a driver still has open (not yet used by a session).
// Called when their entry is cancelled or their reservation expires.
export async function releaseOpenHoldsFor(idTag) {
  const holds = await prisma.paymentHold.findMany({ where: { idTag, status: { in: OPEN_STATUSES } } });
  for (const hold of holds) await releaseHold(hold);
}

async function releaseHold(hold, status = 'RELEASED') {
  if (hold.providerRef) {
    try {
      await holdAdapter(hold.provider).release(hold.providerRef);
    } catch (err) {
      console.error(`Releasing card hold ${hold.id} failed:`, err.message);
    }
  }
  await prisma.paymentHold.update({ where: { id: hold.id }, data: { status } });
}

// What the driver's hold page needs. The token is the only way in.
export function publicHold(hold) {
  return {
    status: hold.status,
    amountCents: hold.amountCents,
    currency: hold.currency,
    provider: hold.provider,
  };
}

// Stripe: the driver goes to Checkout to place the hold. Returns the URL to send them to.
export async function startStripeHold(hold) {
  const { sessionRef, url } = await holdAdapter('STRIPE').startCheckout({
    amountCents: hold.amountCents,
    currency: hold.currency,
    successUrl: `${siteConfig().webUrl}/pay/hold/${hold.token}?held=1`,
    cancelUrl: `${siteConfig().webUrl}/pay/hold/${hold.token}`,
  });
  await prisma.paymentHold.update({ where: { id: hold.id }, data: { provider: 'STRIPE', sessionRef } });
  return url;
}

// Stripe: after the driver returns from Checkout, check the hold is in place.
export async function confirmStripeHold(hold) {
  if (!hold.sessionRef) return false;
  const { held, providerRef } = await holdAdapter('STRIPE').confirmCheckout(hold.sessionRef);
  if (!held) return false;
  await prisma.paymentHold.update({ where: { id: hold.id }, data: { status: 'HELD', providerRef } });
  return true;
}

// Braintree: places the hold from the nonce the Drop-in form returned.
export async function placeBraintreeHold(hold, nonce) {
  const result = await holdAdapter('BRAINTREE').hold({ nonce, amountCents: hold.amountCents });
  if (!result.held) return { ok: false, message: result.message };
  await prisma.paymentHold.update({
    where: { id: hold.id },
    data: { status: 'HELD', provider: 'BRAINTREE', providerRef: result.providerRef },
  });
  return { ok: true };
}
