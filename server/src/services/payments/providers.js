import Stripe from 'stripe';
import braintree from 'braintree';
import { SquareClient, SquareEnvironment } from 'square';
import { siteConfig } from '../runtimeConfig.js';

function getPath(obj, path) {
  return path.split('.').reduce((o, part) => o?.[part], obj);
}

// Required fields per provider, as [setting key, label]. Keys are saved per site
// through the Integrations admin page (see services/runtimeConfig.js).
const REQUIRED = {
  STRIPE: [['stripe.secretKey', 'Secret key'], ['stripe.webhookSecret', 'Webhook signing secret']],
  BRAINTREE: [['braintree.merchantId', 'Merchant ID'], ['braintree.publicKey', 'Public key'], ['braintree.privateKey', 'Private key']],
  SQUARE: [['square.accessToken', 'Access token'], ['square.locationId', 'Location ID'], ['square.webhookSignatureKey', 'Webhook signature key']],
};

export function providerStatus() {
  const config = siteConfig();
  const status = {};
  for (const [provider, fields] of Object.entries(REQUIRED)) {
    const missing = fields.filter(([key]) => !getPath(config, key)).map(([, label]) => label);
    status[provider] = { configured: missing.length === 0, missing };
  }
  return status;
}

export function isProviderConfigured(provider) {
  return Boolean(providerStatus()[provider]?.configured);
}

// Clients are cached per set of credentials, so sites with different accounts
// each keep their own client.
const stripeClients = new Map();
export function getStripe() {
  const key = siteConfig().stripe.secretKey;
  if (!stripeClients.has(key)) stripeClients.set(key, new Stripe(key));
  return stripeClients.get(key);
}

const gateways = new Map();
export function getBraintreeGateway() {
  const { environment, merchantId, publicKey, privateKey } = siteConfig().braintree;
  const key = `${environment}|${merchantId}|${publicKey}|${privateKey}`;
  if (!gateways.has(key)) {
    gateways.set(
      key,
      new braintree.BraintreeGateway({
        environment: environment === 'production' ? braintree.Environment.Production : braintree.Environment.Sandbox,
        merchantId,
        publicKey,
        privateKey,
      }),
    );
  }
  return gateways.get(key);
}

const squareClients = new Map();
export function getSquare() {
  const { accessToken, environment } = siteConfig().square;
  const key = `${environment}|${accessToken}`;
  if (!squareClients.has(key)) {
    squareClients.set(
      key,
      new SquareClient({
        token: accessToken,
        environment: environment === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
      }),
    );
  }
  return squareClients.get(key);
}
