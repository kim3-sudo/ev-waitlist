import { prisma } from '../db.js';

// Manual holds: a connector an admin holds for one ID tag, with no waitlist entry
// (Reservation rows with queueEntryId null). Only that ID tag may start on the connector
// while the hold is active.

// True when this ID tag holds an active manual hold at the station.
export async function isManualHoldAuthorized(stationId, idTag, now = new Date()) {
  const hold = await prisma.reservation.findFirst({
    where: { stationId, idTag, queueEntryId: null, status: 'ACTIVE', expiresAt: { gt: now } },
  });
  return Boolean(hold);
}

// Called when a session starts on a connector: the manual hold for that ID tag is used up.
export async function fulfillManualHold(stationId, connectorId, idTag) {
  await prisma.reservation.updateMany({
    where: { stationId, connectorId, idTag, queueEntryId: null, status: 'ACTIVE' },
    data: { status: 'FULFILLED' },
  });
}
