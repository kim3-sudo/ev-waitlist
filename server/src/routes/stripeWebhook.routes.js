import { markChargePaid } from '../services/payments/chargeService.js';
import { getStripe, isProviderConfigured } from '../services/payments/providers.js';
import { config } from '../config.js';

// Stripe calls this when a Checkout payment completes. Mounted before
// express.json(), because the signature is checked against the raw body.
// Stripe's webhook signature is the only proof a request really came from Stripe,
// so anything unsigned or badly signed is refused.
export async function stripeWebhookHandler(req, res) {
  if (!isProviderConfigured('STRIPE')) return res.status(404).end();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch {
    return res.status(400).send('Invalid signature');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid' && session.metadata?.chargeId) {
      await markChargePaid(session.metadata.chargeId, { provider: 'STRIPE', providerRef: session.id });
    }
  }
  res.json({ received: true });
}
