import { afterPosition, pageOf } from '../pagination.js';
// Alerts about charge points, shown to drivers and admins while they are active. An
// alert covers one scope:
//   NETWORK   every site in the installation (set by the installation administrator)
//   SITE      every charge point in this site
//   LOCATION  every charge point whose location text matches
//   STATION   one charge point
// Price changes are in payments/priceRuleService.js. Both use the same "active now"
// rule: started, and not yet ended.
import { rawPrisma, prisma } from '../db.js';
import { currentTenantId, ownOrNetworkWhere } from '../tenancy/context.js';
import { appliesTo, powerClassOf } from './payments/priceRules.js';

export const ALERT_SCOPES = ['NETWORK', 'SITE', 'LOCATION', 'STATION'];
export const ALERT_SEVERITIES = ['INFO', 'WARNING'];
export const ALERT_MESSAGE_MAX = 500;

// Rows whose time window includes `now`.
export function activeNowWhere(now) {
  return {
    AND: [{ startsAt: { lte: now } }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
}

// SCHEDULED (not started), ACTIVE, or ENDED.
export function scheduleStatus(row, now = new Date()) {
  if (row.endsAt && new Date(row.endsAt) <= now) return 'ENDED';
  if (new Date(row.startsAt) > now) return 'SCHEDULED';
  return 'ACTIVE';
}

// Whether the signed-in admin may change a row. Site rows: their own site. Network rows:
// only the installation administrator.
export function canEditRow(row, { tenantId, instanceAdmin }) {
  if (row.tenantId == null) return Boolean(instanceAdmin);
  return row.tenantId === tenantId;
}

// Reads a date from input. Empty means `fallback`. Returns { value } or { error }.
export function parseWhen(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return { value: fallback };
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return { error: 'Enter a valid date and time' };
  return { value };
}

// The charge points and locations an admin can pick from. Shared by the alert and price-change forms.
export async function chargePointTargets() {
  const [zones, stations] = await Promise.all([
    prisma.zone.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.station.findMany({
      select: { id: true, name: true, location: true, zoneId: true, connectors: { select: { powerType: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  const locations = [...new Set(stations.map((s) => s.location?.trim()).filter(Boolean))].sort();
  return {
    zones,
    locations,
    stations: stations.map((s) => ({
      id: s.id,
      name: s.name,
      location: s.location?.trim() || null,
      zoneId: s.zoneId,
      powerClasses: [...new Set(s.connectors.map((c) => powerClassOf(c.powerType)).filter(Boolean))],
    })),
  };
}

const ALERT_INCLUDE = { station: { select: { name: true } } };

function serializeAlert(alert, ctx) {
  const now = ctx.now;
  return {
    id: alert.id,
    scope: alert.scope,
    stationId: alert.stationId,
    stationName: alert.station?.name ?? null,
    location: alert.location,
    severity: alert.severity,
    message: alert.message,
    startsAt: alert.startsAt,
    endsAt: alert.endsAt,
    status: scheduleStatus(alert, now),
    network: alert.tenantId == null,
    canEdit: canEditRow(alert, ctx),
  };
}

// Every alert this site can see (its own, and network-wide ones), newest first.
export async function listAlerts({ instanceAdmin, limit, position }) {
  const tenantId = currentTenantId();
  const now = new Date();
  const rows = await rawPrisma.alert.findMany({
    where: { AND: [ownOrNetworkWhere(tenantId), afterPosition(position, 'startsAt', { date: true })] },
    include: ALERT_INCLUDE,
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (row) => ({ v: row.startsAt.toISOString(), i: row.id }));
  return { data: page.data.map((row) => serializeAlert(row, { tenantId, instanceAdmin, now })), nextCursor: page.nextCursor };
}

// Checks an alert's input, merged over the existing alert when editing. Returns
// { data } ready to save, or { error, status? }.
export async function normalizeAlert(input, existing, { instanceAdmin }) {
  const tenantId = currentTenantId();
  const now = new Date();

  const scope = input.scope ?? existing?.scope;
  if (!ALERT_SCOPES.includes(scope)) {
    return { error: 'Choose who the alert is for: the network, this site, a location, or a charge point' };
  }
  if (scope === 'NETWORK' && !instanceAdmin) {
    return { error: 'Only the installation administrator can post an alert for the whole network', status: 403 };
  }

  const severity = input.severity ?? existing?.severity ?? 'INFO';
  if (!ALERT_SEVERITIES.includes(severity)) return { error: 'severity must be information or warning' };

  const message = String(input.message ?? existing?.message ?? '').trim();
  if (!message) return { error: 'Write the message drivers will see' };
  if (message.length > ALERT_MESSAGE_MAX) return { error: `The message can be at most ${ALERT_MESSAGE_MAX} characters` };

  const start = parseWhen(input.startsAt !== undefined ? input.startsAt : existing?.startsAt, now);
  if (start.error) return { error: `Start: ${start.error.toLowerCase()}` };
  const end = parseWhen(input.endsAt !== undefined ? input.endsAt : existing?.endsAt, null);
  if (end.error) return { error: `End: ${end.error.toLowerCase()}` };
  if (end.value && end.value <= start.value) return { error: 'The end must be after the start' };
  if (!existing && end.value && end.value <= now) return { error: 'The end must be in the future' };

  let stationId = null;
  if (scope === 'STATION') {
    stationId = input.stationId ?? existing?.stationId ?? null;
    if (!stationId || !(await prisma.station.findFirst({ where: { id: stationId }, select: { id: true } }))) {
      return { error: 'Choose a charge point' };
    }
  }

  let location = null;
  if (scope === 'LOCATION') {
    location = String(input.location ?? existing?.location ?? '').trim();
    const { locations } = await chargePointTargets();
    if (!location || !locations.includes(location)) return { error: 'Choose a location that a charge point has' };
  }

  return {
    data: {
      scope,
      tenantId: scope === 'NETWORK' ? null : tenantId,
      stationId,
      location,
      severity,
      message,
      startsAt: start.value,
      endsAt: end.value,
    },
  };
}

export async function createAlert(input, { adminId, instanceAdmin }) {
  const normalized = await normalizeAlert(input, null, { instanceAdmin });
  if (normalized.error) return normalized;
  const alert = await rawPrisma.alert.create({
    data: { ...normalized.data, createdByAdminId: adminId },
    include: ALERT_INCLUDE,
  });
  return { alert: serializeAlert(alert, { tenantId: currentTenantId(), instanceAdmin, now: new Date() }) };
}

// Finds an alert this admin may see and change. Returns { row } or { error, status }.
async function findEditable(id, { instanceAdmin }) {
  const tenantId = currentTenantId();
  const row = await rawPrisma.alert.findFirst({ where: { AND: [{ id }, ownOrNetworkWhere(tenantId)] } });
  if (!row) return { error: 'Alert not found', status: 404 };
  if (!canEditRow(row, { tenantId, instanceAdmin })) {
    return { error: 'Only the installation administrator can change a network-wide alert', status: 403 };
  }
  return { row };
}

export async function updateAlert(id, input, { instanceAdmin }) {
  const found = await findEditable(id, { instanceAdmin });
  if (found.error) return found;
  const normalized = await normalizeAlert(input, found.row, { instanceAdmin });
  if (normalized.error) return normalized;
  const alert = await rawPrisma.alert.update({ where: { id }, data: normalized.data, include: ALERT_INCLUDE });
  return { alert: serializeAlert(alert, { tenantId: currentTenantId(), instanceAdmin, now: new Date() }) };
}

export async function deleteAlert(id, { instanceAdmin }) {
  const found = await findEditable(id, { instanceAdmin });
  if (found.error) return found;
  await rawPrisma.alert.delete({ where: { id } });
  return {};
}

// Alerts drivers see across the whole site (site-wide and network-wide), while active.
export async function siteAndNetworkAlerts(now = new Date()) {
  const tenantId = currentTenantId();
  const rows = await rawPrisma.alert.findMany({
    where: {
      AND: [ownOrNetworkWhere(tenantId), { scope: { in: ['NETWORK', 'SITE'] } }, activeNowWhere(now)],
    },
    orderBy: { startsAt: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, scope: r.scope, severity: r.severity, message: r.message, endsAt: r.endsAt }));
}

// Per charge point, the alerts and price changes in effect now, for the driver pages.
// Station, location, zone and connector-type notices are included; site and network
// ones are shown once for the whole site (see siteAndNetworkAlerts).
// Returns a Map: station id -> { alerts, pricing }. `stations` need `connectors` and `zoneId`.
export async function stationNotices(stations, now = new Date()) {
  const tenantId = currentTenantId();
  const [alerts, rules] = await Promise.all([
    rawPrisma.alert.findMany({
      where: { AND: [{ tenantId }, { scope: { in: ['STATION', 'LOCATION'] } }, activeNowWhere(now)] },
    }),
    rawPrisma.priceRule.findMany({
      where: { AND: [{ tenantId }, { scope: { in: ['STATION', 'ZONE', 'POWER_TYPE'] } }, activeNowWhere(now)] },
    }),
  ]);

  const notices = new Map();
  for (const station of stations) {
    const location = station.location?.trim() ?? '';
    const stationAlerts = alerts
      .filter((a) => (a.scope === 'STATION' ? a.stationId === station.id : location !== '' && a.location === location))
      .map((a) => ({ id: a.id, severity: a.severity, message: a.message, endsAt: a.endsAt }));

    const classes = [...new Set(station.connectors.map((c) => powerClassOf(c.powerType)).filter(Boolean))];
    const contexts = [null, ...classes].map((powerClass) => ({
      tenantId,
      stationId: station.id,
      zoneId: station.zoneId ?? null,
      powerClass,
    }));
    const pricing = rules
      .filter((rule) => contexts.some((ctx) => appliesTo(rule, ctx)))
      .map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        percent: rule.percent,
        label: rule.label,
        endsAt: rule.endsAt,
      }));

    notices.set(station.id, { alerts: stationAlerts, pricing });
  }
  return notices;
}
