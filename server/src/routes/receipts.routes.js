import { Router } from 'express';
import { rawPrisma } from '../db.js';
import { renderReceipt } from '../services/documents.js';

// A driver's receipt, opened from the link in their payment message. The link uses the charge's
// unguessable token, the same one as the payment page. No admin login.
export const publicReceiptsRouter = Router();

publicReceiptsRouter.get('/:token', async (req, res) => {
  const charge = await rawPrisma.charge.findUnique({
    where: { token: req.params.token },
    include: { station: { select: { name: true } } },
  });
  if (!charge) return res.status(404).send('Receipt not found');
  const receipt = await rawPrisma.receipt.findUnique({ where: { chargeId: charge.id } });
  if (!receipt) return res.status(404).send('A receipt has not been issued for this charge yet.');

  const settings = await rawPrisma.billingSettings.findUnique({ where: { tenantId: charge.tenantId } });
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: charge.tenantId }, select: { name: true } });
  res.type('html').send(
    renderReceipt({
      receipt,
      charge,
      stationName: charge.station?.name,
      supplier: { name: settings?.legalName || tenant?.name, taxId: settings?.taxId, address: settings?.address },
      footerText: settings?.footerText,
    }),
  );
});
