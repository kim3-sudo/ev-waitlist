// Card holds (pre-authorization) with Stripe and Braintree. A hold reserves an amount
// on the driver's card without taking it. Capturing takes money from the hold, up to
// its amount; releasing lets it go. Square's hosted links cannot hold a card.
//
// Tests replace these adapters with setHoldAdapterForTests(), so no test calls a provider.
import { getStripe, getBraintreeGateway } from './providers.js';

const stripeHolds = {
  // Starts a Checkout session that authorizes but does not capture. Returns the session ID and its URL.
  async startCheckout({ amountCents, currency, successUrl, cancelUrl }) {
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_intent_data: { capture_method: 'manual' },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: amountCents,
            product_data: { name: 'Charging hold (the card is charged only for the session)' },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return { sessionRef: session.id, url: session.url };
  },

  // After the driver returns from Checkout: true when the card hold is in place.
  async confirmCheckout(sessionRef) {
    const session = await getStripe().checkout.sessions.retrieve(sessionRef);
    if (!session.payment_intent) return { held: false };
    const intent = await getStripe().paymentIntents.retrieve(session.payment_intent);
    return intent.status === 'requires_capture' ? { held: true, providerRef: intent.id } : { held: false };
  },

  async capture(providerRef, amountCents) {
    await getStripe().paymentIntents.capture(providerRef, { amount_to_capture: amountCents });
  },

  async release(providerRef) {
    await getStripe().paymentIntents.cancel(providerRef);
  },
};

const braintreeHolds = {
  // Authorizes the nonce from the Drop-in form without settling. Returns the transaction ID.
  async hold({ nonce, amountCents }) {
    const result = await getBraintreeGateway().transaction.sale({
      amount: (amountCents / 100).toFixed(2),
      paymentMethodNonce: nonce,
      options: { submitForSettlement: false },
    });
    if (!result.success) return { held: false, message: result.message || 'The card hold was declined' };
    return { held: true, providerRef: result.transaction.id };
  },

  async capture(providerRef, amountCents) {
    const result = await getBraintreeGateway().transaction.submitForSettlement(providerRef, (amountCents / 100).toFixed(2));
    if (!result.success) throw new Error(result.message || 'Braintree refused the capture');
  },

  async release(providerRef) {
    const result = await getBraintreeGateway().transaction.void(providerRef);
    if (!result.success) throw new Error(result.message || 'Braintree refused the release');
  },
};

const overrides = new Map();

export function holdAdapter(provider) {
  if (overrides.has(provider)) return overrides.get(provider);
  return provider === 'STRIPE' ? stripeHolds : braintreeHolds;
}

// Tests only: replace one provider's adapter.
export function setHoldAdapterForTests(provider, adapter) {
  overrides.set(provider, adapter);
}

export function resetHoldAdaptersForTests() {
  overrides.clear();
}
