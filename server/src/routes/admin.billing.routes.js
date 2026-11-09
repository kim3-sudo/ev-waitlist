import { Router } from 'express';
import { prisma, rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import {
  createCreditNote,
  createInvoice,
  emailAvailable,
  getBillingSettings,
  markInvoicePaid,
  normalizeBillingSettings,
  uninvoicedCharges,
} from '../services/billing.js';
import { parseTaxLines, renderInvoice, renderReceipt } from '../services/documents.js';
import { reverseCharge } from '../services/reversal.js';
import { normalizeTaxRule, computeTax, ruleCovers, serializeTaxRule } from '../services/tax.js';

// Billing: business details, customers, invoices, credit notes and receipts. Mounted behind
// payments.view (reads) and payments.manage (changes).
export const adminBillingRouter = Router();

// Tax rules. Mounted behind the same permissions.
export const adminTaxRulesRouter = Router();

const TEXT_MAX = 500;

function sendError(res, outcome) {
  return res.status(outcome.status ?? 400).json({ error: outcome.error });
}

function serializeInvoice(inv, customerName) {
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    customerId: inv.customerId,
    customerName: customerName ?? inv.customer?.name ?? null,
    currency: inv.currency,
    netCents: inv.netCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    paidAt: inv.paidAt,
    creditsInvoiceId: inv.creditsInvoiceId,
  };
}

function serializeLine(line) {
  return {
    id: line.id,
    description: line.description,
    chargeId: line.chargeId,
    netCents: line.netCents,
    taxCents: line.taxCents,
    totalCents: line.totalCents,
    taxes: parseTaxLines(line.taxJson),
  };
}

function serializeCustomer(c, invoiceCount = null) {
  return {
    id: c.id,
    name: c.name,
    taxId: c.taxId,
    email: c.email,
    address: c.address,
    notes: c.notes,
    taxExempt: Boolean(c.taxExempt),
    exemptionReference: c.exemptionReference ?? null,
    invoiceCount,
    updatedAt: c.updatedAt,
  };
}

// Checks a customer's fields. Only the given fields are checked when `partial` is set.
function customerFields(body, { partial = false } = {}) {
  const value = {};
  const field = (key, label, max, required = false) => {
    if (body[key] === undefined && partial) return null;
    const clean = String(body[key] ?? '').trim();
    if (required && !clean) return `${label} is required`;
    if (clean.length > max) return `${label} must be ${max} characters or fewer`;
    value[key] = clean || null;
    return null;
  };
  const problems = [
    field('name', 'Name', 200, true),
    field('taxId', 'Tax ID', 60),
    field('email', 'E-mail', 200),
    field('address', 'Address', TEXT_MAX),
    field('notes', 'Notes', TEXT_MAX),
  ];
  const problem = problems.find(Boolean);
  if (problem) return { error: problem };
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return { error: 'E-mail address is not valid' };
  if (body.taxExempt !== undefined) {
    if (typeof body.taxExempt !== 'boolean') return { error: 'Tax exempt must be true or false' };
    value.taxExempt = body.taxExempt;
  }
  if (body.exemptionReference !== undefined || !partial) {
    const ref = String(body.exemptionReference ?? '').trim();
    if (ref.length > 100) return { error: 'The exemption reference must be 100 characters or fewer' };
    value.exemptionReference = ref || null;
  }
  return { value };
}

// ---- Billing settings ------------------------------------------------------------

adminBillingRouter.get('/settings', async (_req, res) => {
  const s = await getBillingSettings();
  res.json({
    legalName: s.legalName,
    taxId: s.taxId,
    address: s.address,
    invoicePrefix: s.invoicePrefix,
    receiptPrefix: s.receiptPrefix,
    paymentTermsDays: s.paymentTermsDays,
    footerText: s.footerText,
    emailReceipts: s.emailReceipts,
    emailInvoices: s.emailInvoices,
    emailAvailable: emailAvailable(),
  });
});

adminBillingRouter.put('/settings', async (req, res) => {
  const parsed = normalizeBillingSettings(req.body ?? {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  // E-mail receipts and invoices can only be switched on once e-mail is set up for the site.
  const switches = {};
  for (const key of ['emailReceipts', 'emailInvoices']) {
    if (req.body?.[key] === undefined) continue;
    if (typeof req.body[key] !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` });
    switches[key] = req.body[key];
  }
  if ((switches.emailReceipts || switches.emailInvoices) && !emailAvailable()) {
    return res.status(409).json({ error: 'E-mail is not set up for this site yet. Set it up under E-mail server first.' });
  }
  await getBillingSettings();
  const s = await prisma.billingSettings.update({
    where: { tenantId: currentTenantId() },
    data: { ...parsed.value, ...switches },
  });
  res.json({
    legalName: s.legalName,
    taxId: s.taxId,
    address: s.address,
    invoicePrefix: s.invoicePrefix,
    receiptPrefix: s.receiptPrefix,
    paymentTermsDays: s.paymentTermsDays,
    footerText: s.footerText,
    emailReceipts: s.emailReceipts,
    emailInvoices: s.emailInvoices,
    emailAvailable: emailAvailable(),
  });
});

// ---- Customers ---------------------------------------------------------------------

adminBillingRouter.get('/customers', async (_req, res) => {
  const rows = await prisma.billingCustomer.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 500 });
  res.json({ data: rows.map((c) => serializeCustomer(c)) });
});

adminBillingRouter.post('/customers', async (req, res) => {
  const parsed = customerFields(req.body ?? {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const created = await prisma.billingCustomer.create({ data: parsed.value });
  res.status(201).json(serializeCustomer(created, 0));
});

adminBillingRouter.patch('/customers/:id', async (req, res) => {
  const existing = await prisma.billingCustomer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const parsed = customerFields(req.body ?? {}, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const updated = await prisma.billingCustomer.update({ where: { id: existing.id }, data: parsed.value });
  res.json(serializeCustomer(updated));
});

adminBillingRouter.delete('/customers/:id', async (req, res) => {
  const existing = await prisma.billingCustomer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const invoiced = await prisma.invoice.count({ where: { customerId: existing.id } });
  if (invoiced > 0) return res.status(409).json({ error: 'This customer has invoices and cannot be deleted' });
  await prisma.billingCustomer.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ---- Charge reversal ---------------------------------------------------------------

// Records that a charge was reversed, with the reason. It does not refund the payment: that is done in
// the payment provider. A charge on an invoice must also be credited there.
adminBillingRouter.post('/charges/:id/reverse', async (req, res) => {
  const outcome = await reverseCharge({ tenantId: currentTenantId(), chargeId: req.params.id, reason: req.body?.reason });
  if (outcome.error) return sendError(res, outcome);
  res.json({
    id: outcome.charge.id,
    status: outcome.charge.status,
    reversedAt: outcome.charge.reversedAt,
    reversalReason: outcome.charge.reversalReason,
    onInvoice: outcome.onInvoice,
    message: outcome.onInvoice
      ? 'The charge is reversed. It is on an invoice, so issue a credit note for that invoice too. Refund the payment in your payment provider.'
      : 'The charge is reversed. Refund the payment in your payment provider.',
  });
});

// ---- Invoices ----------------------------------------------------------------------

// Paid charges that are not yet on an invoice, for the admin to choose from.
adminBillingRouter.get('/uninvoiced-charges', async (_req, res) => {
  res.json({ data: await uninvoicedCharges() });
});

adminBillingRouter.get('/invoices', async (req, res) => {
  const where = req.query.customerId ? { customerId: String(req.query.customerId) } : {};
  const rows = await prisma.invoice.findMany({
    where,
    include: { customer: { select: { name: true } } },
    orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
    take: 300,
  });
  res.json({ data: rows.map((inv) => serializeInvoice(inv)) });
});

adminBillingRouter.get('/invoices/:id', async (req, res) => {
  const inv = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: { customer: { select: { name: true } }, lines: true },
  });
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ ...serializeInvoice(inv), lines: inv.lines.map(serializeLine) });
});

adminBillingRouter.post('/invoices', async (req, res) => {
  const outcome = await createInvoice({ customerId: req.body?.customerId, chargeIds: req.body?.chargeIds });
  if (outcome.error) return sendError(res, outcome);
  res.status(201).json(serializeInvoice(outcome.invoice));
});

adminBillingRouter.post('/invoices/:id/credit-note', async (req, res) => {
  const outcome = await createCreditNote({ invoiceId: req.params.id });
  if (outcome.error) return sendError(res, outcome);
  res.status(201).json(serializeInvoice(outcome.invoice));
});

adminBillingRouter.post('/invoices/:id/mark-paid', async (req, res) => {
  const outcome = await markInvoicePaid(req.params.id);
  if (outcome.error) return sendError(res, outcome);
  res.json(serializeInvoice(outcome.invoice));
});

// The printable page for an invoice or credit note.
adminBillingRouter.get('/invoices/:id/document', async (req, res) => {
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  if (!inv) return res.status(404).send('Invoice not found');
  const settings = await getBillingSettings();
  res.type('html').send(
    renderInvoice({
      invoice: inv,
      lines: inv.lines,
      footerText: settings.footerText,
    }),
  );
});

// ---- Receipts ----------------------------------------------------------------------

adminBillingRouter.get('/receipts', async (_req, res) => {
  const rows = await prisma.receipt.findMany({ orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }], take: 300 });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      number: r.number,
      chargeId: r.chargeId,
      currency: r.currency,
      netCents: r.netCents,
      taxCents: r.taxCents,
      totalCents: r.totalCents,
      payerName: r.payerName,
      issuedAt: r.issuedAt,
    })),
  });
});

adminBillingRouter.get('/receipts/:id/document', async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
  if (!receipt) return res.status(404).send('Receipt not found');
  const charge = await rawPrisma.charge.findUnique({
    where: { id: receipt.chargeId },
    include: { station: { select: { name: true } } },
  });
  const settings = await getBillingSettings();
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: receipt.tenantId }, select: { name: true } });
  res.type('html').send(
    renderReceipt({
      receipt,
      charge,
      stationName: charge?.station?.name,
      supplier: { name: settings.legalName || tenant?.name, taxId: settings.taxId, address: settings.address },
      footerText: settings.footerText,
    }),
  );
});

// ---- Tax rules ---------------------------------------------------------------------

async function checkTarget(body) {
  if (body.scope === 'ZONE' && body.zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: body.zoneId } });
    if (!zone) return 'Zone not found';
  }
  if (body.scope === 'STATION' && body.stationId) {
    const station = await prisma.station.findUnique({ where: { id: body.stationId } });
    if (!station) return 'Charge point not found';
  }
  return null;
}

adminTaxRulesRouter.get('/', async (_req, res) => {
  const rows = await prisma.taxRule.findMany({ orderBy: [{ priority: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
  res.json({ data: rows.map(serializeTaxRule) });
});

adminTaxRulesRouter.post('/', async (req, res) => {
  const parsed = normalizeTaxRule(req.body ?? {}, { requireAll: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const problem = await checkTarget(parsed.value);
  if (problem) return res.status(400).json({ error: problem });
  const created = await prisma.taxRule.create({ data: { jurisdiction: null, ...parsed.value } });
  res.status(201).json(serializeTaxRule(created));
});

adminTaxRulesRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.taxRule.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Tax rule not found' });
  const parsed = normalizeTaxRule(req.body ?? {}, { requireAll: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const merged = { ...serializeTaxRule(existing), ...parsed.value };
  const problem = await checkTarget(merged);
  if (problem) return res.status(400).json({ error: problem });
  const updated = await prisma.taxRule.update({ where: { id: existing.id }, data: parsed.value });
  res.json(serializeTaxRule(updated));
});

adminTaxRulesRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.taxRule.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Tax rule not found' });
  await prisma.taxRule.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// What a price would be taxed under the current rules, for the admin to check a rule before a
// driver sees it. Example: GET /api/admin/tax-rules/preview?priceCents=1000&pricingModel=ENERGY&stationId=...
adminTaxRulesRouter.get('/preview', async (req, res) => {
  const priceCents = Number(req.query.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < 0) return res.status(400).json({ error: 'priceCents must be a whole number of cents' });
  const pricingModel = String(req.query.pricingModel ?? 'ENERGY');
  if (!['ENERGY', 'TIME'].includes(pricingModel)) return res.status(400).json({ error: 'pricingModel must be ENERGY or TIME' });
  const stationId = req.query.stationId ? String(req.query.stationId) : null;
  const station = stationId ? await prisma.station.findUnique({ where: { id: stationId } }) : null;
  if (stationId && !station) return res.status(404).json({ error: 'Charge point not found' });
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'at must be a date' });

  const rules = await prisma.taxRule.findMany({ where: { enabled: true } });
  const covering = rules.filter((r) => ruleCovers(r, { stationId, zoneId: station?.zoneId ?? null, pricingModel, at }));
  const result = computeTax(priceCents, covering);
  res.json({ ...result, rulesApplied: covering.map(serializeTaxRule) });
});

