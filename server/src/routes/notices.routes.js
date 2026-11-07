import { Router } from 'express';
import { siteAndNetworkAlerts } from '../services/notices.js';
import { siteWidePriceNotices } from '../services/payments/priceRuleService.js';
import { paymentOutageNotice } from '../services/payments/providerOutage.js';

// Public: what drivers should know across the whole site, now. Charge-point notices
// come with the station and zone lists.
export const noticesRouter = Router();

noticesRouter.get('/', async (req, res) => {
  const now = new Date();
  res.json({
    alerts: await siteAndNetworkAlerts(now),
    pricing: await siteWidePriceNotices(now),
    paymentOutage: await paymentOutageNotice(),
  });
});
