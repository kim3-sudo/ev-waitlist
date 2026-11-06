import { Router } from 'express';
import { prisma } from '../db.js';

// Usage reports: energy dispensed, and how the connectors' time was used (charging,
// waiting for the car to be moved, or free). Mounted under /api/admin/reports, behind reports.view.
export const adminUsageRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const round1 = (value) => Math.round(value * 10) / 10;

// The part of [start, end] that lies inside [from, to], in milliseconds.
function overlapMs(start, end, from, to) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

// Energy in Wh from the meter readings, or null when the session has no usable reading.
function energyWh(tx) {
  if (tx.meterStart == null || tx.meterStop == null || tx.meterStop < tx.meterStart) return null;
  return tx.meterStop - tx.meterStart;
}

// Local calendar day, as YYYY-MM-DD, for grouping sessions by day.
function localDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Energy dispensed over a lookback window, per charge point and per day. Energy comes
// from the meter readings at the start and end of each session. Sessions without a
// usable reading are counted, but add no energy.
// Query: days (lookback, default 30, max 365).
adminUsageRouter.get('/energy', async (req, res) => {
  const days = clamp(Number(req.query.days ?? 30), 1, 365);
  const since = new Date(Date.now() - days * DAY_MS);

  const sessions = await prisma.transaction.findMany({
    where: { startedAt: { gte: since } },
    include: { station: { select: { id: true, name: true } } },
    orderBy: { startedAt: 'asc' },
  });

  const byStation = new Map();
  const byDay = new Map();
  const totals = { sessions: 0, energyWh: 0, withReading: 0, withoutReading: 0, inProgress: 0 };

  for (const tx of sessions) {
    const wh = energyWh(tx);
    const finished = tx.stoppedAt != null;
    totals.sessions += 1;
    if (!finished) totals.inProgress += 1;
    else if (wh == null) totals.withoutReading += 1;
    else totals.withReading += 1;
    if (wh != null) totals.energyWh += wh;

    if (!byStation.has(tx.stationId)) {
      byStation.set(tx.stationId, { station: tx.station, sessions: 0, withReading: 0, energyWh: 0 });
    }
    const station = byStation.get(tx.stationId);
    station.sessions += 1;
    if (wh != null) {
      station.withReading += 1;
      station.energyWh += wh;
    }

    const day = localDay(tx.startedAt);
    if (!byDay.has(day)) byDay.set(day, { day, sessions: 0, energyWh: 0 });
    const dayRow = byDay.get(day);
    dayRow.sessions += 1;
    dayRow.energyWh += wh ?? 0;
  }

  const kwh = (wh) => round1(wh / 1000);
  const stations = [...byStation.values()]
    .map((s) => ({
      stationId: s.station.id,
      stationName: s.station.name,
      sessions: s.sessions,
      sessionsWithReading: s.withReading,
      energyKwh: kwh(s.energyWh),
      averageKwhPerSession: s.withReading ? round1(s.energyWh / 1000 / s.withReading) : null,
    }))
    .sort((a, b) => b.energyKwh - a.energyKwh);

  res.json({
    days,
    totals: {
      sessions: totals.sessions,
      energyKwh: kwh(totals.energyWh),
      sessionsWithReading: totals.withReading,
      sessionsWithoutReading: totals.withoutReading,
      inProgress: totals.inProgress,
    },
    stations,
    daily: [...byDay.values()].map((d) => ({ day: d.day, sessions: d.sessions, energyKwh: kwh(d.energyWh) })),
  });
});

// How each charge point's connector time was used over a lookback window:
// - charging: a car was plugged in and drawing power (a session was open);
// - waiting: charging had finished, but the car stayed plugged in (idle after charging);
// - free: the connector was available for the next driver.
// The three shares add up to 100 percent of the connector time in the window.
// Query: days (lookback, default 7, max 90).
adminUsageRouter.get('/usage', async (req, res) => {
  const days = clamp(Number(req.query.days ?? 7), 1, 90);
  const now = Date.now();
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

  res.json({ days, windowHours: round1(windowMs / HOUR_MS), rows });
});
