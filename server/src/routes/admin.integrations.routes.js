import { Router } from 'express';
import { saveRuntimeSettings, runtimeSettingsView } from '../services/runtimeConfig.js';
import { providerStatus, getStripe, getBraintreeGateway, getSquare } from '../services/payments/providers.js';
import { siteConfig } from '../services/runtimeConfig.js';

// Mounted behind integrations.manage. Payment provider keys only.
export const adminIntegrationsRouter = Router();
const GROUPS = ['stripe', 'braintree', 'square'];

function view() {
  return { ...runtimeSettingsView(GROUPS), providers: providerStatus() };
}

adminIntegrationsRouter.get('/', (req, res) => {
  res.json(view());
});

adminIntegrationsRouter.put('/', async (req, res) => {
  const result = await saveRuntimeSettings(req.body ?? {}, GROUPS);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(view());
});

// Makes one harmless read-only call to the provider to check the saved keys.
const TESTS = {
  STRIPE: async () => {
    const account = await getStripe().accounts.retrieve();
    return `Connected to Stripe account ${account.id}.`;
  },
  BRAINTREE: async () => {
    await getBraintreeGateway().clientToken.generate({});
    return 'Connected to Braintree.';
  },
  SQUARE: async () => {
    const response = await getSquare().locations.get({ locationId: siteConfig().square.locationId });
    return `Connected to Square location "${response.location?.name ?? siteConfig().square.locationId}".`;
  },
};

adminIntegrationsRouter.post('/:provider/test', async (req, res) => {
  const provider = req.params.provider.toUpperCase();
  const test = TESTS[provider];
  if (!test) return res.status(404).json({ error: 'Unknown provider' });
  if (!providerStatus()[provider]?.configured) {
    return res.status(400).json({ ok: false, error: `Fill in all ${provider} fields first.` });
  }
  try {
    res.json({ ok: true, message: await test() });
  } catch (err) {
    res.status(400).json({ ok: false, error: `The ${provider} keys were rejected: ${err.message}` });
  }
});
