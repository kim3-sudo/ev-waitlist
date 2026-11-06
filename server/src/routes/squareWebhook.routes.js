import { WebhooksHelper } from 'square';
import { prisma } from '../db.js';
import { markChargePaid } from '../services/payments/chargeService.js';
import { isProviderConfigured } from '../services/payments/providers.js';
import { siteConfig } from '../services/runtimeConfig.js';

// Square calls this for payment status changes. Mounted before express.json(),
// because the signature is computed over the raw body. The request's site decides
// the signature key and notification URL, so each site's Square account is
// checked against its own key. Requests whose signature doesn't match are refused.
export async function squareWebhookHandler(req, res) {
  if (!isProviderConfigured('SQUARE')) return res.status(404).end();

  const site = siteConfig();
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const valid = await WebhooksHelper.verifySignature({
    requestBody: body,
    signatureHeader: req.headers['x-square-hmacsha256-signature'] ?? '',
    signatureKey: site.square.webhookSignatureKey,
    notificationUrl: site.square.webhookUrl,
  }).catch(() => false);
  if (!valid) return res.status(400).send('Invalid signature');

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  if (event.type === 'payment.updated') {
    const payment = event.data?.object?.payment;
    if (payment?.status === 'COMPLETED' && payment.orderId) {
      // The charge was linked to this order when its payment link was created.
      // Only this site's charges are searched.
      const charge = await prisma.charge.findFirst({
        where: { provider: 'SQUARE', providerRef: payment.orderId, status: 'PENDING' },
        select: { id: true },
      });
      if (charge) await markChargePaid(charge.id, { provider: 'SQUARE', providerRef: payment.id });
    }
  }
  res.json({ received: true });
}
