import { prisma } from '../db.js';

// Tax for a session's price. The administrator defines the rules (see the Tax rules page). Each rule
// has a rate, a mode (added on top of the price, or already included in it), what it applies to (the
// whole price, the energy part, or the time part), and where it applies (the whole site, a zone, or
// one charge point), with an optional validity window.
//
// Rates are stored in basis points (1 basis point = 0.01%), so 2000 means 20.00%.
// All money is integer cents. Each tax amount is rounded half-up to a cent.

export const TAX_MODES = ['EXCLUSIVE', 'INCLUSIVE'];
export const TAX_APPLIES_TO = ['ALL', 'ENERGY', 'TIME'];
export const TAX_SCOPES = ['SITE', 'ZONE', 'STATION'];
export const MAX_RATE_BASIS_POINTS = 10000;

const NAME_MAX = 100;
const JURISDICTION_MAX = 100;

// Checks a rule the admin entered. Returns { value } with the cleaned fields, or { error }.
export function normalizeTaxRule(input, { requireAll = true } = {}) {
  const out = {};
  const need = (key) => requireAll || input[key] !== undefined;

  if (need('name')) {
    const name = String(input.name ?? '').trim();
    if (!name) return { error: 'Name is required' };
    if (name.length > NAME_MAX) return { error: `Name must be ${NAME_MAX} characters or fewer` };
    out.name = name;
  }
  if (input.jurisdiction !== undefined) {
    const text = String(input.jurisdiction ?? '').trim();
    if (text.length > JURISDICTION_MAX) return { error: `Jurisdiction must be ${JURISDICTION_MAX} characters or fewer` };
    out.jurisdiction = text || null;
  }
  if (need('rateBasisPoints')) {
    const rate = Number(input.rateBasisPoints);
    if (!Number.isInteger(rate) || rate < 0 || rate > MAX_RATE_BASIS_POINTS) {
      return { error: 'Rate must be a whole number from 0 to 10000 (basis points: 2000 is 20%)' };
    }
    out.rateBasisPoints = rate;
  }
  if (need('mode')) {
    const mode = input.mode ?? 'EXCLUSIVE';
    if (!TAX_MODES.includes(mode)) return { error: 'Mode must be EXCLUSIVE (added on top) or INCLUSIVE (already in the price)' };
    out.mode = mode;
  }
  if (need('appliesTo')) {
    const appliesTo = input.appliesTo ?? 'ALL';
    if (!TAX_APPLIES_TO.includes(appliesTo)) return { error: 'Applies to must be ALL, ENERGY, or TIME' };
    out.appliesTo = appliesTo;
  }
  if (need('scope')) {
    const scope = input.scope ?? 'SITE';
    if (!TAX_SCOPES.includes(scope)) return { error: 'Scope must be SITE, ZONE, or STATION' };
    out.scope = scope;
  }
  // The zone or station that a ZONE or STATION rule names. A SITE rule names neither.
  if (out.scope === 'ZONE' || (!out.scope && input.zoneId)) out.zoneId = input.zoneId || null;
  if (out.scope === 'STATION' || (!out.scope && input.stationId)) out.stationId = input.stationId || null;
  if (out.scope === 'SITE') {
    out.zoneId = null;
    out.stationId = null;
  }
  if (out.scope === 'ZONE' && !out.zoneId) return { error: 'Choose the zone this rule applies to' };
  if (out.scope === 'STATION' && !out.stationId) return { error: 'Choose the charge point this rule applies to' };

  for (const key of ['validFrom', 'validUntil']) {
    if (input[key] === undefined) continue;
    if (input[key] === null || input[key] === '') {
      out[key] = null;
      continue;
    }
    const date = new Date(input[key]);
    if (Number.isNaN(date.getTime())) return { error: `${key === 'validFrom' ? 'Valid from' : 'Valid until'} must be a date` };
    out[key] = date;
  }
  if (out.validFrom && out.validUntil && out.validUntil <= out.validFrom) {
    return { error: 'Valid until must be after valid from' };
  }

  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) return { error: 'Priority must be a whole number from 0 to 9999' };
    out.priority = priority;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return { error: 'Enabled must be true or false' };
    out.enabled = input.enabled;
  }
  return { value: out };
}

// Whether a rule covers this charge at this moment.
export function ruleCovers(rule, { stationId, zoneId, pricingModel, at }) {
  if (!rule.enabled) return false;
  if (rule.scope === 'ZONE' && rule.zoneId !== zoneId) return false;
  if (rule.scope === 'STATION' && rule.stationId !== stationId) return false;
  if (rule.appliesTo === 'ENERGY' && pricingModel !== 'ENERGY') return false;
  if (rule.appliesTo === 'TIME' && pricingModel !== 'TIME') return false;
  const when = at instanceof Date ? at : new Date(at);
  if (rule.validFrom && when < rule.validFrom) return false;
  if (rule.validUntil && when >= rule.validUntil) return false;
  return true;
}

// The tax on a price, given the rules that apply to it.
//
// Inclusive rules come first: their combined rate is taken out of the price, so the net is what is
// left. Exclusive rules then add to that net, each rule on its own (rules do not compound on each
// other). Returns the net, the total tax, the gross the driver pays, and one line per rule.
export function computeTax(priceCents, rules) {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const inclusive = ordered.filter((r) => r.mode === 'INCLUSIVE' && r.rateBasisPoints > 0);
  const exclusive = ordered.filter((r) => r.mode === 'EXCLUSIVE' && r.rateBasisPoints > 0);
  const price = Math.max(0, Math.round(priceCents));

  const lines = [];
  let net = price;
  let gross = price;

  if (inclusive.length) {
    const combined = inclusive.reduce((sum, r) => sum + r.rateBasisPoints, 0);
    // Tax already inside a price of P at a combined rate R is P * R / (10000 + R).
    const inside = Math.round((price * combined) / (MAX_RATE_BASIS_POINTS + combined));
    let assigned = 0;
    inclusive.forEach((rule, i) => {
      const share = i === inclusive.length - 1
        ? inside - assigned
        : Math.round((inside * rule.rateBasisPoints) / combined);
      assigned += share;
      lines.push(taxLine(rule, share));
    });
    net = price - inside;
    gross = price;
  }

  if (exclusive.length) {
    for (const rule of exclusive) {
      lines.push(taxLine(rule, Math.round((net * rule.rateBasisPoints) / MAX_RATE_BASIS_POINTS)));
    }
    const added = lines.filter((l) => l.mode === 'EXCLUSIVE').reduce((sum, l) => sum + l.taxCents, 0);
    gross = net + added;
  }

  const taxCents = lines.reduce((sum, l) => sum + l.taxCents, 0);
  return { netCents: net, taxCents, grossCents: gross, lines };
}

function taxLine(rule, taxCents) {
  return {
    ruleId: rule.id,
    name: rule.name,
    jurisdiction: rule.jurisdiction ?? null,
    mode: rule.mode,
    rateBasisPoints: rule.rateBasisPoints,
    taxCents,
  };
}

// Tax for a charge at a site, from the rules stored for that site.
// `priceCents` is the session's price before tax, as the price rules left it.
export async function taxForCharge({ stationId, zoneId, pricingModel, at, priceCents }) {
  const rules = await prisma.taxRule.findMany({ where: { enabled: true } });
  const covering = rules.filter((r) => ruleCovers(r, { stationId, zoneId, pricingModel, at }));
  return computeTax(priceCents, covering);
}

// The rules a site has, for the Tax rules page.
export function serializeTaxRule(rule) {
  return {
    id: rule.id,
    name: rule.name,
    jurisdiction: rule.jurisdiction,
    rateBasisPoints: rule.rateBasisPoints,
    mode: rule.mode,
    appliesTo: rule.appliesTo,
    scope: rule.scope,
    zoneId: rule.zoneId,
    stationId: rule.stationId,
    validFrom: rule.validFrom,
    validUntil: rule.validUntil,
    priority: rule.priority,
    enabled: rule.enabled,
    updatedAt: rule.updatedAt,
  };
}
