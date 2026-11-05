import Stripe from 'stripe';
import braintree from 'braintree';
import { SquareClient, SquareEnvironment } from 'square';
import { config } from '../../config.js';

function getPath(obj, path) {
  return path.split('.').reduce((o, part) => o?.[part], obj);
}

// Required fields per provider, as [setting key, label]. Keys are saved in the
// database through the Integrations admin page (see services/runtimeConfig.js).
const REQUIRED = {
  STRIPE: [['stripe.secretKey', 'Secret key'], ['stripe.webhookSecret', 'Webhook signing secret']],
  BRAINTREE: [['braintree.merchantId', 'Merchant ID'], ['braintree.publicKey', 'Public key'], ['braintree.privateKey', 'Private key']],
  SQUARE: [['square.accessToken', 'Access token'], ['square.locationId', 'Location ID'], ['square.webhookSignatureKey', 'Webhook signature key']],
};

export function providerStatus() {
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

let stripeClient = null;
let stripeKey = null;
export function getStripe() {
  if (!stripeClient || stripeKey !== config.stripe.secretKey) {
    stripeKey = config.stripe.secretKey;
    stripeClient = new Stripe(stripeKey);
  }
  return stripeClient;
}

let gateway = null;
let gatewayKey = null;
export function getBraintreeGateway() {
  const { environment, merchantId, publicKey, privateKey } = config.braintree;
  const key = `${environment}|${merchantId}|${publicKey}|${privateKey}`;
  if (!gateway || gatewayKey !== key) {
    gatewayKey = key;
    gateway = new braintree.BraintreeGateway({
      environment: environment === 'production' ? braintree.Environment.Production : braintree.Environment.Sandbox,
      merchantId,
      publicKey,
      privateKey,
    });
  }
  return gateway;
}

let squareClient = null;
let squareKey = null;
export function getSquare() {
  const { accessToken, environment } = config.square;
  const key = `${environment}|${accessToken}`;
  if (!squareClient || squareKey !== key) {
    squareKey = key;
    squareClient = new SquareClient({
      token: accessToken,
      environment: environment === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
    });
  }
  return squareClient;
}
