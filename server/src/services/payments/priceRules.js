// Temporary price changes: surge pricing (a percentage up or down) and complimentary
// charging (free). Each rule has one scope:
//   NETWORK     every site in the installation (set by the installation administrator)
//   SITE        every charge point in this site
//   ZONE        every charge point in one zone (a group)
//   STATION     one charge point
//   POWER_TYPE  every AC connector, or every DC connector
//
// Where rules overlap at a moment: complimentary charging wins over any surge. Among
// surges, the most specific scope wins (charge point, then zone, then connector type,
// then site, then network). Equally specific surges: the one that started later wins.
//
// Rules are checked for each billed unit (each minute, or each hour when billing by
// hour) at the moment that unit starts, so a session that spans a change is priced
// piece by piece, the same way the time-of-day schedule is.
//
// Pure functions: no I/O, so they can be tested directly.

export const RULE_KINDS = ['SURGE', 'COMPLIMENTARY'];
export const RULE_SCOPES = ['NETWORK', 'SITE', 'ZONE', 'STATION', 'POWER_TYPE'];
export const POWER_CLASSES = ['AC', 'DC'];
export const SURGE_PERCENT_MIN = -99;
export const SURGE_PERCENT_MAX = 300;

const SPECIFICITY = { STATION: 5, ZONE: 4, POWER_TYPE: 3, SITE: 2, NETWORK: 1 };

export const NO_ADJUSTMENT = Object.freeze({ free: false, percent: 0, rule: null });

// AC or DC, from a connector's OCPI power type (see ocpi/mappers.js). Null when unknown.
export function powerClassOf(powerType) {
  if (!powerType) return null;
  return powerType === 'DC' ? 'DC' : 'AC';
}

export function isActiveAt(rule, at) {
  const start = new Date(rule.startsAt).getTime();
  const end = rule.endsAt == null ? null : new Date(rule.endsAt).getTime();
  const t = at.getTime();
  return start <= t && (end == null || t < end);
}

// Whether a rule covers a charge point. ctx: { tenantId, stationId, zoneId, powerClass }.
// Rules are expected to be already limited to this site and the network (see priceRuleService).
export function appliesTo(rule, ctx) {
  switch (rule.scope) {
    case 'NETWORK':
      return rule.tenantId == null;
    case 'SITE':
      return rule.tenantId === ctx.tenantId;
    case 'ZONE':
      return ctx.zoneId != null && rule.zoneId === ctx.zoneId;
    case 'STATION':
      return rule.stationId === ctx.stationId;
    case 'POWER_TYPE':
      return ctx.powerClass != null && rule.powerClass === ctx.powerClass;
    default:
      return false;
  }
}

function startMs(rule) {
  return new Date(rule.startsAt).getTime();
}

// True when rule `a` should be used in place of surge `b`.
function beats(a, b) {
  const byScope = SPECIFICITY[a.scope] - SPECIFICITY[b.scope];
  if (byScope !== 0) return byScope > 0;
  return startMs(a) > startMs(b);
}

// The price change in effect at one moment, for one connector.
// Returns { free, percent, rule }. `rule` is null when nothing applies.
export function adjustmentAt(rules, at, ctx) {
  let surge = null;
  for (const rule of rules) {
    if (!isActiveAt(rule, at) || !appliesTo(rule, ctx)) continue;
    if (rule.kind === 'COMPLIMENTARY') return { free: true, percent: 0, rule };
    if (rule.kind === 'SURGE' && (surge === null || beats(rule, surge))) surge = rule;
  }
  if (surge === null) return NO_ADJUSTMENT;
  return { free: false, percent: surge.percent, rule: surge };
}

// A rate (in cents per billing unit) after the adjustment.
export function adjustRate(rateCents, adjustment) {
  if (adjustment.free) return 0;
  if (adjustment.percent === 0) return rateCents;
  return Math.round((rateCents * (100 + adjustment.percent)) / 100);
}

// A short line for the admin charges list, e.g. "Price change +25% (Event night)".
export function describeAdjustment(adjustment) {
  const label = adjustment.rule?.label?.trim();
  const change = adjustment.free
    ? 'Complimentary charging'
    : `Price change ${adjustment.percent > 0 ? '+' : ''}${adjustment.percent}%`;
  return label ? `${change} (${label})` : change;
}

// Checks the shape of one rule (already normalized: kind, scope, percent, times as Dates).
// Target existence (zone, charge point) and the installation administrator's network
// rights are checked by the service. An end time in the past is refused only for a new
// rule, so an admin can end a running change by setting its end to now.
// Returns an error message or null.
export function ruleShapeError(rule, { now, isNew }) {
  if (!RULE_KINDS.includes(rule.kind)) return 'kind must be SURGE or COMPLIMENTARY';
  if (!RULE_SCOPES.includes(rule.scope)) return 'scope must be network, site, group, charge point, or AC/DC';
  if (rule.kind === 'SURGE') {
    if (!Number.isInteger(rule.percent) || rule.percent === 0) {
      return 'Enter the price change as a whole percentage other than 0, for example 25 or -15';
    }
    if (rule.percent < SURGE_PERCENT_MIN || rule.percent > SURGE_PERCENT_MAX) {
      return `The price change must be from ${SURGE_PERCENT_MIN}% to +${SURGE_PERCENT_MAX}%`;
    }
    if (!rule.endsAt) return 'A surge price needs an end time';
  } else if (rule.percent != null) {
    return 'Complimentary charging does not take a percentage';
  }
  if (rule.scope === 'POWER_TYPE' && !POWER_CLASSES.includes(rule.powerClass)) {
    return 'Choose AC or DC';
  }
  if (rule.label && rule.label.length > 120) return 'The label can be at most 120 characters';
  if (rule.startsAt == null || Number.isNaN(rule.startsAt.getTime())) return 'The start time is not a valid date';
  if (rule.endsAt != null) {
    if (Number.isNaN(rule.endsAt.getTime())) return 'The end time is not a valid date';
    if (rule.endsAt <= rule.startsAt) return 'The end must be after the start';
    if (isNew && rule.endsAt <= now) return 'The end must be in the future';
  }
  return null;
}
