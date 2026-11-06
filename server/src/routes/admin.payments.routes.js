import { Router } from 'express';
import { prisma } from '../db.js';
import { enqueueForActivePartners } from '../ocpi/outbox.js';
import { TARIFF_ID } from '../ocpi/mappers.js';
import {
  savePaymentSettings,
  paymentSettingsResponse,
  previewRates,
} from '../services/payments/paymentSettingsService.js';

// Mounted behind payments.view (reads) and payments.manage (writes).
export const adminPaymentsRouter = Router();

adminPaymentsRouter.get('/settings', async (req, res) => {
  res.json(await paymentSettingsResponse());
});

// Works out the calculator result and price check for unsaved input. Saves nothing.
adminPaymentsRouter.post('/preview', async (req, res) => {
  const result = await previewRates(req.body ?? {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

adminPaymentsRouter.put('/settings', async (req, res) => {
  const result = await savePaymentSettings(req.body ?? {});
  if (result.code === 'HIGH_RATE') return res.status(409).json({ error: result.error, code: result.code, check: result.check });
  if (result.error) return res.status(400).json({ error: result.error });
  // Roaming partners hold a copy of the tariff; send the change.
  await enqueueForActivePartners('TARIFFS', TARIFF_ID);
  res.json(await paymentSettingsResponse());
});

// Recent charges, newest first. Optional ?status=PENDING|PAID|NEEDS_REVIEW|NO_CHARGE.
adminPaymentsRouter.get('/charges', async (req, res) => {
  const where = req.query.status ? { status: String(req.query.status) } : {};
  const charges = await prisma.charge.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { station: { select: { name: true } } },
  });
  res.json(
    charges.map((c) => ({
      id: c.id,
      stationName: c.station.name,
      idTag: c.idTag,
      payerName: c.payerName,
      pricingModel: c.pricingModel,
      currency: c.currency,
      // amountCents is the balance still owed. totalCents is the whole session cost.
      amountCents: c.amountCents,
      heldCents: c.holdCapturedCents,
      totalCents: c.amountCents + c.holdCapturedCents,
      durationMinutes: Math.ceil(c.durationSeconds / 60),
      energyKwh: c.energyWh == null ? null : c.energyWh / 1000,
      status: c.status,
      provider: c.provider,
      providerRef: c.providerRef,
      createdAt: c.createdAt,
      paidAt: c.paidAt,
    })),
  );
});
