import { Router } from 'express';
import { prisma } from '../db.js';

// Aggregate reports for the Reports page. Line-cutting complaints themselves
// are handled by admin.complaints.routes.js.
export const adminReportsRouter = Router();

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Connectors left occupied after charging finished. Ongoing events are
// measured up to now. `flagged` marks those at or over minMinutes.
// Query: days (lookback, default 7, max 90), minMinutes (default 10).
adminReportsRouter.get('/idle', async (req, res) => {
  const days = clamp(Number(req.query.days ?? 7), 1, 90);
  const minMinutes = clamp(Number(req.query.minMinutes ?? 10), 0, 1440);
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);

  const events = await prisma.idleEvent.findMany({
    where: { startedAt: { gte: since } },
    include: { station: { select: { id: true, name: true } } },
    orderBy: { startedAt: 'desc' },
  });

  const rows = events.map((event) => {
    const durationMinutes = ((event.endedAt ?? now) - event.startedAt.getTime()) / 60_000;
    return {
      id: event.id,
      station: event.station,
      connectorId: event.connectorId,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      ongoing: event.endedAt === null,
      durationMinutes: Math.round(durationMinutes * 10) / 10,
      flagged: durationMinutes >= minMinutes,
    };
  });

  res.json({
    minMinutes,
    days,
    flaggedCount: rows.filter((r) => r.flagged).length,
    ongoingCount: rows.filter((r) => r.ongoing).length,
    rows,
  });
});

// Line-cutting complaints by station over a lookback window: counts per
// status, how long resolutions take, and how long the oldest open one has waited.
// Query: days (lookback, default 30, max 365).
adminReportsRouter.get('/complaints-summary', async (req, res) => {
  const days = clamp(Number(req.query.days ?? 30), 1, 365);
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);

  const complaints = await prisma.lineCuttingComplaint.findMany({
    where: { createdAt: { gte: since } },
    include: { station: { select: { id: true, name: true } } },
  });

  const byStation = new Map();
  for (const c of complaints) {
    if (!byStation.has(c.stationId)) {
      byStation.set(c.stationId, {
        station: c.station,
        total: 0,
        open: 0,
        resolved: 0,
        dismissed: 0,
        resolveHours: [],
        oldestOpenAt: null,
        lastComplaintAt: null,
      });
    }
    const row = byStation.get(c.stationId);
    row.total += 1;
    if (c.status === 'OPEN') {
      row.open += 1;
      if (!row.oldestOpenAt || c.createdAt < row.oldestOpenAt) row.oldestOpenAt = c.createdAt;
    } else if (c.status === 'RESOLVED') {
      row.resolved += 1;
    } else if (c.status === 'DISMISSED') {
      row.dismissed += 1;
    }
    if (c.resolvedAt) {
      row.resolveHours.push((c.resolvedAt - c.createdAt) / 3_600_000);
    }
    if (!row.lastComplaintAt || c.createdAt > row.lastComplaintAt) row.lastComplaintAt = c.createdAt;
  }

  const average = (values) =>
    values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

  const rows = [...byStation.values()]
    .map(({ resolveHours, ...row }) => ({
      ...row,
      averageHoursToResolve: average(resolveHours),
      oldestOpenHours: row.oldestOpenAt ? Math.round(((now - row.oldestOpenAt) / 3_600_000) * 10) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total);

  const allResolveHours = complaints.filter((c) => c.resolvedAt).map((c) => (c.resolvedAt - c.createdAt) / 3_600_000);

  res.json({
    days,
    totals: {
      total: complaints.length,
      open: complaints.filter((c) => c.status === 'OPEN').length,
      resolved: complaints.filter((c) => c.status === 'RESOLVED').length,
      dismissed: complaints.filter((c) => c.status === 'DISMISSED').length,
      averageHoursToResolve: average(allResolveHours),
    },
    rows,
  });
});
