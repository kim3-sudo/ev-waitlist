import { prisma } from '../db.js';
import { config } from '../config.js';
import { registry } from './stationRegistry.js';
import { nextReservationId } from './reservationIdCounter.js';
import { notify } from './notifier.js';
import { nextWaitingEntry } from './queueService.js';

// Called whenever a connector's StatusNotification reports "Available".
// If someone is waiting, holds the connector for them (via OCPP ReserveNow
// where supported, otherwise a soft app-level hold) and notifies them.
export async function onConnectorFreed(stationId, connectorId) {
  const connector = await prisma.connector.findUnique({
    where: { stationId_connectorId: { stationId, connectorId } },
  });
  if (!connector || connector.status !== 'Available') return;

  // A soft (app-only) hold never changes the connector's OCPP status back
  // away from "Available" -- only a real StatusNotification does. Without
  // this check, a second dispatch attempt on the same still-"Available"
  // connector (e.g. the next person joining before that happens) would
  // double-book it against a different entry.
  const alreadyHeld = await prisma.reservation.findFirst({ where: { stationId, connectorId, status: 'ACTIVE' } });
  if (alreadyHeld) return;

  const station = await prisma.station.findUnique({ where: { id: stationId } });
  // A zoned station shares its waitlist with the rest of the zone -- the
  // next person in line may have joined via any station in it.
  const entry = await nextWaitingEntry({ stationId, zoneId: station.zoneId });
  if (!entry) return;

  const client = registry.getClient(station.identity);
  const expiresAt = new Date(Date.now() + config.reservationWindowMinutes * 60_000);

  let ocppReservationId = null;

  if (client) {
    try {
      const reservationId = nextReservationId();
      const result = await client.call('ReserveNow', {
        connectorId,
        expiryDate: expiresAt.toISOString(),
        idTag: entry.idTag,
        reservationId,
      });

      if (result?.status !== 'Accepted') {
        // Occupied/Rejected/Unavailable/Faulted: leave the entry WAITING.
        // A subsequent StatusNotification will re-trigger dispatch.
        return;
      }
      ocppReservationId = reservationId;
    } catch (err) {
      const softFallback = err?.rpcErrorCode === 'NotImplemented' || err?.rpcErrorCode === 'NotSupported';
      if (!softFallback) {
        console.error(`ReserveNow call to ${station.identity} failed:`, err);
        return;
      }
      // Charge point doesn't implement ReserveNow -- fall through to a
      // soft, app-only hold. First-plug-in-with-a-matching-idTag wins.
    }
  }

  await prisma.$transaction([
    // Pins the entry to the specific station it was actually matched to --
    // for a zone entry this is the first time stationId is set, which is
    // what lets StartTransaction/Authorize (both keyed by stationId) find it.
    prisma.queueEntry.update({ where: { id: entry.id }, data: { status: 'NOTIFIED', stationId } }),
    prisma.reservation.create({
      data: {
        queueEntryId: entry.id,
        stationId,
        connectorId,
        ocppReservationId,
        expiresAt,
      },
    }),
  ]);

  await notify(
    entry.contact,
    `${station.name} is ready for you. Plug in by ${expiresAt.toLocaleTimeString()} or your spot will be released.`,
  );
}

// Called whenever a connector's StatusNotification reports that a session
// has ended but the vehicle hasn't been unplugged yet (SuspendedEV or
// Finishing). If someone is waiting, prompts the current occupant to move
// along and gives the next person a heads-up -- separate from the "plug in
// now" notification, which still only fires once the connector actually
// reports Available.
export async function onChargeComplete(stationId, connectorId) {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  const upcoming = await nextWaitingEntry({ stationId, zoneId: station.zoneId });
  if (!upcoming) return;

  const activeTransaction = await prisma.transaction.findFirst({
    where: { stationId, connectorId, stoppedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (activeTransaction) {
    const occupant = await prisma.queueEntry.findFirst({
      where: { stationId, idTag: activeTransaction.idTag },
      orderBy: { createdAt: 'desc' },
    });
    if (occupant) {
      await notify(
        occupant.contact,
        `Your charging session at ${station.name} is complete. Please unplug and move your vehicle for the next person.`,
      );
    }
  }

  await notify(
    upcoming.contact,
    `You're next in line for ${station.name}. The current vehicle is finishing up -- get ready, and we'll notify you the moment it's free.`,
  );
}

// If a station has a free connector right when someone joins, dispatch
// immediately instead of waiting for the next StatusNotification.
export async function tryDispatchStation(stationId) {
  // connectorId 0 is OCPP's "whole station" pseudo-connector, not a physical
  // one anyone can plug into -- exclude it from dispatch.
  const connectors = await prisma.connector.findMany({
    where: { stationId, status: 'Available', connectorId: { gt: 0 } },
  });
  for (const connector of connectors) {
    await onConnectorFreed(stationId, connector.connectorId);
  }
}

// Same as tryDispatchStation, but across every station in a zone -- used
// when someone joins a zone's shared waitlist, in case any station in it
// already has a free connector right now.
export async function tryDispatchZone(zoneId) {
  const connectors = await prisma.connector.findMany({
    where: { status: 'Available', connectorId: { gt: 0 }, station: { zoneId } },
  });
  for (const connector of connectors) {
    await onConnectorFreed(connector.stationId, connector.connectorId);
  }
}

export async function handleStartTransaction(stationId, connectorId, idTag) {
  const entry = await prisma.queueEntry.findFirst({
    where: { stationId, idTag, status: 'NOTIFIED' },
    include: { reservation: true },
  });
  if (!entry) return;

  await prisma.$transaction([
    prisma.queueEntry.update({ where: { id: entry.id }, data: { status: 'COMPLETED' } }),
    ...(entry.reservation
      ? [prisma.reservation.update({ where: { id: entry.reservation.id }, data: { status: 'FULFILLED' } })]
      : []),
  ]);
}

// Driver-initiated "Start Charging": tells the charge point to begin a
// transaction using this entry's idTag, so the driver never needs to know
// or enter that idTag themselves. Only valid once the entry has actually
// been notified and holds an active reservation -- this is the app-side
// half of preventing line-cutting; the other half is centralSystem.js
// refusing to accept a StartTransaction/Authorize for any idTag that isn't
// currently the reserved one.
export async function requestStartCharging(entryId) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: entryId },
    include: { reservation: true, station: true },
  });
  if (!entry) {
    const err = new Error('Waitlist entry not found');
    err.statusCode = 404;
    throw err;
  }
  if (entry.status !== 'NOTIFIED' || entry.reservation?.status !== 'ACTIVE') {
    const err = new Error("It's not this entry's turn to charge yet");
    err.statusCode = 409;
    throw err;
  }

  const client = registry.getClient(entry.station.identity);
  if (!client) {
    const err = new Error('Charge point is offline');
    err.statusCode = 502;
    throw err;
  }

  let result;
  try {
    result = await client.call('RemoteStartTransaction', {
      connectorId: entry.reservation.connectorId,
      idTag: entry.idTag,
    });
  } catch (err) {
    console.error(`RemoteStartTransaction call to ${entry.station.identity} failed:`, err);
    const wrapped = new Error('Charge point rejected the start request');
    wrapped.statusCode = 502;
    throw wrapped;
  }

  if (result?.status !== 'Accepted') {
    const err = new Error('Charge point rejected the start request');
    err.statusCode = 502;
    throw err;
  }
}

// Records a driver's report that someone else appears to have taken their
// reserved spot. Purely informational -- an admin reviews and acts on it
// manually (e.g. contacting the station, voiding a session).
export async function reportLineCutter(entryId, note) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    const err = new Error('Waitlist entry not found');
    err.statusCode = 404;
    throw err;
  }
  if (!entry.stationId) {
    // Still waiting in a zone's shared line -- not matched to a specific
    // station yet, so there's no charger to report a line-cutter at.
    const err = new Error("You haven't been matched to a charger yet");
    err.statusCode = 409;
    throw err;
  }

  return prisma.lineCutterReport.create({
    data: {
      stationId: entry.stationId,
      queueEntryId: entry.id,
      note: note || null,
    },
  });
}

// Cancels a WAITING or NOTIFIED entry at the driver's request. Releases any
// OCPP reservation and advances the queue if a connector was held.
export async function cancelQueueEntry(entryId) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: entryId },
    include: { reservation: true, station: true },
  });
  if (!entry || ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(entry.status)) return entry;

  if (entry.reservation?.status === 'ACTIVE') {
    await releaseReservation(entry.reservation, entry.station);
  }

  return prisma.queueEntry.update({ where: { id: entryId }, data: { status: 'CANCELLED' } });
}

async function releaseReservation(reservation, station) {
  const client = registry.getClient(station.identity);
  if (client && reservation.ocppReservationId != null) {
    try {
      await client.call('CancelReservation', { reservationId: reservation.ocppReservationId });
    } catch (err) {
      console.error(`CancelReservation call to ${station.identity} failed:`, err);
    }
  }
  await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'CANCELLED' } });
}

// Safety net for reservations nobody claimed in time. Run on an interval
// rather than per-entry timers so it also recovers state after a restart.
export async function sweepExpiredReservations() {
  const expired = await prisma.reservation.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
    include: { queueEntry: true, station: true },
  });

  for (const reservation of expired) {
    await releaseReservation(reservation, reservation.station);
    await prisma.queueEntry.update({
      where: { id: reservation.queueEntryId },
      data: { status: 'EXPIRED' },
    });
    // The connector is presumably still Available; let the next person in.
    await onConnectorFreed(reservation.stationId, reservation.connectorId);
  }
}
