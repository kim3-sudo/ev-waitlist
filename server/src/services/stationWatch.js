import { rawPrisma, prisma } from '../db.js';
import { runWithTenant } from '../tenancy/context.js';
import { ensureSiteLoaded } from './runtimeConfig.js';
import { registry } from './stationRegistry.js';
import { recordStationEvent } from './stationEvents.js';
import { notifyAdmins } from './adminAlerts.js';
import { createChargeForTransaction } from './payments/chargeService.js';

// Watches every charge point in each site, once a minute:
//   - a charge point that has been disconnected for a while, or that is connected but
//     has sent nothing for twice its heartbeat interval, triggers an offline alert to the
//     admins who chose it, and a back-online note when it recovers;
//   - a session still open on a charge point that has been gone for a long time is closed
//     (reason Stale), so it can be billed for the energy the readings show.

const WATCH_INTERVAL_MS = 60_000;
export const HEARTBEAT_SECONDS = 300; // the interval the charge point is told to use (see centralSystem.js)
export const SILENT_AFTER_MS = 2 * HEARTBEAT_SECONDS * 1000;
export const OFFLINE_GRACE_MS = 2 * 60_000;
export const STALE_AFTER_MS = 2 * 60 * 60_000;

export async function watchStations(now = Date.now()) {
  const stations = await prisma.station.findMany({ include: { connectors: { where: { connectorId: { gt: 0 } } } } });
  for (const station of stations) {
    const connected = registry.isConnected(station.identity);
    const silent = connected && station.lastSeenAt && now - station.lastSeenAt.getTime() > SILENT_AFTER_MS;

    if (!connected) {
      if (!station.offlineSince) {
        await prisma.station.update({ where: { id: station.id }, data: { offlineSince: new Date(now) } });
        station.offlineSince = new Date(now);
      }
      const gone = now - station.offlineSince.getTime();
      if (!station.offlineAlertSent && gone > OFFLINE_GRACE_MS) {
        await alertOffline(station, `has been disconnected since ${station.offlineSince.toLocaleString()}.`);
      }
      continue;
    }

    if (station.offlineSince) {
      await prisma.station.update({ where: { id: station.id }, data: { offlineSince: null } });
    }
    if (silent && !station.offlineAlertSent) {
      await alertOffline(station, `is connected but has sent nothing since ${new Date(station.lastSeenAt).toLocaleString()}.`);
    } else if (!silent && station.offlineAlertSent) {
      await prisma.station.update({ where: { id: station.id }, data: { offlineAlertSent: false } });
      await recordStationEvent(station.id, 'ONLINE', 'The charge point is back online.');
      await notifyAdmins('OFFLINE', `${station.name} is back online`, `${station.name} (${station.identity}) is back online.`);
    }
  }
}

async function alertOffline(station, reason) {
  await prisma.station.update({ where: { id: station.id }, data: { offlineAlertSent: true } });
  await recordStationEvent(station.id, 'OFFLINE', `Went silent: ${reason}`);
  await notifyAdmins('OFFLINE', `${station.name} has gone silent`, `${station.name} (${station.identity}) ${reason}`);
}

// Closes sessions that a disconnected charge point left open for longer than STALE_AFTER_MS.
export async function closeStaleSessions(now = Date.now()) {
  const open = await prisma.transaction.findMany({
    where: { stoppedAt: null },
    include: { station: true },
  });
  for (const tx of open) {
    if (registry.isConnected(tx.station.identity)) continue;
    const readings = await prisma.meterSample.findFirst({
      where: { stationId: tx.stationId, ocppTransactionId: tx.ocppTransactionId },
      orderBy: { at: 'desc' },
    });
    const lastActivity = readings ? readings.at.getTime() : tx.startedAt.getTime();
    if (now - lastActivity < STALE_AFTER_MS) continue;

    const lastEnergy = await prisma.meterSample.findFirst({
      where: { stationId: tx.stationId, ocppTransactionId: tx.ocppTransactionId, measurand: 'Energy.Active.Import.Register' },
      orderBy: { at: 'desc' },
    });
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        stoppedAt: new Date(now),
        stopReason: 'Stale',
        meterStop: lastEnergy ? Math.round(lastEnergy.value) : null,
      },
    });
    await recordStationEvent(
      tx.stationId,
      'SESSION',
      `Closed transaction ${tx.ocppTransactionId}: the charge point has been disconnected since before its last reading.`,
      { connectorId: tx.connectorId },
    );
    await createChargeForTransaction(tx.stationId, tx.ocppTransactionId).catch((err) =>
      console.error(`Billing failed for stale transaction ${tx.ocppTransactionId}:`, err),
    );
  }
}

// Runs both checks for every site, one site at a time.
export async function watchAllTenants() {
  const tenants = await rawPrisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    await ensureSiteLoaded(tenant.id);
    await runWithTenant(tenant.id, async () => {
      await watchStations();
      await closeStaleSessions();
    }).catch((err) => console.error(`Station watch failed for site ${tenant.id}:`, err));
  }
}

export function startStationWatch() {
  return setInterval(() => {
    watchAllTenants().catch((err) => console.error('Station watch failed:', err));
  }, WATCH_INTERVAL_MS);
}

