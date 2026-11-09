import { prisma } from '../db.js';

// Connector time by station over a lookback window: charging, waiting (idle after
// charging) and free. Shared by the usage report and the admin dashboard.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const round1 = (value) => Math.round(value * 10) / 10;

// The part of [start, end] that lies inside [from, to], in milliseconds.
function overlapMs(start, end, from, to) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

// How each charge point's connector time was used over a lookback window:
// - charging: a car was plugged in and drawing power (a session was open);
// - waiting: charging had finished, but the car stayed plugged in (idle after charging);
// - free: the connector was available for the next driver.
// The three shares add up to 100 percent of the connector time in the window.
export async function usageReport(days, now = Date.now()) {
  const from = now - days * DAY_MS;
  const fromDate = new Date(from);
  const nowDate = new Date(now);

  const stations = await prisma.station.findMany({
    include: { connectors: true },
    orderBy: { name: 'asc' },
  });
  const sessions = await prisma.transaction.findMany({
    where: { startedAt: { lt: nowDate }, OR: [{ stoppedAt: null }, { stoppedAt: { gte: fromDate } }] },
    select: { stationId: true, startedAt: true, stoppedAt: true },
  });
  const idles = await prisma.idleEvent.findMany({
    where: { startedAt: { lt: nowDate }, OR: [{ endedAt: null }, { endedAt: { gte: fromDate } }] },
    select: { stationId: true, startedAt: true, endedAt: true },
  });

  const windowMs = now - from;
  const rows = stations.map((station) => {
    const connectors = station.connectors.filter((c) => c.connectorId > 0).length;
    const availableMs = connectors * windowMs;

    const stationSessions = sessions.filter((s) => s.stationId === station.id);
    let chargingMs = 0;
    for (const s of stationSessions) {
      chargingMs += overlapMs(s.startedAt.getTime(), s.stoppedAt?.getTime() ?? now, from, now);
    }
    let waitingMs = 0;
    for (const e of idles.filter((i) => i.stationId === station.id)) {
      waitingMs += overlapMs(e.startedAt.getTime(), e.endedAt?.getTime() ?? now, from, now);
    }
    // Waiting time cannot be more than the connector time left after charging.
    waitingMs = Math.min(waitingMs, Math.max(0, availableMs - chargingMs));
    const freeMs = Math.max(0, availableMs - chargingMs - waitingMs);

    const share = (ms) => (availableMs > 0 ? round1((ms / availableMs) * 100) : null);
    const finished = stationSessions.filter((s) => s.stoppedAt != null);
    const averageMinutes = finished.length
      ? round1(finished.reduce((sum, s) => sum + (s.stoppedAt - s.startedAt) / 60_000, 0) / finished.length)
      : null;

    return {
      stationId: station.id,
      stationName: station.name,
      connectors,
      sessions: stationSessions.length,
      averageSessionMinutes: averageMinutes,
      chargingHours: round1(chargingMs / HOUR_MS),
      waitingHours: round1(waitingMs / HOUR_MS),
      freeHours: round1(freeMs / HOUR_MS),
      chargingPercent: share(chargingMs),
      waitingPercent: share(waitingMs),
      freePercent: share(freeMs),
    };
  });

  return { days, windowHours: round1(windowMs / HOUR_MS), rows };
}
