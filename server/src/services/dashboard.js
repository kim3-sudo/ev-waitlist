import { prisma } from '../db.js';
import { registry } from './stationRegistry.js';
import { usageReport } from './usageReport.js';
import { getPaymentSettings } from './payments/paymentSettingsService.js';

// The admin dashboard: connector status, station connectivity and uptime, utilization
// and idle time, and money (when pricing is configured). Read-only; computed on request.

const DAY_MS = 24 * 60 * 60 * 1000;
const round1 = (value) => Math.round(value * 10) / 10;

// OCPP connector statuses grouped for the dashboard. Anything not listed counts as
// maintenance, so every connector lands in exactly one bucket.
const IN_USE = new Set(['Preparing', 'Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing']);

// Counts each physical connector (OCPP connectorId >= 1) once, by its current state.
// A connector on a station that is not connected is offline, whatever its last status.
export function connectorCounts(stations, isConnected) {
  const counts = { total: 0, available: 0, inUse: 0, reserved: 0, error: 0, maintenance: 0, offline: 0 };
  for (const station of stations) {
    const online = isConnected(station.identity);
    for (const connector of station.connectors) {
      if (connector.connectorId < 1) continue;
      counts.total += 1;
      if (!online) counts.offline += 1;
      else if (connector.operative === false || connector.status === 'Unavailable') counts.maintenance += 1;
      else if (connector.status === 'Faulted') counts.error += 1;
      else if (connector.status === 'Available') counts.available += 1;
      else if (connector.status === 'Reserved') counts.reserved += 1;
      else if (IN_USE.has(connector.status)) counts.inUse += 1;
      else counts.maintenance += 1;
    }
  }
  return counts;
}

// Time a station spent offline within [from, to], from its OFFLINE and ONLINE events.
// startOffline says whether it was already offline at `from`. Events are sorted by time
// and lie inside the window. A station still offline at `to` counts up to `to`.
export function offlineMs(events, startOffline, from, to) {
  let total = 0;
  let since = startOffline ? from : null;
  for (const event of events) {
    const at = Math.min(Math.max(event.at, from), to);
    if (event.kind === 'OFFLINE' && since === null) since = at;
    else if (event.kind === 'ONLINE' && since !== null) {
      total += at - since;
      since = null;
    }
  }
  if (since !== null) total += to - since;
  return Math.max(0, total);
}

// Uptime per station over the window. A station is counted only from the time it
// existed, so a new station is not penalized for days before it was added.
export function uptimeRows(stations, eventsByStation, startStateByStation, from, to) {
  return stations.map((station) => {
    const start = Math.max(from, station.createdAt.getTime());
    const windowMs = Math.max(0, to - start);
    const down = offlineMs(
      eventsByStation.get(station.id) ?? [],
      startStateByStation.get(station.id) === 'OFFLINE',
      start,
      to,
    );
    const uptimePercent = windowMs > 0 ? round1(((windowMs - down) / windowMs) * 100) : null;
    return {
      stationId: station.id,
      stationName: station.name,
      uptimePercent,
      downtimeMinutes: Math.round(down / 60_000),
    };
  });
}

// Groups charges into a per-day revenue series (local calendar days), oldest first.
export function dailyRevenue(charges) {
  const pad = (n) => String(n).padStart(2, '0');
  const byDay = new Map();
  for (const c of charges) {
    const d = c.paidAt;
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    byDay.set(day, (byDay.get(day) ?? 0) + c.amountCents + c.holdCapturedCents);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, revenueCents]) => ({ day, revenueCents }));
}

// Pricing counts as configured when a rate is set for the chosen pricing model.
export function pricingConfigured(settings) {
  if (settings.pricingModel === 'FREE') return false;
  const hasSchedule = Boolean(settings.rateSchedule && settings.rateSchedule !== '[]');
  return settings.ratePerMinuteCents > 0 || settings.ratePerKwhCents > 0 || hasSchedule;
}

async function eventState(from, now) {
  const kinds = ['OFFLINE', 'ONLINE'];
  const events = await prisma.stationEvent.findMany({
    where: { kind: { in: kinds }, at: { gte: new Date(from), lt: new Date(now) } },
    select: { stationId: true, kind: true, at: true },
    orderBy: { at: 'asc' },
  });
  const before = await prisma.stationEvent.findMany({
    where: { kind: { in: kinds }, at: { lt: new Date(from) } },
    select: { stationId: true, kind: true },
    orderBy: { at: 'desc' },
    distinct: ['stationId'],
  });
  const eventsByStation = new Map();
  for (const e of events) {
    if (!eventsByStation.has(e.stationId)) eventsByStation.set(e.stationId, []);
    eventsByStation.get(e.stationId).push({ kind: e.kind, at: e.at.getTime() });
  }
  const startStateByStation = new Map(before.map((e) => [e.stationId, e.kind]));
  return { eventsByStation, startStateByStation };
}

// Builds the dashboard for the last `days` days. `permissions` decides whether money is
// included (it needs payments.view).
export async function buildDashboard({ days, permissions, now = Date.now() }) {
  const from = now - days * DAY_MS;
  const stations = await prisma.station.findMany({
    include: { connectors: true },
    orderBy: { name: 'asc' },
  });

  const { eventsByStation, startStateByStation } = await eventState(from, now);
  const uptime = uptimeRows(stations, eventsByStation, startStateByStation, from, now);
  const usage = await usageReport(days, now);

  const connectorStats = connectorCounts(stations, (identity) => registry.isConnected(identity));

  const connectivity = stations.map((s) => ({
    stationId: s.id,
    stationName: s.name,
    identity: s.identity,
    online: registry.isConnected(s.identity),
    lastSeenAt: s.lastSeenAt ?? null,
    offlineSince: s.offlineSince ?? null,
  }));

  const uptimeValues = uptime.filter((u) => u.uptimePercent != null);
  const overallUptime = uptimeValues.length
    ? round1(uptimeValues.reduce((sum, u) => sum + u.uptimePercent, 0) / uptimeValues.length)
    : null;

  const connectorHours = usage.rows.reduce((sum, r) => sum + r.chargingHours + r.waitingHours + r.freeHours, 0);
  const sum = (key) => usage.rows.reduce((total, r) => total + r[key], 0);
  const share = (hours) => (connectorHours > 0 ? round1((hours / connectorHours) * 100) : null);
  const utilization = {
    chargingPercent: share(sum('chargingHours')),
    waitingPercent: share(sum('waitingHours')),
    freePercent: share(sum('freeHours')),
    stations: usage.rows.map((r) => ({
      stationId: r.stationId,
      stationName: r.stationName,
      connectors: r.connectors,
      sessions: r.sessions,
      chargingPercent: r.chargingPercent,
      waitingPercent: r.waitingPercent,
      freePercent: r.freePercent,
    })),
  };

  const result = {
    days,
    generatedAt: new Date(now).toISOString(),
    connectors: connectorStats,
    connectivity: {
      total: stations.length,
      online: connectivity.filter((c) => c.online).length,
      offline: connectivity.filter((c) => !c.online).length,
      stations: connectivity,
    },
    uptime: { overallPercent: overallUptime, stations: uptime },
    utilization,
  };

  if (permissions.includes('payments.view')) {
    result.money = await moneySummary(from, now);
  }
  return result;
}

async function moneySummary(from, now) {
  const settings = await getPaymentSettings();
  if (!pricingConfigured(settings)) return { configured: false, currency: settings.currency };

  const paid = await prisma.charge.findMany({
    where: { status: 'PAID', paidAt: { gte: new Date(from), lt: new Date(now) } },
    select: { amountCents: true, holdCapturedCents: true, paidAt: true },
  });
  const revenueCents = paid.reduce((sum, c) => sum + c.amountCents + c.holdCapturedCents, 0);
  const [outstanding, needsReview] = await Promise.all([
    prisma.charge.aggregate({ where: { status: 'PENDING' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.charge.count({ where: { status: 'NEEDS_REVIEW' } }),
  ]);

  return {
    configured: true,
    currency: settings.currency,
    pricingModel: settings.pricingModel,
    revenueCents,
    paidCount: paid.length,
    averageChargeCents: paid.length ? Math.round(revenueCents / paid.length) : null,
    outstandingCents: outstanding._sum.amountCents ?? 0,
    pendingCount: outstanding._count._all,
    needsReviewCount: needsReview,
    daily: dailyRevenue(paid),
  };
}
