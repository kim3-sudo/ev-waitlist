import { prisma } from '../db.js';
import { generateIdTag } from '../utils/idTag.js';

// Joins either a single station's waitlist ({ stationId }) or a zone's
// shared waitlist ({ zoneId }) -- exactly one should be passed.
export async function joinQueue({ stationId, zoneId }, { name, contact, licensePlate, parkingPermit }) {
  const scope = zoneId ? { zoneId } : { stationId };
  return prisma.$transaction(async (tx) => {
    const agg = await tx.queueEntry.aggregate({
      where: scope,
      _max: { position: true },
    });
    const position = (agg._max.position ?? 0) + 1;

    return tx.queueEntry.create({
      data: {
        stationId: stationId ?? null,
        zoneId: zoneId ?? null,
        name,
        contact,
        licensePlate: licensePlate || null,
        parkingPermit: parkingPermit || null,
        position,
        idTag: generateIdTag(),
      },
    });
  });
}

export async function getQueueStatus(entryId) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: entryId },
    include: { reservation: { include: { station: true } }, station: true, zone: true },
  });
  if (!entry) return null;

  let position = null;
  if (entry.status === 'WAITING') {
    const scope = entry.zoneId ? { zoneId: entry.zoneId } : { stationId: entry.stationId };
    position =
      (await prisma.queueEntry.count({
        where: { ...scope, status: 'WAITING', position: { lt: entry.position } },
      })) + 1;
  }

  return { entry, position };
}

// Looks up the front of either a single station's line ({ stationId }) or a
// zone's shared line ({ zoneId }).
export function nextWaitingEntry({ stationId, zoneId }) {
  return prisma.queueEntry.findFirst({
    where: zoneId ? { zoneId, status: 'WAITING' } : { stationId, status: 'WAITING' },
    orderBy: { position: 'asc' },
  });
}

export function listQueueForStation(stationId) {
  return prisma.queueEntry.findMany({
    where: { stationId, status: { in: ['WAITING', 'NOTIFIED'] } },
    orderBy: { position: 'asc' },
    include: { reservation: true },
  });
}

// True only for the driver currently holding an active reservation at this
// station under this idTag -- i.e. it's genuinely their turn. Used to reject
// StartTransaction/Authorize from anyone else trying to cut the line.
export async function isIdTagAuthorizedAt(stationId, idTag) {
  const entry = await prisma.queueEntry.findFirst({
    where: { stationId, idTag, status: 'NOTIFIED', reservation: { status: 'ACTIVE' } },
  });
  return Boolean(entry);
}
