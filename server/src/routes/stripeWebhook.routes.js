import { markChargePaid } from '../services/payments/chargeService.js';
import { getStripe, isProviderConfigured } from '../services/payments/providers.js';
import { siteConfig } from '../services/runtimeConfig.js';
import { prisma } from '../db.js';

// Stripe calls this when a Checkout payment completes. Mounted before
// express.json(), because the signature is checked against the raw body.
// The request's site (the un-prefixed path, or /api/t/<slug>/...) decides which
// webhook secret checks the signature, so each site's endpoint uses its own
// Stripe account. Anything unsigned or badly signed is refused.
export async function stripeWebhookHandler(req, res) {
  if (!isProviderConfigured('STRIPE')) return res.status(404).end();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      siteConfig().stripe.webhookSecret,
    );
  } catch {
    return res.status(400).send('Invalid signature');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid' && session.metadata?.chargeId) {
      // Found only if the charge belongs to this site, so a valid event from one
      // site's account can't mark another site's charge paid.
      const charge = await prisma.charge.findUnique({ where: { id: session.metadata.chargeId }, select: { id: true } });
      if (charge) await markChargePaid(charge.id, { provider: 'STRIPE', providerRef: session.id });
    }
  }
  res.json({ received: true });
}
