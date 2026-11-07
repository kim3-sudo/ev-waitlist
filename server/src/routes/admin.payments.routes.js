import { readPageRequest, afterPosition, pageOf } from '../pagination.js';
import { Router } from 'express';
import { prisma } from '../db.js';
import { enqueueForActivePartners } from '../ocpi/outbox.js';
import { TARIFF_ID } from '../ocpi/mappers.js';
import {
  savePaymentSettings,
  paymentSettingsResponse,
  previewRates,
  saveCalculatorInputs,
  getPaymentSettings,
} from '../services/payments/paymentSettingsService.js';
import { currentTenantId } from '../tenancy/context.js';

// Mounted behind payments.view (reads) and payments.manage (writes).
export const adminPaymentsRouter = Router();

// Auto-save for the energy-cost calculator. Saves only the cost inputs, not the price,
// so it never needs the price confirmation.
adminPaymentsRouter.put('/calculator', async (req, res) => {
  const result = await saveCalculatorInputs(req.body ?? {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

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

// Meter readings: how often charge points sample the meter, and how closely the readings
// must match the end-of-session reading before they are billed (see energyCheck.js).
const METER_LIMITS = {
  meterSampleSeconds: [10, 3600],
  meterToleranceWh: [0, 100000],
  meterTolerancePct: [0, 100],
  meterMinSessionMinutes: [0, 1440],
  meterMaxJumpWh: [100, 1000000],
};

adminPaymentsRouter.put('/meter', async (req, res) => {
  const body = req.body ?? {};
  const data = {};
  for (const [key, [min, max]] of Object.entries(METER_LIMITS)) {
    if (body[key] === undefined) continue;
    if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max) {
      return res.status(400).json({ error: `${key} must be a whole number from ${min} to ${max}` });
    }
    data[key] = body[key];
  }
  await getPaymentSettings();
  await prisma.paymentSettings.update({ where: { tenantId: currentTenantId() }, data });
  res.json(await paymentSettingsResponse());
});

// Recent charges, newest first. Optional ?status=PENDING|PAID|NEEDS_REVIEW|NO_CHARGE.
adminPaymentsRouter.get('/charges', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  const status = req.query.status ? { status: String(req.query.status) } : {};
  const rows = await prisma.charge.findMany({
    where: { AND: [status, afterPosition(page.position, 'createdAt', { date: true })] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
    include: { station: { select: { name: true } } },
  });
  const result = pageOf(rows, page.limit, (c) => ({ v: c.createdAt.toISOString(), i: c.id }));
  res.json({ nextCursor: result.nextCursor, data:
    result.data.map((c) => ({
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
      // Where the energy came from (METER_VALUES, STOP_TRANSACTION or NONE), and why a session needs review.
      energySource: c.energySource,
      energyNote: c.energyNote,
      // Set when a surge or complimentary change altered the amount (see services/payments/priceRules.js).
      pricingNote: c.pricingNote,
      status: c.status,
      provider: c.provider,
      providerRef: c.providerRef,
      createdAt: c.createdAt,
      paidAt: c.paidAt,
    })),
  });
});
