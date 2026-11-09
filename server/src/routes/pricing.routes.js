import { Router } from 'express';
import { getPaymentSettings } from '../services/payments/paymentSettingsService.js';
import { driverPricing } from '../services/payments/driverPricing.js';

// Public: the site's prices for the waitlist's Pricing tab -- the base rate and the
// time-of-day windows, with the one in effect now. Price changes come with the notices.
export const pricingRouter = Router();

pricingRouter.get('/', async (req, res) => {
  res.json(driverPricing(await getPaymentSettings()));
});
