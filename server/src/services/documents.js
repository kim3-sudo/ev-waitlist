// Printable documents: a consumer receipt and a B2B invoice (or credit note), as standalone HTML
// pages. A browser prints them to PDF. Every value from the database is escaped.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function money(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents ?? 0) / 100);
}

function percent(basisPoints) {
  return `${(basisPoints / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

// The tax lines saved on a charge, invoice line or receipt (JSON, or null).
export function parseTaxLines(json) {
  if (!json) return [];
  try {
    const lines = JSON.parse(json);
    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
}

function parseSnapshot(json) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

const STYLE = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1d1f; margin: 0; padding: 32px; background: #fff; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .muted { color: #5f6368; font-size: 13px; white-space: pre-line; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #d0d7de; padding-bottom: 16px; }
  .parties { display: flex; gap: 32px; margin-top: 16px; }
  .parties > div { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e5e7eb; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 600; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef2f7; font-size: 12px; }
  .footer { margin-top: 32px; border-top: 1px solid #d0d7de; padding-top: 12px; }
  @media print { body { padding: 0; } }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function taxTable(lines, currency) {
  if (!lines.length) return '';
  const rows = lines
    .map((l) => `<tr><td>${escapeHtml(l.name)}${l.jurisdiction ? ` (${escapeHtml(l.jurisdiction)})` : ''}</td>
      <td class="num">${percent(l.rateBasisPoints)}</td>
      <td>${l.mode === 'INCLUSIVE' ? 'included in price' : 'added'}</td>
      <td class="num">${money(l.taxCents, currency)}</td></tr>`)
    .join('');
  return `<h2>Tax</h2><table><thead><tr><th>Tax</th><th class="num">Rate</th><th>Treatment</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sellerBlock(supplier) {
  const s = supplier ?? {};
  return `<div><strong>${escapeHtml(s.name)}</strong>${s.taxId ? `<div class="muted">Tax ID: ${escapeHtml(s.taxId)}</div>` : ''}${
    s.address ? `<div class="muted">${escapeHtml(s.address)}</div>` : ''}</div>`;
}

// The consumer receipt for one paid charge.
export function renderReceipt({ receipt, charge, stationName, supplier, footerText }) {
  const lines = parseTaxLines(receipt.taxJson);
  const body = `
    <div class="head">
      <div><h1>Receipt</h1><div class="muted">${escapeHtml(receipt.number)}</div></div>
      <div class="muted">${escapeHtml(new Date(receipt.issuedAt).toLocaleString('en-US'))}</div>
    </div>
    <div class="parties">${sellerBlock(supplier)}
      <div><strong>Charging session</strong><div class="muted">${escapeHtml(stationName ?? 'Charge point')}${
        charge?.energyWh != null ? `\nEnergy: ${(charge.energyWh / 1000).toFixed(2)} kWh` : ''}${
        charge?.durationSeconds != null ? `\nDuration: ${Math.round(charge.durationSeconds / 60)} min` : ''}</div></div>
    </div>
    <table>
      <thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
      <tbody>
        <tr><td>Charging, before tax</td><td class="num">${money(receipt.netCents, receipt.currency)}</td></tr>
        ${receipt.taxCents ? `<tr><td>Tax</td><td class="num">${money(receipt.taxCents, receipt.currency)}</td></tr>` : ''}
      </tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(receipt.totalCents, receipt.currency)}</td></tr></tfoot>
    </table>
    ${taxTable(lines, receipt.currency)}
    ${footerText ? `<div class="footer muted">${escapeHtml(footerText)}</div>` : ''}`;
  return page(`Receipt ${receipt.number}`, body);
}

// An invoice, or a credit note (negative amounts), with its lines.
export function renderInvoice({ invoice, lines, footerText }) {
  const supplier = parseSnapshot(invoice.supplierSnapshot);
  const customer = parseSnapshot(invoice.customerSnapshot);
  const isCredit = invoice.kind === 'CREDIT_NOTE';
  const title = isCredit ? 'Credit note' : 'Invoice';
  const rows = lines
    .map((l) => `<tr><td>${escapeHtml(l.description)}</td><td class="num">${money(l.netCents, invoice.currency)}</td>
      <td class="num">${money(l.taxCents, invoice.currency)}</td><td class="num">${money(l.totalCents, invoice.currency)}</td></tr>`)
    .join('');
  const due = invoice.dueAt && !isCredit ? `<div class="muted">Due ${escapeHtml(new Date(invoice.dueAt).toLocaleDateString('en-US'))}</div>` : '';
  const status = invoice.kind === 'INVOICE' ? `<span class="status">${invoice.status === 'PAID' ? 'Paid' : 'Unpaid'}</span>` : '';
  const body = `
    <div class="head">
      <div><h1>${title}</h1><div class="muted">${escapeHtml(invoice.number)}</div>${status}</div>
      <div class="muted">Issued ${escapeHtml(new Date(invoice.issuedAt).toLocaleDateString('en-US'))}${due}${
        invoice.creditsInvoiceId ? `\nCorrects invoice ${escapeHtml(invoice.creditsInvoiceId)}` : ''}</div>
    </div>
    <div class="parties">
      <div><h2>From</h2>${sellerBlock(supplier)}</div>
      <div><h2>Bill to</h2><strong>${escapeHtml(customer.name)}</strong>${customer.taxId ? `<div class="muted">Tax ID: ${escapeHtml(customer.taxId)}</div>` : ''}${
        customer.address ? `<div class="muted">${escapeHtml(customer.address)}</div>` : ''}</div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Before tax</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td></td><td class="num">${money(invoice.netCents, invoice.currency)}</td><td class="num">${money(invoice.taxCents, invoice.currency)}</td><td class="num">${money(invoice.totalCents, invoice.currency)}</td></tr>
      </tfoot>
    </table>
    ${footerText ? `<div class="footer muted">${escapeHtml(footerText)}</div>` : ''}`;
  return page(`${title} ${invoice.number}`, body);
}
