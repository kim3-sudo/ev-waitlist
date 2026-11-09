import { rawPrisma } from '../db.js';
import { emitEvent } from './webhooks.js';

// Reverses a charge: it stops counting as paid, and the reason is kept on it. This records the reversal
// only. It does not move money: refund the payment in the payment provider as well. A charge already on
// an invoice must also be credited on that invoice, and the result says so.
export async function reverseCharge({ tenantId, chargeId, reason }) {
  const text = String(reason ?? '').trim();
  if (!text) return { error: 'Say why the charge is being reversed' };
  if (text.length > 500) return { error: 'The reason must be 500 characters or fewer' };
  const charge = await rawPrisma.charge.findUnique({ where: { id: chargeId } });
  if (!charge || charge.tenantId !== tenantId) return { error: 'Charge not found', status: 404 };
  if (charge.status === 'REVERSED') return { error: 'This charge is already reversed' };
  if (charge.status !== 'PAID' && charge.status !== 'PENDING') {
    return { error: 'Only a paid or unpaid charge can be reversed' };
  }
  const updated = await rawPrisma.charge.update({
    where: { id: charge.id },
    data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: text },
  });
  const onInvoice = (await rawPrisma.invoiceLine.count({ where: { chargeId: charge.id } })) > 0;
  await emitEvent(
    'charge.reversed',
    { chargeId: charge.id, stationId: charge.stationId, totalCents: (charge.netCents ?? 0) + (charge.taxCents ?? 0), reason: text },
    tenantId,
  );
  return { charge: updated, onInvoice };
}
