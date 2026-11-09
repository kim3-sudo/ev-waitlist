import { prisma, rawPrisma } from '../db.js';
import { currentTenantId, runWithTenant } from '../tenancy/context.js';
import { emitEvent } from './webhooks.js';
import { notifyDriver } from './notifier.js';
import { emailProblem } from './channels/email.js';
import { looksLikeEmail } from './contact.js';
import { siteConfig } from './runtimeConfig.js';

// Consumer receipts and B2B invoices, built from paid charges. Each charge is documented at most once
// as a receipt, and at most once on an invoice. Numbers come from a counter per site and kind, updated
// inside the same transaction as the document, so they never repeat and never skip.

export const DOCUMENT_KINDS = { INVOICE: 'INVOICE', CREDIT_NOTE: 'CREDIT_NOTE', RECEIPT: 'RECEIPT' };
const CREDIT_PREFIX = 'CN';
const MAX_CHARGES_PER_INVOICE = 500;

export async function getBillingSettings() {
  const tenantId = currentTenantId();
  return prisma.billingSettings.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
  });
}

// Checks the business details the admin enters. Returns { value } or { error }.
export function normalizeBillingSettings(input) {
  const value = {};
  const text = (key, label, max) => {
    if (input[key] === undefined) return null;
    const clean = String(input[key] ?? '').trim();
    if (clean.length > max) return `${label} must be ${max} characters or fewer`;
    value[key] = clean || null;
    return null;
  };
  for (const [key, label, max] of [
    ['legalName', 'Legal name', 200],
    ['taxId', 'Tax ID', 60],
    ['address', 'Address', 500],
    ['footerText', 'Footer text', 500],
  ]) {
    const problem = text(key, label, max);
    if (problem) return { error: problem };
  }
  for (const key of ['invoicePrefix', 'receiptPrefix']) {
    if (input[key] === undefined) continue;
    const clean = String(input[key] ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(clean)) return { error: 'Number prefixes use 1 to 10 letters or digits' };
    value[key] = clean;
  }
  if (input.paymentTermsDays !== undefined) {
    const days = Number(input.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) return { error: 'Payment terms must be a whole number of days from 0 to 365' };
    value.paymentTermsDays = days;
  }
  return { value };
}

// The next number of a kind, inside the transaction that uses it.
async function takeNumber(tx, tenantId, kind) {
  await tx.documentCounter.upsert({
    where: { tenantId_kind: { tenantId, kind } },
    create: { tenantId, kind, next: 1 },
    update: {},
  });
  const row = await tx.documentCounter.update({
    where: { tenantId_kind: { tenantId, kind } },
    data: { next: { increment: 1 } },
  });
  return row.next - 1;
}

export function formatNumber(prefix, n, when = new Date()) {
  return `${prefix}-${when.getUTCFullYear()}-${String(n).padStart(5, '0')}`;
}

// The receipt for a paid charge. Safe to call again: a charge gets one receipt, and the e-mail goes out
// once, with the first issue. The e-mail is sent only when the admin has e-mail receipts on.
export async function issueReceiptForCharge(chargeId) {
  const before = await rawPrisma.receipt.findUnique({ where: { chargeId } });
  const receipt = await issueReceiptRecord(chargeId);
  if (!receipt || before) return receipt;
  await emailReceipt(receipt);
  return receipt;
}

async function emailReceipt(receipt) {
  const charge = await rawPrisma.charge.findUnique({ where: { id: receipt.chargeId } });
  const settings = await rawPrisma.billingSettings.findUnique({ where: { tenantId: receipt.tenantId } });
  const to = looksLikeEmail(charge?.payerContact) ? charge.payerContact.trim() : null;
  if (!settings?.emailReceipts || !to || !emailAvailable(receipt.tenantId)) return;
  const money = (cents) => formatMoney(cents, receipt.currency);
  const link = `${siteConfig(receipt.tenantId).publicUrl}/api/receipts/${charge.token}`;
  await runWithTenant(receipt.tenantId, () =>
    notifyDriver({ contact: to, smsNumber: null }, {
      subject: `Receipt ${receipt.number}`,
      body: `Thank you for charging. Receipt ${receipt.number}: ${money(receipt.totalCents)} in total, including tax of ${money(receipt.taxCents)}.\n\nView it here: ${link}`,
    }),
  ).catch((err) => console.error('[billing] receipt e-mail not sent:', err.message));
}

async function issueReceiptRecord(chargeId) {
  const charge = await rawPrisma.charge.findUnique({ where: { id: chargeId } });
  if (!charge || charge.status !== 'PAID') return null;
  const existing = await rawPrisma.receipt.findUnique({ where: { chargeId } });
  if (existing) return existing;

  const settings = await rawPrisma.billingSettings.upsert({
    where: { tenantId: charge.tenantId },
    create: { tenantId: charge.tenantId },
    update: {},
  });
  // Charges made before tax existed have no net figure: their whole amount is the price.
  const netCents = charge.netCents ?? charge.amountCents + charge.holdCapturedCents;
  const taxCents = charge.taxCents ?? 0;

  try {
    return await rawPrisma.$transaction(async (tx) => {
      const n = await takeNumber(tx, charge.tenantId, DOCUMENT_KINDS.RECEIPT);
      return tx.receipt.create({
        data: {
          tenantId: charge.tenantId,
          number: formatNumber(settings.receiptPrefix, n),
          chargeId: charge.id,
          currency: charge.currency,
          netCents,
          taxCents,
          totalCents: netCents + taxCents,
          taxJson: charge.taxJson,
          payerName: charge.payerName,
        },
      });
    });
  } catch (err) {
    // Two requests can race to issue the same receipt. The loser finds the winner's receipt.
    if (err.code === 'P2002') return rawPrisma.receipt.findUnique({ where: { chargeId } });
    throw err;
  }
}

function describeCharge(charge, stationName) {
  const day = new Date(charge.createdAt ?? Date.now()).toISOString().slice(0, 10);
  return `Charging at ${stationName ?? 'charge point'}, ${day}`;
}

// Paid charges that are not yet on an invoice.
export async function uninvoicedCharges({ limit = 200 } = {}) {
  const invoiced = await rawPrisma.invoiceLine.findMany({ where: { chargeId: { not: null } }, select: { chargeId: true } });
  const taken = new Set(invoiced.map((l) => l.chargeId));
  const rows = await prisma.charge.findMany({
    where: { status: 'PAID' },
    include: { station: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: Math.min(limit * 2, 1000),
  });
  return rows
    .filter((c) => !taken.has(c.id))
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      stationName: c.station?.name ?? null,
      createdAt: c.createdAt,
      currency: c.currency,
      netCents: c.netCents ?? c.amountCents + c.holdCapturedCents,
      taxCents: c.taxCents ?? 0,
      totalCents: (c.netCents ?? c.amountCents + c.holdCapturedCents) + (c.taxCents ?? 0),
    }));
}

function supplierDetails(settings, tenantName) {
  return {
    name: settings?.legalName || tenantName,
    taxId: settings?.taxId ?? null,
    address: settings?.address ?? null,
  };
}

// Creates an invoice for a customer from paid, uninvoiced charges.
export async function createInvoice({ customerId, chargeIds }) {
  if (!Array.isArray(chargeIds) || chargeIds.length === 0) return { error: 'Choose at least one charge to invoice' };
  if (chargeIds.length > MAX_CHARGES_PER_INVOICE) return { error: `An invoice can hold at most ${MAX_CHARGES_PER_INVOICE} charges` };
  const unique = [...new Set(chargeIds.map(String))];

  const customer = await prisma.billingCustomer.findUnique({ where: { id: String(customerId ?? '') } });
  if (!customer) return { error: 'Customer not found', status: 404 };

  const charges = await prisma.charge.findMany({
    where: { id: { in: unique } },
    include: { station: { select: { name: true } } },
  });
  if (charges.length !== unique.length) return { error: 'Some of the charges were not found' };
  const notPaid = charges.filter((c) => c.status !== 'PAID');
  if (notPaid.length) return { error: 'Only paid charges can go on an invoice' };
  const already = await rawPrisma.invoiceLine.count({ where: { chargeId: { in: unique } } });
  if (already > 0) return { error: 'Some of these charges are already on an invoice' };
  const currencies = new Set(charges.map((c) => c.currency));
  if (currencies.size > 1) return { error: 'All charges on an invoice must use the same currency' };

  const tenantId = currentTenantId();
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const settings = await getBillingSettings();
  const currency = [...currencies][0];

  const lines = charges.map((c) => {
    const netCents = c.netCents ?? c.amountCents + c.holdCapturedCents;
    // A tax-exempt business is invoiced without tax. The exemption reference is printed on the invoice.
    const taxCents = customer.taxExempt ? 0 : c.taxCents ?? 0;
    return {
      description: describeCharge(c, c.station?.name),
      chargeId: c.id,
      netCents,
      taxCents,
      totalCents: netCents + taxCents,
      taxJson: c.taxJson,
    };
  });
  const totals = lines.reduce(
    (t, l) => ({ net: t.net + l.netCents, tax: t.tax + l.taxCents, total: t.total + l.totalCents }),
    { net: 0, tax: 0, total: 0 },
  );

  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + settings.paymentTermsDays * 24 * 3600 * 1000);
  try {
    const invoice = await rawPrisma.$transaction(async (tx) => {
      const n = await takeNumber(tx, tenantId, DOCUMENT_KINDS.INVOICE);
      return tx.invoice.create({
        data: {
          tenantId,
          number: formatNumber(settings.invoicePrefix, n, issuedAt),
          kind: DOCUMENT_KINDS.INVOICE,
          customerId: customer.id,
          currency,
          netCents: totals.net,
          taxCents: totals.tax,
          totalCents: totals.total,
          supplierSnapshot: JSON.stringify(supplierDetails(settings, tenant?.name)),
          customerSnapshot: JSON.stringify({
            name: customer.name,
            taxId: customer.taxId,
            email: customer.email,
            address: customer.address,
            taxExempt: customer.taxExempt === true,
            exemptionReference: customer.exemptionReference ?? null,
          }),
          issuedAt,
          dueAt,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });
    return { invoice };
  } catch (err) {
    if (err.code === 'P2002') return { error: 'Some of these charges were invoiced a moment ago. Refresh and try again.' };
    throw err;
  }
}

// A credit note corrects an invoice: it repeats its lines with negative amounts.
export async function createCreditNote({ invoiceId }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
  if (!invoice) return { error: 'Invoice not found', status: 404 };
  if (invoice.kind !== DOCUMENT_KINDS.INVOICE) return { error: 'Only an invoice can be credited' };
  const credited = await prisma.invoice.findFirst({ where: { creditsInvoiceId: invoice.id } });
  if (credited) return { error: `Invoice ${invoice.number} already has a credit note (${credited.number})` };

  const tenantId = currentTenantId();
  const issuedAt = new Date();
  const credit = await rawPrisma.$transaction(async (tx) => {
    const n = await takeNumber(tx, tenantId, DOCUMENT_KINDS.CREDIT_NOTE);
    return tx.invoice.create({
      data: {
        tenantId,
        number: formatNumber(CREDIT_PREFIX, n, issuedAt),
        kind: DOCUMENT_KINDS.CREDIT_NOTE,
        customerId: invoice.customerId,
        currency: invoice.currency,
        netCents: -invoice.netCents,
        taxCents: -invoice.taxCents,
        totalCents: -invoice.totalCents,
        supplierSnapshot: invoice.supplierSnapshot,
        customerSnapshot: invoice.customerSnapshot,
        issuedAt,
        creditsInvoiceId: invoice.id,
        lines: {
          create: invoice.lines.map((l) => ({
            description: `Credit for ${l.description}`,
            netCents: -l.netCents,
            taxCents: -l.taxCents,
            totalCents: -l.totalCents,
            taxJson: l.taxJson,
          })),
        },
      },
      include: { lines: true },
    });
  });
  return { invoice: credit };
}

export async function markInvoicePaid(invoiceId) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { error: 'Invoice not found', status: 404 };
  if (invoice.kind !== DOCUMENT_KINDS.INVOICE) return { error: 'A credit note has no payment to record' };
  if (invoice.status === 'PAID') return { invoice };
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'PAID', paidAt: new Date() },
  });
  return { invoice: updated };
}

// Whether e-mail receipts and invoices can be switched on: e-mail must be set up for the site.
export function emailAvailable(tenantId = currentTenantId()) {
  return emailProblem(siteConfig(tenantId).email) === null;
}

// An invoice built from ready-made lines, with no charges (for example a subscription fee). A tax-exempt
// customer is invoiced without tax, and the invoice states the exemption reference.
export async function issueInvoiceFromLines({ tenantId, customer, lines, currency, descriptionTag = null }) {
  const settings = await rawPrisma.billingSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const rows = lines.map((l) => {
    const taxCents = customer.taxExempt ? 0 : (l.taxCents ?? 0);
    return { description: l.description, chargeId: null, netCents: l.netCents, taxCents, totalCents: l.netCents + taxCents, taxJson: null };
  });
  const totals = rows.reduce((t, l) => ({ net: t.net + l.netCents, tax: t.tax + l.taxCents, total: t.total + l.totalCents }), { net: 0, tax: 0, total: 0 });
  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + settings.paymentTermsDays * 24 * 3600 * 1000);
  const invoice = await rawPrisma.$transaction(async (tx) => {
    const n = await takeNumber(tx, tenantId, DOCUMENT_KINDS.INVOICE);
    return tx.invoice.create({
      data: {
        tenantId,
        number: formatNumber(settings.invoicePrefix, n, issuedAt),
        kind: DOCUMENT_KINDS.INVOICE,
        customerId: customer.id,
        currency,
        netCents: totals.net,
        taxCents: totals.tax,
        totalCents: totals.total,
        supplierSnapshot: JSON.stringify(supplierDetails(settings, tenant?.name)),
        customerSnapshot: JSON.stringify({ name: customer.name, taxId: customer.taxId, email: customer.email, address: customer.address, taxExempt: customer.taxExempt === true, exemptionReference: customer.exemptionReference ?? null }),
        issuedAt,
        dueAt,
        lines: { create: rows },
      },
      include: { lines: true },
    });
  });
  await emitEvent('invoice.issued', { invoiceId: invoice.id, number: invoice.number, totalCents: invoice.totalCents, descriptionTag }, tenantId);
  if (settings.emailInvoices && customer.email && emailAvailable(tenantId)) {
    await runWithTenant(tenantId, () =>
      notifyDriver({ contact: customer.email, smsNumber: null }, {
        subject: `Invoice ${invoice.number}`,
        body: `Invoice ${invoice.number} for ${formatMoney(invoice.totalCents, currency)} (tax ${formatMoney(invoice.taxCents, currency)}). Due ${dueAt.toISOString().slice(0, 10)}.\n\n${rows.map((l) => `${l.description}: ${formatMoney(l.totalCents, currency)}`).join('\n')}\n\nAsk for the printed invoice if you need a copy.`,
      }),
    ).catch((err) => console.error('[billing] invoice e-mail not sent:', err.message));
  }
  return invoice;
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
