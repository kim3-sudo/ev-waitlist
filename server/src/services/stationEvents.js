import { prisma } from '../db.js';

// The station's history: boots, faults, firmware and diagnostics steps, commands an
// admin sent, sessions the software closed, and offline or back-online changes.

export async function recordStationEvent(stationId, kind, detail, { connectorId = null, actorId = null } = {}) {
  return prisma.stationEvent.create({
    data: { stationId, kind, detail: String(detail), connectorId, actorId },
  });
}

// Records that a message arrived from the charge point, at most once a minute, so a busy
// station doesn't write to the database for every message.
const SEEN_WRITE_MS = 60_000;
const lastSeenWritten = new Map();

export async function noteSeen(stationId, now = Date.now()) {
  if (now - (lastSeenWritten.get(stationId) ?? 0) < SEEN_WRITE_MS) return;
  lastSeenWritten.set(stationId, now);
  await prisma.station.update({ where: { id: stationId }, data: { lastSeenAt: new Date(now) } });
}

// Forgets the throttle for a station (used by tests).
export function resetSeenThrottle() {
  lastSeenWritten.clear();
}
