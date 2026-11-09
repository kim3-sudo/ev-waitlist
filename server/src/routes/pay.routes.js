import { Router } from 'express';
import { getPaymentSettings } from '../services/payments/paymentSettingsService.js';
import { findChargeByToken, markChargePaid, formatMoney } from '../services/payments/chargeService.js';
import { isProviderConfigured, getStripe, getBraintreeGateway, getSquare } from '../services/payments/providers.js';
import { randomUUID } from 'node:crypto';
import { siteConfig } from '../services/runtimeConfig.js';
import { prisma } from '../db.js';
import { tenantForChargeToken, tenantForHoldToken } from '../tenancy/middleware.js';
import { openLiveStream } from '../services/liveUpdates.js';
import {
  publicHold,
  startStripeHold,
  confirmStripeHold,
  placeBraintreeHold,
} from '../services/payments/holds.js';

// Public, driver-facing payment endpoints. Access is by the charge's secret token.
// Card details are never sent here: Stripe collects them on its hosted page, and
// Braintree's Drop-in sends the browser's card data straight to Braintree, which
// returns a one-time nonce for us to charge.
export const payRouter = Router();

function publicCharge(charge, settings) {
  return {
    status: charge.status,
    stationName: charge.station.name,
    pricingModel: charge.pricingModel,
    currency: charge.currency,
    // The balance still owed. heldCents is what a card hold already covered.
    amountCents: charge.amountCents,
    heldCents: charge.holdCapturedCents ?? 0,
    durationMinutes: Math.ceil(charge.durationSeconds / 60),
    energyKwh: charge.energyWh == null ? null : Math.round(charge.energyWh) / 1000,
    provider: settings.provider === 'NONE' || !isProviderConfigured(settings.provider) ? null : settings.provider,
    paidAt: charge.paidAt,
  };
}

// Change notices for one payment, so the page sees it paid as soon as the webhook lands.
payRouter.get('/:token/live', tenantForChargeToken, async (req, res) => {
  const charge = await prisma.charge.findFirst({ where: { token: req.params.token }, select: { id: true } });
  if (!charge) return res.status(404).json({ error: 'Payment link not found' });
  openLiveStream(req, res, {
    tenantId: req.tenantId ?? null,
    match: (n) => n.model === 'charge' && (n.ids === null || n.ids.includes(charge.id)),
  });
});

payRouter.get('/:token', tenantForChargeToken, async (req, res) => {
  const charge = await findChargeByToken(req.params.token);
  if (!charge) return res.status(404).json({ error: 'Payment link not found' });
  const settings = await getPaymentSettings();
  const body = publicCharge(charge, settings);
  if (body.provider === 'BRAINTREE' && charge.status === 'PENDING') {
    try {
      const response = await getBraintreeGateway().clientToken.generate({});
      body.braintreeClientToken = response.clientToken;
    } catch (err) {
      console.error('Braintree client token failed:', err.message);
      return res.status(502).json({ error: 'The payment provider is unavailable. Try again later.' });
    }
  }
  res.json(body);
});

// Stripe Checkout: we create a session, and Stripe hosts the card form.
payRouter.post('/:token/stripe', tenantForChargeToken, async (req, res) => {
  const charge = await findChargeByToken(req.params.token);
  if (!charge) return res.status(404).json({ error: 'Payment link not found' });
  if (charge.status !== 'PENDING') return res.status(409).json({ error: 'This charge is not awaiting payment' });
  const settings = await getPaymentSettings();
  if (settings.provider !== 'STRIPE' || !isProviderConfigured('STRIPE')) {
    return res.status(409).json({ error: 'Card payments by Stripe are not enabled' });
  }

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: charge.currency.toLowerCase(),
            unit_amount: charge.amountCents,
            product_data: { name: `Charging at ${charge.station.name}` },
          },
        },
      ],
      client_reference_id: charge.id,
      metadata: { chargeId: charge.id },
      success_url: `${siteConfig().webUrl}/pay/${charge.token}?paid=1`,
      cancel_url: `${siteConfig().webUrl}/pay/${charge.token}`,
    });
    await prisma.charge.update({
      where: { id: charge.id },
      data: { provider: 'STRIPE', providerRef: session.id },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout failed:', err.message);
    res.status(502).json({ error: 'Could not start the Stripe payment. Try again.' });
  }
});

// Square: we create a hosted payment link (Square's checkout page takes the card).
// The link's order ID is stored so the payment webhook can find this charge.
payRouter.post('/:token/square', tenantForChargeToken, async (req, res) => {
  const charge = await findChargeByToken(req.params.token);
  if (!charge) return res.status(404).json({ error: 'Payment link not found' });
  if (charge.status !== 'PENDING') return res.status(409).json({ error: 'This charge is not awaiting payment' });
  const settings = await getPaymentSettings();
  if (settings.provider !== 'SQUARE' || !isProviderConfigured('SQUARE')) {
    return res.status(409).json({ error: 'Card payments by Square are not enabled' });
  }

  try {
    const response = await getSquare().checkout.paymentLinks.create({
      idempotencyKey: randomUUID(),
      quickPay: {
        name: `Charging at ${charge.station.name}`,
        priceMoney: { amount: BigInt(charge.amountCents), currency: charge.currency },
        locationId: siteConfig().square.locationId,
      },
      checkoutOptions: { redirectUrl: `${siteConfig().webUrl}/pay/${charge.token}?paid=1` },
      paymentNote: `charge:${charge.id}`,
    });
    const link = response.paymentLink;
    if (!link?.url || !link.orderId) throw new Error('Square returned no payment link');
    await prisma.charge.update({
      where: { id: charge.id },
      data: { provider: 'SQUARE', providerRef: link.orderId },
    });
    res.json({ url: link.url });
  } catch (err) {
    console.error('Square payment link failed:', err.message);
    res.status(502).json({ error: 'Could not start the Square payment. Try again.' });
  }
});

// Braintree Drop-in: the browser sends a payment method nonce; we run the sale.
payRouter.post('/:token/braintree', tenantForChargeToken, async (req, res) => {
  const { nonce } = req.body ?? {};
  if (!nonce) return res.status(400).json({ error: 'nonce is required' });
  const charge = await findChargeByToken(req.params.token);
  if (!charge) return res.status(404).json({ error: 'Payment link not found' });
  if (charge.status !== 'PENDING') return res.status(409).json({ error: 'This charge is not awaiting payment' });
  const settings = await getPaymentSettings();
  if (settings.provider !== 'BRAINTREE' || !isProviderConfigured('BRAINTREE')) {
    return res.status(409).json({ error: 'Card payments by Braintree are not enabled' });
  }

  try {
    const result = await getBraintreeGateway().transaction.sale({
      amount: (charge.amountCents / 100).toFixed(2),
      paymentMethodNonce: nonce,
      options: { submitForSettlement: true },
    });
    if (!result.success) {
      return res.status(402).json({ error: result.message || 'The payment was declined' });
    }
    await markChargePaid(charge.id, { provider: 'BRAINTREE', providerRef: result.transaction.id });
    res.json({ status: 'PAID', amount: formatMoney(charge.amountCents, charge.currency) });
  } catch (err) {
    console.error('Braintree sale failed:', err.message);
    res.status(502).json({ error: 'Could not process the payment. Try again.' });
  }
});

// Card holds (pre-authorization). The driver places a hold on their card before
// their session starts. The hold link's secret token is the only way in, as for charges.
async function openHoldOr409(token, res) {
  const hold = await prisma.paymentHold.findUnique({ where: { token } });
  if (!hold) {
    res.status(404).json({ error: 'Hold link not found' });
    return null;
  }
  if (hold.status !== 'AWAITING') {
    res.status(409).json({ error: 'This hold is not awaiting a card' });
    return null;
  }
  if (!isProviderConfigured(hold.provider)) {
    res.status(409).json({ error: 'The card hold is not available on this site' });
    return null;
  }
  return hold;
}

payRouter.get('/hold/:token', tenantForHoldToken, async (req, res) => {
  const hold = await prisma.paymentHold.findUnique({ where: { token: req.params.token } });
  if (!hold) return res.status(404).json({ error: 'Hold link not found' });
  const body = publicHold(hold);
  if (hold.provider === 'BRAINTREE' && hold.status === 'AWAITING') {
    try {
      const response = await getBraintreeGateway().clientToken.generate({});
      body.braintreeClientToken = response.clientToken;
    } catch (err) {
      console.error('Braintree client token failed:', err.message);
      return res.status(502).json({ error: 'The payment provider is unavailable. Try again later.' });
    }
  }
  res.json(body);
});

// Stripe: send the driver to Checkout, which authorizes the amount without taking it.
payRouter.post('/hold/:token/stripe', tenantForHoldToken, async (req, res) => {
  const hold = await openHoldOr409(req.params.token, res);
  if (!hold) return;
  if (hold.provider !== 'STRIPE') return res.status(409).json({ error: 'This hold is not for Stripe' });
  try {
    res.json({ url: await startStripeHold(hold) });
  } catch (err) {
    console.error('Stripe card hold failed:', err.message);
    res.status(502).json({ error: 'Could not start the card hold. Try again.' });
  }
});

// Stripe: the driver is back from Checkout. Check that the hold is in place.
payRouter.post('/hold/:token/stripe/confirm', tenantForHoldToken, async (req, res) => {
  const hold = await prisma.paymentHold.findUnique({ where: { token: req.params.token } });
  if (!hold) return res.status(404).json({ error: 'Hold link not found' });
  if (hold.status === 'AWAITING') {
    try {
      await confirmStripeHold(hold);
    } catch (err) {
      console.error('Stripe card hold check failed:', err.message);
      return res.status(502).json({ error: 'Could not confirm the card hold. Try again.' });
    }
  }
  const current = await prisma.paymentHold.findUnique({ where: { token: req.params.token } });
  res.json({ status: current.status });
});

// Braintree: place the hold from the nonce the Drop-in form returned.
payRouter.post('/hold/:token/braintree', tenantForHoldToken, async (req, res) => {
  const { nonce } = req.body ?? {};
  if (!nonce) return res.status(400).json({ error: 'nonce is required' });
  const hold = await openHoldOr409(req.params.token, res);
  if (!hold) return;
  if (hold.provider !== 'BRAINTREE') return res.status(409).json({ error: 'This hold is not for Braintree' });
  try {
    const result = await placeBraintreeHold(hold, nonce);
    if (!result.ok) return res.status(402).json({ error: result.message || 'The card hold was declined' });
    res.json({ status: 'HELD' });
  } catch (err) {
    console.error('Braintree card hold failed:', err.message);
    res.status(502).json({ error: 'Could not place the card hold. Try again.' });
  }
});
