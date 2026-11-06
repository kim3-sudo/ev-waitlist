import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { partnerRequest, theirTokenOf } from './client.js';
import { evseUid } from './mappers.js';

// Commands a roaming partner sends us (OCPI Commands module). The partner gets an
// immediate answer; the final outcome is posted to its response_url afterwards.

export const COMMANDS = ['START_SESSION', 'STOP_SESSION', 'UNLOCK_CONNECTOR', 'RESERVE_NOW'];

async function sendToChargePoint(station, action, payload) {
  const client = registry.getClient(station.identity);
  if (!client) return { ok: false, reason: 'offline' };
  try {
    const result = await client.call(action, payload);
    return { ok: true, status: result?.status };
  } catch (err) {
    console.error(`${action} call to ${station.identity} failed:`, err.message);
    return { ok: false, reason: 'error' };
  }
}

async function findConnector(station, evse) {
  if (!evse) return station.connectors.find((c) => c.connectorId > 0) ?? null;
  return station.connectors.find((c) => c.connectorId > 0 && evseUid(station, c.connectorId) === evse) ?? null;
}

// Tells the partner how a command ended. A failure here is logged; the partner can
// ask again.
export async function postCommandResult(partner, responseUrl, result) {
  if (!responseUrl) return;
  const res = await partnerRequest(theirTokenOf(partner), 'POST', responseUrl, { result });
  if (!res.ok) console.error(`Command result to ${responseUrl} failed (HTTP ${res.status}).`);
}

// Runs a command. Returns { status, data } for the partner's sync response, and
// schedules the async result.
export async function runCommand(partner, command, body) {
  if (!COMMANDS.includes(command)) return { unknown: true };

  if (command === 'RESERVE_NOW') {
    return { data: { result: 'NOT_SUPPORTED' } };
  }

  if (command === 'START_SESSION') {
    const { response_url: responseUrl, token, location_id: locationId, evse_uid: evse } = body ?? {};
    const tokenRow = token?.uid
      ? await prisma.ocpiToken.findFirst({ where: { partnerId: partner.id, uid: token.uid, valid: true } })
      : null;
    if (!tokenRow) return { data: { result: 'REJECTED' } };

    const station = locationId ? await prisma.station.findUnique({ where: { id: locationId }, include: { connectors: true } }) : null;
    if (!station) return { unknownLocation: true };

    const connector = await findConnector(station, evse);
    const held = await prisma.reservation.findFirst({ where: { stationId: station.id, status: 'ACTIVE' } });
    if (!connector || held) return { data: { result: 'REJECTED' } };

    const sent = await sendToChargePoint(station, 'RemoteStartTransaction', {
      connectorId: connector.connectorId,
      idTag: tokenRow.uid,
    });
    const accepted = sent.ok && sent.status === 'Accepted';
    const result = accepted ? 'ACCEPTED' : 'REJECTED';
    postCommandResult(partner, responseUrl, result);
    return { data: { result, timeout: 30 } };
  }

  if (command === 'STOP_SESSION') {
    const { response_url: responseUrl, session_id: sessionId } = body ?? {};
    const tx = sessionId
      ? await prisma.transaction.findFirst({
          where: { id: sessionId, partnerId: partner.id, stoppedAt: null },
          include: { station: true },
        })
      : null;
    if (!tx) return { data: { result: 'UNKNOWN_SESSION' } };

    const sent = await sendToChargePoint(tx.station, 'RemoteStopTransaction', { transactionId: tx.ocppTransactionId });
    const accepted = sent.ok && sent.status === 'Accepted';
    const result = accepted ? 'ACCEPTED' : 'REJECTED';
    postCommandResult(partner, responseUrl, result);
    return { data: { result, timeout: 30 } };
  }

  // UNLOCK_CONNECTOR
  const { response_url: responseUrl, location_id: locationId, evse_uid: evse } = body ?? {};
  const station = locationId ? await prisma.station.findUnique({ where: { id: locationId }, include: { connectors: true } }) : null;
  if (!station) return { unknownLocation: true };
  const connector = await findConnector(station, evse);
  if (!connector) return { data: { result: 'REJECTED' } };
  const sent = await sendToChargePoint(station, 'UnlockConnector', { connectorId: connector.connectorId });
  const accepted = sent.ok && sent.status === 'Unlocked';
  const result = accepted ? 'ACCEPTED' : 'REJECTED';
  postCommandResult(partner, responseUrl, result);
  return { data: { result, timeout: 30 } };
}
