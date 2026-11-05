import { prisma } from '../db.js';

// Idle = the vehicle is still occupying the connector after the session has
// finished. "Finishing" always means the transaction is over. "SuspendedEV"
// is also used mid-session (the car pausing or tapering), so it only counts
// as idle when no transaction is open on that connector.
export async function isConnectorIdle(stationId, connectorId) {
  const connector = await prisma.connector.findUnique({
    where: { stationId_connectorId: { stationId, connectorId } },
  });
  if (connector?.status === 'Finishing') return true;
  if (connector?.status === 'SuspendedEV') {
    const openTx = await prisma.transaction.findFirst({
      where: { stationId, connectorId, stoppedAt: null },
    });
    return !openTx;
  }
  return false;
}

// Serializes reconciliation per connector, so overlapping OCPP messages
// (e.g. StatusNotification and StopTransaction arriving together) can't both
// see "no open idle event" and open two.
const chains = new Map();

// Opens an IdleEvent when a connector becomes idle, and closes the open one
// when it stops being idle (freed, charging again, or a new session starts).
// Safe to call after any status or transaction change.
export function reconcileIdle(stationId, connectorId, now = new Date()) {
  if (!(connectorId > 0)) return Promise.resolve();
  const key = `${stationId}:${connectorId}`;
  const run = (chains.get(key) ?? Promise.resolve()).then(async () => {
    const idle = await isConnectorIdle(stationId, connectorId);
    const open = await prisma.idleEvent.findFirst({
      where: { stationId, connectorId, endedAt: null },
    });
    if (idle && !open) {
      await prisma.idleEvent.create({ data: { stationId, connectorId, startedAt: now } });
    } else if (!idle && open) {
      await prisma.idleEvent.update({ where: { id: open.id }, data: { endedAt: now } });
    }
  });
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
