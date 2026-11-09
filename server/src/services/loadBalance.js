import { rawPrisma } from '../db.js';
import { runWithTenant } from '../tenancy/context.js';
import { registry } from './stationRegistry.js';
import { callStation, logCommand } from './stationCommands.js';

// Load balancing: the site's supply (siteCapacityKw) is shared between the connectors that are charging
// right now. An idle connector is left at its own maximum, so the next car starts at full power.
//
// Each connector gets an equal share of the supply, rounded down to whole amps and capped at the
// connector's maximum. A connector never goes below 6 A (the usual minimum for a charging session). When
// the supply cannot cover that minimum for every active connector, the result is flagged as over capacity.
//
// Limits are sent as a TxDefaultProfile with stack level 1, which wins over a manual limit (stack level 0),
// so an admin's manual limit does not undo the balance while it is on.

export const MIN_AMPS = 6;
export const DEFAULT_MAX_AMPS = 32;
export const DEFAULT_VOLTAGE = 230;
export const BALANCE_STACK_LEVEL = 1;
export const balanceProfileId = (connectorId) => 200 + connectorId;

// The limit for each connector, from the supply and which connectors are charging.
// Input: { capacityKw, connectors: [{ key, active, maxAmps, voltage }] }.
export function planLimits({ capacityKw, connectors }) {
  const budgetW = capacityKw * 1000;
  const active = connectors.filter((c) => c.active);
  const sharePerActiveW = active.length ? budgetW / active.length : 0;
  let overCapacity = false;
  const limits = connectors.map((c) => {
    const max = c.maxAmps ?? DEFAULT_MAX_AMPS;
    const voltage = c.voltage ?? DEFAULT_VOLTAGE;
    if (!c.active) return { key: c.key, limitAmps: max, active: false };
    const fair = Math.floor(sharePerActiveW / voltage);
    const limit = Math.max(MIN_AMPS, Math.min(max, fair));
    if (fair < MIN_AMPS) overCapacity = true;
    return { key: c.key, limitAmps: limit, active: true };
  });
  return { limits, overCapacity, activeCount: active.length };
}

// The last limit sent to each connector, so an unchanged limit is not sent again.
const lastSent = new Map();

export function forgetLimits(tenantId) {
  for (const key of [...lastSent.keys()]) {
    if (key.startsWith(`${tenantId}|`)) lastSent.delete(key);
  }
}

// Works out and sends the limits for one site. Charge points that are offline are skipped, and are
// brought up to date when they reconnect (the next balance run covers them). Returns a summary.
export async function rebalanceSite(tenantId) {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || !tenant.loadBalancingEnabled || !(tenant.siteCapacityKw > 0)) {
    return { skipped: 'Load balancing is turned off, or the site supply is not set.' };
  }
  const stations = await rawPrisma.station.findMany({
    where: { tenantId, smartChargingEnabled: true },
    include: { connectors: true },
    orderBy: [{ id: 'asc' }],
  });
  if (stations.length === 0) return { skipped: 'No charge point has smart charging on.' };

  const open = await rawPrisma.transaction.findMany({ where: { tenantId, stoppedAt: null }, select: { stationId: true, connectorId: true } });
  const charging = new Set(open.map((t) => `${t.stationId}|${t.connectorId}`));

  const connectors = [];
  for (const s of stations) {
    for (const c of s.connectors) {
      if (c.connectorId <= 0) continue;
      connectors.push({
        key: `${s.id}|${c.connectorId}`,
        active: charging.has(`${s.id}|${c.connectorId}`),
        maxAmps: c.maxAmperage ?? null,
        voltage: c.maxVoltage ?? null,
      });
    }
  }
  const plan = planLimits({ capacityKw: tenant.siteCapacityKw, connectors });
  const byKey = new Map(plan.limits.map((l) => [l.key, l]));

  let sent = 0;
  let skippedOffline = 0;
  await runWithTenant(tenantId, async () => {
    for (const s of stations) {
      if (!registry.isConnected(s.identity)) {
        skippedOffline += s.connectors.filter((c) => c.connectorId > 0).length;
        continue;
      }
      for (const c of s.connectors) {
        if (c.connectorId <= 0) continue;
        const key = `${s.id}|${c.connectorId}`;
        const limit = byKey.get(key).limitAmps;
        const cacheKey = `${tenantId}|${key}`;
        if (lastSent.get(cacheKey) === limit) continue;
        const outcome = await callStation(s, 'SetChargingProfile', {
          connectorId: c.connectorId,
          csChargingProfiles: {
            chargingProfileId: balanceProfileId(c.connectorId),
            stackLevel: BALANCE_STACK_LEVEL,
            chargingProfilePurpose: 'TxDefaultProfile',
            chargingProfileKind: 'Absolute',
            chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit }] },
          },
        });
        if (outcome.ok && outcome.result?.status === 'Accepted') {
          lastSent.set(cacheKey, limit);
          sent += 1;
        } else {
          // Try again on the next run rather than remembering a limit the charge point refused.
          lastSent.delete(cacheKey);
        }
      }
      if (sent > 0) {
        await logCommand(s, null, 'Load balancing set the connector limits for the site supply.').catch(() => {});
      }
    }
  });
  return { sent, skippedOffline, overCapacity: plan.overCapacity, activeConnectors: plan.activeCount };
}

// Runs a balance without waiting for the caller. Errors go to the log, never to the message that triggered it.
export function rebalanceLater(tenantId) {
  setTimeout(() => {
    rebalanceSite(tenantId).catch((err) => console.error('[load-balance] failed:', err.message));
  }, 300);
}
