import { rawPrisma } from '../db.js';
import { emitEvent } from './webhooks.js';
import { issueInvoiceFromLines } from './billing.js';

// Charging plans. An admin defines a plan with a monthly fee and a discount. A driver enrolled in a plan
// (by their ID tag) gets the discount on each session. The monthly fee goes on an invoice to the
// subscriber's billing customer, once per calendar month. Consumer subscribers with no billing customer
// get the discount, but their fee is not collected by the server (see docs/charge-point-features.md).

export const PLAN_CURRENCY_DEFAULT = 'USD';

// The discount on a session's price before tax. Returns zero when the ID tag has no active plan.
export async function discountForSession({ tenantId, idTag, netCents }) {
  if (!idTag || !netCents) return { discountCents: 0, subscriptionId: null, planName: null };
  const sub = await rawPrisma.subscription.findFirst({
    where: { tenantId, idTag, status: 'ACTIVE', plan: { active: true } },
    include: { plan: true },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
  });
  if (!sub || sub.plan.discountPercent <= 0) return { discountCents: 0, subscriptionId: null, planName: null };
  const discountCents = Math.min(netCents, Math.round((netCents * sub.plan.discountPercent) / 100));
  return { discountCents, subscriptionId: sub.id, planName: sub.plan.name };
}

// The calendar month a date falls in, as YYYY-MM (UTC).
export function periodOf(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Puts this month's fees for subscribers on invoices, one invoice per billing customer. A subscription
// whose fee was already billed for the period is skipped, so running this twice is safe.
export async function billSubscriptionFees({ tenantId, period = periodOf() }) {
  const subs = await rawPrisma.subscription.findMany({
    where: { tenantId, status: 'ACTIVE', billingCustomerId: { not: null }, plan: { monthlyFeeCents: { gt: 0 } } },
    include: { plan: true, billingCustomer: true },
    orderBy: [{ id: 'asc' }],
  });
  const due = subs.filter((s) => s.lastBilledPeriod !== period);
  const byCustomer = new Map();
  for (const s of due) {
    if (!byCustomer.has(s.billingCustomerId)) byCustomer.set(s.billingCustomerId, { customer: s.billingCustomer, subs: [] });
    byCustomer.get(s.billingCustomerId).subs.push(s);
  }
  const invoices = [];
  for (const { customer, subs: list } of byCustomer.values()) {
    const currency = list[0].plan.currency;
    const invoice = await issueInvoiceFromLines({
      tenantId,
      customer,
      currency,
      descriptionTag: 'subscription-fee',
      lines: list.map((s) => ({
        description: `${s.plan.name} plan${s.driverName ? ` for ${s.driverName}` : ''}, ${period}`,
        netCents: s.plan.monthlyFeeCents,
        taxCents: 0,
      })),
    });
    await rawPrisma.subscription.updateMany({
      where: { id: { in: list.map((s) => s.id) } },
      data: { lastBilledPeriod: period },
    });
    invoices.push(invoice);
  }
  const skippedNoCustomer = await rawPrisma.subscription.count({
    where: { tenantId, status: 'ACTIVE', billingCustomerId: null, plan: { monthlyFeeCents: { gt: 0 } } },
  });
  return { period, invoices, billed: due.length, skippedNoCustomer };
}

export async function startSubscription({ tenantId, planId, idTag, driverName, billingCustomerId }) {
  const plan = await rawPrisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.tenantId !== tenantId) return { error: 'Plan not found', status: 404 };
  if (!plan.active) return { error: 'This plan is not open to new subscribers' };
  const clash = await rawPrisma.subscription.findFirst({ where: { tenantId, idTag, status: 'ACTIVE' } });
  if (clash) return { error: `The ID tag ${idTag} already has an active plan` };
  if (billingCustomerId) {
    const customer = await rawPrisma.billingCustomer.findUnique({ where: { id: billingCustomerId } });
    if (!customer || customer.tenantId !== tenantId) return { error: 'Billing customer not found', status: 404 };
  }
  const sub = await rawPrisma.subscription.create({
    data: { tenantId, planId, idTag, driverName: driverName || null, billingCustomerId: billingCustomerId || null, status: 'ACTIVE' },
  });
  await emitEvent('subscription.started', { subscriptionId: sub.id, planId, idTag }, tenantId);
  return { subscription: sub };
}

export async function cancelSubscription({ tenantId, subscriptionId }) {
  const sub = await rawPrisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || sub.tenantId !== tenantId) return { error: 'Subscription not found', status: 404 };
  if (sub.status === 'CANCELLED') return { error: 'This subscription is already cancelled' };
  const updated = await rawPrisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  await emitEvent('subscription.cancelled', { subscriptionId: sub.id, idTag: sub.idTag }, tenantId);
  return { subscription: updated };
}
