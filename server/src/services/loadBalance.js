import { rawPrisma } from '../db.js';
import { runWithTenant } from '../tenancy/context.js';
import { registry } from './stationRegistry.js';
import { callStation, logCommand } from './stationCommands.js';
import {
  MIN_AMPS,
  activeScheduleAt,
  connectorPhases,
  manualLimitCeilingWarning,
  parseStoredConfig,
  phaseCapacityAt,
  planPhaseLimits,
} from './smartCharging.js';

// Load balancing has two modes. They are chosen per site:
//
// 1. Phase-aware (when the site has a phase capacity set, see services/smartCharging.js). Each phase
//    of the supply has its own limit in amps, changed by dynamic events. Each connector draws on the
//    phases it is wired to, and the limits keep every phase within its capacity. Three-phase
//    connectors count on all phases.
// 2. Total kW (the original mode, siteCapacityKw). The supply is shared equally between the connectors
//    that are charging, with no phase model.
//
// In both modes an idle connector is left at its own maximum, so the next car starts at full power,
// and a connector never goes below 6 A. Time-of-day schedules cap the connectors they cover in either
// mode, and apply even when load balancing is off.
//
// Limits are sent as a TxDefaultProfile with stack level 1, which wins over a manual limit (stack
// level 0), so an admin's manual limit does not undo the balance while it is on.

export { MIN_AMPS };
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
export async function rebalanceSite(tenantId, now = new Date()) {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { skipped: 'Load balancing is turned off, or the site supply is not set.' };
  const config = parseStoredConfig(tenant.smartChargingConfig);
  // Both supply modes need load balancing on. Schedules work without it.
  const balancing = Boolean(tenant.loadBalancingEnabled);
  const phaseMode = balancing && config.phaseCapacityA != null;
  const kwMode = !phaseMode && balancing && tenant.siteCapacityKw > 0;
  const schedulesOnly = !phaseMode && !kwMode && config.schedules.length > 0;
  if (!phaseMode && !kwMode && !schedulesOnly) {
    // Nothing applies any more, so the balance profiles sent earlier must go, or they would hold
    // connectors below their manual limits.
    await clearStaleBalances(tenantId);
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

  // The ceiling for each connector is the lowest of its own maximum, its manual limit and the
  // schedule in force now. Schedules and manual limits can only lower the balance, never raise it.
  const connectors = [];
  const ceilingNotes = new Map();
  for (const s of stations) {
    const schedule = activeScheduleAt(config, s.id, now);
    for (const c of s.connectors) {
      if (c.connectorId <= 0) continue;
      const key = `${s.id}|${c.connectorId}`;
      const warning = manualLimitCeilingWarning({ manualAmps: c.manualLimitAmps, schedule });
      if (warning) ceilingNotes.set(key, warning);
      const ceilings = [c.maxAmperage ?? DEFAULT_MAX_AMPS, c.manualLimitAmps, schedule?.limitAmps].filter((v) => v != null);
      connectors.push({
        key,
        active: charging.has(key),
        maxAmps: Math.min(...ceilings),
        voltage: c.maxVoltage ?? null,
        phaseCount: c.phaseCount ?? null,
        phase: c.phase ?? null,
      });
    }
  }

  let plan;
  let mode;
  if (phaseMode) {
    mode = 'phase';
    plan = planPhaseLimits({
      capacityA: phaseCapacityAt(config, now),
      connectors: connectors.map((c) => ({ ...c, phases: connectorPhases(c) })),
    });
  } else if (kwMode) {
    mode = 'kw';
    plan = planLimits({ capacityKw: tenant.siteCapacityKw, connectors });
  } else {
    // Schedules only: no supply limit, so each connector takes its cap.
    mode = 'schedule';
    plan = planPhaseLimits({
      capacityA: { L1: Infinity, L2: Infinity, L3: Infinity },
      connectors: connectors.map((c) => ({ ...c, phases: connectorPhases(c) })),
    });
  }
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
          if (ceilingNotes.has(key)) {
            await logCommand(s, null, ceilingNotes.get(key), { connectorId: c.connectorId }).catch(() => {});
          }
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
  const activeConnectors = connectors.filter((c) => c.active).length;
  return {
    mode,
    sent,
    skippedOffline,
    overCapacity: plan.overCapacity,
    activeConnectors,
    saturatedPhases: plan.saturatedPhases ?? [],
  };
}

// Removes the balance profiles this server sent to a site's connectors. A connector that is offline
// keeps its entry, so the removal is tried again on the next run.
async function clearStaleBalances(tenantId) {
  const keys = [...lastSent.keys()].filter((k) => k.startsWith(`${tenantId}|`));
  if (keys.length === 0) return;
  await runWithTenant(tenantId, async () => {
    for (const cacheKey of keys) {
      const [, stationId, connectorIdText] = cacheKey.split('|');
      const connectorId = Number(connectorIdText);
      const station = await rawPrisma.station.findUnique({ where: { id: stationId } });
      if (!station || !registry.isConnected(station.identity)) continue;
      const outcome = await callStation(station, 'ClearChargingProfile', {
        id: balanceProfileId(connectorId),
        connectorId,
        chargingProfilePurpose: 'TxDefaultProfile',
        stackLevel: BALANCE_STACK_LEVEL,
      });
      if (outcome.ok) lastSent.delete(cacheKey);
    }
  });
}

// The warning for a manual limit that is above the schedule now in force on its connector, or null.
export async function ceilingWarningFor(tenantId, stationId, manualAmps, now = new Date()) {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId } });
  const config = parseStoredConfig(tenant?.smartChargingConfig);
  return manualLimitCeilingWarning({ manualAmps, schedule: activeScheduleAt(config, stationId, now) });
}

// Every connector whose manual limit is currently held down by a schedule. Shown to the admin.
export async function ceilingWarnings(tenantId, now = new Date()) {
  const tenant = await rawPrisma.tenant.findUnique({ where: { id: tenantId } });
  const config = parseStoredConfig(tenant?.smartChargingConfig);
  if (config.schedules.length === 0) return [];
  const stations = await rawPrisma.station.findMany({
    where: { tenantId, smartChargingEnabled: true },
    include: { connectors: true },
    orderBy: [{ id: 'asc' }],
  });
  const out = [];
  for (const s of stations) {
    const schedule = activeScheduleAt(config, s.id, now);
    for (const c of s.connectors) {
      const message = manualLimitCeilingWarning({ manualAmps: c.manualLimitAmps, schedule });
      if (message) {
        out.push({ stationId: s.id, station: s.name, connectorId: c.connectorId, manualAmps: c.manualLimitAmps, scheduleName: schedule.name, scheduleAmps: schedule.limitAmps, message });
      }
    }
  }
  return out;
}

// Runs the balance for every site that has load balancing on or a schedule set. Called by the
// minute ticker, so time-of-day schedules and events take effect when they start and end.
export async function rebalanceAllSites(now = new Date()) {
  const tenants = await rawPrisma.tenant.findMany({
    where: { OR: [{ loadBalancingEnabled: true }, { smartChargingConfig: { not: null } }] },
    select: { id: true },
  });
  const results = {};
  for (const t of tenants) {
    try {
      results[t.id] = await rebalanceSite(t.id, now);
    } catch (err) {
      console.error('[load-balance] site', t.id, 'failed:', err.message);
    }
  }
  return results;
}

// Runs a balance without waiting for the caller. Errors go to the log, never to the message that triggered it.
const pendingRebalances = new Set();
export function rebalanceLater(tenantId) {
  const timer = setTimeout(() => {
    pendingRebalances.delete(timer);
    rebalanceSite(tenantId).catch((err) => console.error('[load-balance] failed:', err.message));
  }, 300);
  pendingRebalances.add(timer);
}

// Cancels balances that were scheduled but have not run yet. Tests use this so a balance from one
// test cannot send a limit into the next test's charge point.
export function cancelPendingRebalances() {
  for (const timer of pendingRebalances) clearTimeout(timer);
  pendingRebalances.clear();
}
