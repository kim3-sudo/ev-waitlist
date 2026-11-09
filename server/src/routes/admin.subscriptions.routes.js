import { Router } from 'express';
import { prisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { getPaymentSettings } from '../services/payments/paymentSettingsService.js';
import { billSubscriptionFees, cancelSubscription, startSubscription } from '../services/subscriptions.js';

// Charging plans and the drivers enrolled in them. Mounted behind payments.view (reads) and payments.manage.
export const adminSubscriptionsRouter = Router();

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const MAX_FEE_CENTS = 100_000_000;

function serializePlan(p, subscriberCount = null) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    monthlyFeeCents: p.monthlyFeeCents,
    currency: p.currency,
    discountPercent: p.discountPercent,
    active: p.active,
    subscriberCount,
    updatedAt: p.updatedAt,
  };
}

function serializeSubscription(s) {
  return {
    id: s.id,
    planId: s.planId,
    planName: s.plan?.name ?? null,
    idTag: s.idTag,
    driverName: s.driverName,
    billingCustomerId: s.billingCustomerId,
    billingCustomerName: s.billingCustomer?.name ?? null,
    status: s.status,
    startedAt: s.startedAt,
    cancelledAt: s.cancelledAt,
    lastBilledPeriod: s.lastBilledPeriod,
  };
}

// Checks a plan's fields. Returns { value } or { error }.
function planFields(body, { partial = false, defaultCurrency = 'USD' } = {}) {
  const value = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) return { error: 'Name is required' };
    if (name.length > NAME_MAX) return { error: `Name must be ${NAME_MAX} characters or fewer` };
    value.name = name;
  }
  if (body.description !== undefined) {
    const d = String(body.description ?? '').trim();
    if (d.length > DESCRIPTION_MAX) return { error: `Description must be ${DESCRIPTION_MAX} characters or fewer` };
    value.description = d || null;
  }
  if (!partial || body.monthlyFeeCents !== undefined) {
    const fee = Number(body.monthlyFeeCents ?? 0);
    if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE_CENTS) return { error: 'The monthly fee must be a whole number of cents, zero or more' };
    value.monthlyFeeCents = fee;
  }
  if (!partial || body.discountPercent !== undefined) {
    const pct = Number(body.discountPercent ?? 0);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return { error: 'The discount must be a whole percentage from 0 to 100' };
    value.discountPercent = pct;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { error: 'Active must be true or false' };
    value.active = body.active;
  }
  if (!partial) value.currency = defaultCurrency;
  return { value };
}

adminSubscriptionsRouter.get('/plans', async (_req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  const counts = await prisma.subscription.groupBy({ by: ['planId'], where: { status: 'ACTIVE' }, _count: { _all: true } });
  const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
  res.json({ data: plans.map((p) => serializePlan(p, byPlan.get(p.id) ?? 0)) });
});

adminSubscriptionsRouter.post('/plans', async (req, res) => {
  const settings = await getPaymentSettings();
  const parsed = planFields(req.body ?? {}, { defaultCurrency: settings.currency });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const created = await prisma.subscriptionPlan.create({ data: parsed.value });
  res.status(201).json(serializePlan(created, 0));
});

adminSubscriptionsRouter.patch('/plans/:id', async (req, res) => {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Plan not found' });
  const parsed = planFields(req.body ?? {}, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const updated = await prisma.subscriptionPlan.update({ where: { id: existing.id }, data: parsed.value });
  res.json(serializePlan(updated));
});

// A plan with subscribers cannot be deleted. Turn it off instead, so its subscribers keep their discount.
adminSubscriptionsRouter.delete('/plans/:id', async (req, res) => {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Plan not found' });
  const subscribers = await prisma.subscription.count({ where: { planId: existing.id } });
  if (subscribers > 0) return res.status(409).json({ error: 'This plan has subscribers. Turn it off instead.' });
  await prisma.subscriptionPlan.delete({ where: { id: existing.id } });
  res.status(204).end();
});

adminSubscriptionsRouter.get('/subscriptions', async (_req, res) => {
  const rows = await prisma.subscription.findMany({
    include: { plan: true, billingCustomer: true },
    orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    take: 500,
  });
  res.json({ data: rows.map(serializeSubscription) });
});

adminSubscriptionsRouter.post('/subscriptions', async (req, res) => {
  const idTag = String(req.body?.idTag ?? '').trim();
  if (!idTag) return res.status(400).json({ error: 'The driver\'s ID tag is required' });
  const outcome = await startSubscription({
    tenantId: currentTenantId(),
    planId: req.body?.planId,
    idTag,
    driverName: String(req.body?.driverName ?? '').trim(),
    billingCustomerId: req.body?.billingCustomerId || null,
  });
  if (outcome.error) return res.status(outcome.status ?? 400).json({ error: outcome.error });
  const full = await prisma.subscription.findUnique({ where: { id: outcome.subscription.id }, include: { plan: true, billingCustomer: true } });
  res.status(201).json(serializeSubscription(full));
});

adminSubscriptionsRouter.post('/subscriptions/:id/cancel', async (req, res) => {
  const outcome = await cancelSubscription({ tenantId: currentTenantId(), subscriptionId: req.params.id });
  if (outcome.error) return res.status(outcome.status ?? 400).json({ error: outcome.error });
  res.json({ id: outcome.subscription.id, status: outcome.subscription.status });
});

// Puts this month's plan fees on invoices, one per billing customer. Safe to run more than once a month.
adminSubscriptionsRouter.post('/bill', async (req, res) => {
  const period = req.body?.period ? String(req.body.period) : undefined;
  if (period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'period must look like 2026-11' });
  const out = await billSubscriptionFees({ tenantId: currentTenantId(), period });
  res.json({
    period: out.period,
    invoicesIssued: out.invoices.length,
    subscriptionsBilled: out.billed,
    skippedWithoutBillingCustomer: out.skippedNoCustomer,
    invoices: out.invoices.map((i) => ({ id: i.id, number: i.number, totalCents: i.totalCents })),
  });
});

