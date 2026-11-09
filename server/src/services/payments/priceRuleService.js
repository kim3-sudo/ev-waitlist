import { afterPosition, pageOf } from '../../pagination.js';
// Saving, listing and applying temporary price changes (surge and complimentary).
// The rules themselves are worked out in priceRules.js.
import { rawPrisma, prisma } from '../../db.js';
import { currentTenantId, ownOrNetworkWhere } from '../../tenancy/context.js';
import { publishChange } from '../liveUpdates.js';
import { activeNowWhere, canEditRow, parseWhen, scheduleStatus } from '../notices.js';
import { complimentaryOutagesDuring } from './providerOutage.js';
import {
  NO_ADJUSTMENT,
  adjustmentAt,
  powerClassOf,
  ruleShapeError,
  RULE_KINDS,
  RULE_SCOPES,
} from './priceRules.js';

const RULE_INCLUDE = { zone: { select: { name: true } }, station: { select: { name: true } } };

function serializeRule(rule, ctx) {
  return {
    id: rule.id,
    kind: rule.kind,
    scope: rule.scope,
    zoneId: rule.zoneId,
    zoneName: rule.zone?.name ?? null,
    stationId: rule.stationId,
    stationName: rule.station?.name ?? null,
    powerClass: rule.powerClass,
    percent: rule.percent,
    label: rule.label,
    startsAt: rule.startsAt,
    endsAt: rule.endsAt,
    status: scheduleStatus(rule, ctx.now),
    network: rule.tenantId == null,
    canEdit: canEditRow(rule, ctx),
  };
}

// Every price change this site can see (its own, and network-wide ones), newest first.
export async function listPriceRules({ instanceAdmin, limit, position }) {
  const tenantId = currentTenantId();
  const now = new Date();
  const rows = await rawPrisma.priceRule.findMany({
    where: { AND: [ownOrNetworkWhere(tenantId), afterPosition(position, 'startsAt', { date: true })] },
    include: RULE_INCLUDE,
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (row) => ({ v: row.startsAt.toISOString(), i: row.id }));
  return { data: page.data.map((row) => serializeRule(row, { tenantId, instanceAdmin, now })), nextCursor: page.nextCursor };
}

// Checks a rule's input, merged over the existing rule when editing. Returns { data }
// ready to save, or { error, status? }.
async function normalizeRule(input, existing, { instanceAdmin }) {
  const tenantId = currentTenantId();
  const now = new Date();

  const kind = input.kind ?? existing?.kind;
  if (!RULE_KINDS.includes(kind)) return { error: 'Choose surge pricing or complimentary charging' };

  const scope = input.scope ?? existing?.scope;
  if (!RULE_SCOPES.includes(scope)) {
    return { error: 'Choose what the change applies to: the network, this site, a group, a charge point, or AC/DC' };
  }
  if (scope === 'NETWORK' && !instanceAdmin) {
    return { error: 'Only the installation administrator can change prices across the network', status: 403 };
  }

  let percent = input.percent !== undefined ? input.percent : existing?.percent ?? null;
  if (typeof percent === 'string' && percent.trim() !== '') percent = Number(percent);
  if (percent === '' || percent === undefined) percent = null;
  if (kind === 'COMPLIMENTARY') percent = null;

  const label = String(input.label !== undefined ? input.label ?? '' : existing?.label ?? '').trim();

  const start = parseWhen(input.startsAt !== undefined ? input.startsAt : existing?.startsAt, now);
  if (start.error) return { error: `Start: ${start.error.toLowerCase()}` };
  const end = parseWhen(input.endsAt !== undefined ? input.endsAt : existing?.endsAt, null);
  if (end.error) return { error: `End: ${end.error.toLowerCase()}` };

  // The target field for this scope only: a zone, a charge point, or AC/DC.
  const target = (field) => (input[field] !== undefined ? input[field] : existing?.[field] ?? null);
  const zoneId = scope === 'ZONE' ? target('zoneId') : null;
  const stationId = scope === 'STATION' ? target('stationId') : null;
  const powerClass = scope === 'POWER_TYPE' ? target('powerClass') : null;

  const shape = {
    kind,
    scope,
    percent,
    label,
    powerClass,
    startsAt: start.value,
    endsAt: end.value,
  };
  const shapeError = ruleShapeError(shape, { now, isNew: !existing });
  if (shapeError) return { error: shapeError };

  if (scope === 'ZONE') {
    if (!zoneId || !(await prisma.zone.findFirst({ where: { id: zoneId }, select: { id: true } }))) {
      return { error: 'Choose a group of charge points' };
    }
  }
  if (scope === 'STATION') {
    if (!stationId || !(await prisma.station.findFirst({ where: { id: stationId }, select: { id: true } }))) {
      return { error: 'Choose a charge point' };
    }
  }

  return {
    data: {
      kind,
      scope,
      tenantId: scope === 'NETWORK' ? null : tenantId,
      zoneId,
      stationId,
      powerClass,
      percent,
      label,
      startsAt: start.value,
      endsAt: end.value,
    },
  };
}

export async function createPriceRule(input, { adminId, instanceAdmin }) {
  const normalized = await normalizeRule(input, null, { instanceAdmin });
  if (normalized.error) return normalized;
  const rule = await rawPrisma.priceRule.create({
    data: { ...normalized.data, createdByAdminId: adminId },
    include: RULE_INCLUDE,
  });
  publishChange('priceRule', rule.id);
  return { rule: serializeRule(rule, { tenantId: currentTenantId(), instanceAdmin, now: new Date() }) };
}

async function findEditable(id, { instanceAdmin }) {
  const tenantId = currentTenantId();
  const row = await rawPrisma.priceRule.findFirst({ where: { AND: [{ id }, ownOrNetworkWhere(tenantId)] } });
  if (!row) return { error: 'Price change not found', status: 404 };
  if (!canEditRow(row, { tenantId, instanceAdmin })) {
    return { error: 'Only the installation administrator can change a network-wide price change', status: 403 };
  }
  return { row };
}

export async function updatePriceRule(id, input, { instanceAdmin }) {
  const found = await findEditable(id, { instanceAdmin });
  if (found.error) return found;
  const normalized = await normalizeRule(input, found.row, { instanceAdmin });
  if (normalized.error) return normalized;
  const rule = await rawPrisma.priceRule.update({ where: { id }, data: normalized.data, include: RULE_INCLUDE });
  publishChange('priceRule', id);
  return { rule: serializeRule(rule, { tenantId: currentTenantId(), instanceAdmin, now: new Date() }) };
}

export async function deletePriceRule(id, { instanceAdmin }) {
  const found = await findEditable(id, { instanceAdmin });
  if (found.error) return found;
  await rawPrisma.priceRule.delete({ where: { id } });
  publishChange('priceRule', id);
  return {};
}

// Price changes drivers see across the whole site (site-wide and network-wide), while active.
export async function siteWidePriceNotices(now = new Date()) {
  const tenantId = currentTenantId();
  const rows = await rawPrisma.priceRule.findMany({
    where: { AND: [ownOrNetworkWhere(tenantId), { scope: { in: ['NETWORK', 'SITE'] } }, activeNowWhere(now)] },
    orderBy: { startsAt: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, percent: r.percent, label: r.label, endsAt: r.endsAt }));
}

// The price change in effect at each moment of one session, at one connector. Returns a
// function date -> { free, percent, rule }, for computeCharge. Loads the rules once per session.
export async function priceAdjusterForSession({ tenantId, stationId, zoneId, connectorId, startedAt, stoppedAt }) {
  const connector = await rawPrisma.connector.findFirst({
    where: { stationId, connectorId },
    select: { powerType: true },
  });
  const ctx = {
    tenantId,
    stationId,
    zoneId: zoneId ?? null,
    powerClass: powerClassOf(connector?.powerType),
  };
  const rules = await rawPrisma.priceRule.findMany({
    where: {
      AND: [
        ownOrNetworkWhere(tenantId),
        { startsAt: { lt: stoppedAt } },
        { OR: [{ endsAt: null }, { endsAt: { gt: startedAt } }] },
      ],
    },
  });
  // Payment outages in complimentary mode are free charging for the time they last.
  const all = [...rules, ...(await complimentaryOutagesDuring(tenantId, startedAt, stoppedAt))];
  if (all.length === 0) return () => NO_ADJUSTMENT;
  return (at) => adjustmentAt(all, at, ctx);
}
