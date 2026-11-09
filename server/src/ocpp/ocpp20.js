import { createRPCError } from 'ocpp-rpc';
import { prisma } from '../db.js';
import { translateIdTag } from '../services/wallet/credentialService.js';
import { isWaitlistAuthorized, markHoldInUse } from '../services/payments/holds.js';
import { roamingAuthorize } from '../ocpi/authorize.js';
import { enqueue, enqueueForActivePartners } from '../ocpi/outbox.js';
import { recordStationEvent } from '../services/stationEvents.js';
import { storeMeterValues } from '../services/meterService.js';
import { isManualHoldAuthorized, fulfillManualHold } from '../services/manualHolds.js';
import { onConnectorFreed, handleStartTransaction } from '../services/dispatcher.js';
import { reconcileIdle } from '../services/idleTracker.js';
import { createChargeForTransaction } from '../services/payments/chargeService.js';
import { nextTransactionId } from '../services/transactionIdCounter.js';
import { markLatestDiagnosticsFailed } from '../services/diagnosticsLogs.js';
import { isBlockedIdTag } from '../services/localList.js';
import { reapplyAvailability } from '../services/stationConfigure.js';

// OCPP 2.0.1 messages from a charge point. The same services as OCPP 1.6 do the work, so a session,
// a price and a waitlist turn behave the same whichever protocol the charge point speaks.
//
// The one EVSE a charge point has is EVSE 1 here, and a connector is numbered as on 1.6. A
// transaction is named by the charge point's own text ID (transactionInfo.transactionId), kept in
// Transaction.ocppTransactionRef. Our numeric ocppTransactionId is what the rest of the app uses.

// 2.0.1 connector statuses, as this app stores them. "Occupied" is kept as the charge point sends it,
// since 2.0.1 does not say whether it is preparing or charging.
const CONNECTOR_STATUS = {
  Available: 'Available',
  Occupied: 'Occupied',
  Reserved: 'Reserved',
  Unavailable: 'Unavailable',
  Faulted: 'Faulted',
};

const ACCEPTED_TOKEN = (expiresAt) => ({
  status: 'Accepted',
  ...(expiresAt && { cacheExpiryDateTime: expiresAt.toISOString() }),
});

// Meter readings in 2.0.1 carry the unit under unitOfMeasure. Store them in the 1.6 shape the
// meter service reads.
export function toStoredMeterValues(list) {
  return (list ?? []).map((m) => ({
    timestamp: m.timestamp,
    sampledValue: (m.sampledValue ?? []).map((s) => ({
      value: String(s.value),
      measurand: s.measurand,
      context: s.context,
      phase: s.phase,
      location: s.location,
      unit: s.unitOfMeasure?.unit,
    })),
  }));
}

// The latest energy reading in Wh from a 2.0.1 meter value list, or null.
export function energyWhFrom(list) {
  let latest = null;
  for (const m of list ?? []) {
    for (const s of m.sampledValue ?? []) {
      if (s.measurand && s.measurand !== 'Energy.Active.Import.Register') continue;
      const unit = s.unitOfMeasure?.unit ?? 'Wh';
      const value = Number(s.value);
      if (!Number.isFinite(value)) continue;
      const wh = unit === 'kWh' ? value * 1000 : value;
      if (latest === null || new Date(m.timestamp) >= latest.at) latest = { wh: Math.round(wh), at: new Date(m.timestamp) };
    }
  }
  return latest ? latest.wh : null;
}

// Who may charge on this charge point, for both the Authorize and the TransactionEvent messages.
async function decide(stationId, idTag) {
  if (await isBlockedIdTag(idTag)) return { authorized: false, blocked: true };
  const waitlisted = await isWaitlistAuthorized(stationId, idTag);
  const roaming = waitlisted ? { ok: false } : await roamingAuthorize(stationId, idTag);
  const held = !waitlisted && !roaming.ok && (await isManualHoldAuthorized(stationId, idTag));
  return { authorized: waitlisted || roaming.ok || held, waitlisted, roaming, held };
}

// Attaches the OCPP 2.0.1 handlers to one connection. `handle` is the central system's wrapper, which
// runs each message inside the charge point's site. `reportFault` is the 1.6 fault report, shared.
export function attachOcpp20(client, { handle, stationId, identity, reportFault, later }) {
  const log = (msg) => console.log(`[ocpp2.0.1] ${identity}: ${msg}`);

  handle('BootNotification', async ({ params }) => {
    const cs = params.chargingStation ?? {};
    log(`BootNotification (${params.reason}) ${cs.vendorName ?? ''} ${cs.model ?? ''}`);
    const current = await prisma.station.findUnique({ where: { id: stationId } });
    await prisma.station.update({
      where: { id: stationId },
      data: {
        serialNumber: cs.serialNumber ?? current.serialNumber,
        firmwareVersion: cs.firmwareVersion ?? current.firmwareVersion,
        vendor: current.vendor || cs.vendorName || null,
        model: current.model || cs.model || null,
      },
    });
    const firmware = cs.firmwareVersion ? `, firmware ${cs.firmwareVersion}` : '';
    await recordStationEvent(stationId, 'BOOT', `${cs.vendorName ?? ''} ${cs.model ?? ''}${firmware} (OCPP 2.0.1)`.trim());
    later(`re-applying availability for ${identity}`, async () => {
      const station = await prisma.station.findUnique({ where: { id: stationId } });
      await reapplyAvailability(station);
    });
    return { currentTime: new Date().toISOString(), interval: 300, status: 'Accepted' };
  });

  handle('Heartbeat', () => ({ currentTime: new Date().toISOString() }));

  handle('StatusNotification', async ({ params }) => {
    const connectorId = Number(params.connectorId ?? 1);
    const status = CONNECTOR_STATUS[params.connectorStatus] ?? params.connectorStatus;
    const previous = await prisma.connector.findUnique({ where: { stationId_connectorId: { stationId, connectorId } } });
    await prisma.connector.upsert({
      where: { stationId_connectorId: { stationId, connectorId } },
      update: { status, errorCode: 'NoError', info: null, vendorErrorCode: null },
      create: { stationId, connectorId, status, errorCode: 'NoError' },
    });
    if (status === 'Faulted' && previous?.status !== 'Faulted') {
      await reportFault(stationId, connectorId, 'Faulted', null).catch((err) =>
        console.error(`[ocpp2.0.1] fault report for ${identity} failed:`, err.message),
      );
    }
    if (connectorId > 0) {
      await reconcileIdle(stationId, connectorId).catch((err) => console.error(`Idle tracking failed for ${identity}/${connectorId}:`, err));
    }
    if (status !== previous?.status) {
      await enqueueForActivePartners('EVSE_STATUS', `${stationId}|${connectorId}`).catch((err) => console.error('EVSE status queue failed:', err));
      if (status === 'Available') {
        onConnectorFreed(stationId, connectorId).catch((err) => console.error(`Dispatch failed for ${identity}/${connectorId}:`, err));
      }
    }
    return {};
  });

  handle('Authorize', async ({ params }) => {
    const reported = params.idToken?.idToken;
    const { idTag, expiresAt } = await translateIdTag(stationId, reported);
    const decision = await decide(stationId, idTag);
    return { idTokenInfo: decision.authorized ? ACCEPTED_TOKEN(expiresAt) : { status: decision.blocked ? 'Blocked' : 'Unknown' } };
  });

  handle('TransactionEvent', async ({ params }) => {
    const info = params.transactionInfo ?? {};
    const ref = String(info.transactionId);
    const connectorId = Number(params.evse?.connectorId ?? 1);

    if (params.eventType === 'Started') {
      const reported = params.idToken?.idToken;
      const { idTag, expiresAt } = reported ? await translateIdTag(stationId, reported) : { idTag: null, expiresAt: null };
      const decision = idTag ? await decide(stationId, idTag) : { authorized: false };
      if (!decision.authorized) {
        log(`refused a session (${ref}): ID tag not authorized`);
        await recordStationEvent(stationId, 'COMMAND', `Stopped session ${ref}: the ID tag is not authorized.`, { connectorId });
        later(`stopping unauthorized session ${ref} on ${identity}`, async () => {
          await client.call('RequestStopTransaction', { transactionId: ref }).catch(() => {});
        });
        return { idTokenInfo: { status: decision.blocked ? 'Blocked' : 'Invalid' } };
      }

      const started = await prisma.transaction.create({
        data: {
          stationId,
          connectorId,
          idTag,
          ocppTransactionId: nextTransactionId(),
          ocppTransactionRef: ref,
          meterStart: energyWhFrom(params.meterValue) ?? 0,
          partnerId: decision.roaming?.partnerId ?? null,
        },
      });
      if (decision.roaming?.partnerId) {
        await enqueue(decision.roaming.partnerId, 'SESSION', started.id).catch((err) => console.error('Session queue failed:', err));
      }
      if (decision.waitlisted) await markHoldInUse(idTag, started.id);
      if (decision.held) await fulfillManualHold(stationId, connectorId, idTag);
      await reconcileIdle(stationId, connectorId).catch((err) => console.error(`Idle tracking failed for ${identity}/${connectorId}:`, err));
      await handleStartTransaction(stationId, connectorId, idTag);
      return { idTokenInfo: ACCEPTED_TOKEN(expiresAt) };
    }

    // Updated and Ended refer to a session we started. A session we never accepted is ignored.
    const tx = await prisma.transaction.findFirst({ where: { stationId, ocppTransactionRef: ref, stoppedAt: null } });
    if (!tx) return {};

    if (params.meterValue?.length) {
      await storeMeterValues(stationId, tx.connectorId, tx.ocppTransactionId, toStoredMeterValues(params.meterValue)).catch((err) =>
        console.error(`[ocpp2.0.1] meter values from ${identity} not stored:`, err.message),
      );
    }

    if (params.eventType === 'Ended') {
      const meterStop = energyWhFrom(params.meterValue);
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          stoppedAt: new Date(),
          ...(meterStop !== null && { meterStop }),
          stopReason: info.stoppedReason ?? 'Local',
        },
      });
      if (tx.partnerId) {
        await enqueue(tx.partnerId, 'SESSION', tx.id).catch((err) => console.error('Session queue failed:', err));
        await enqueue(tx.partnerId, 'CDR', tx.id).catch((err) => console.error('CDR queue failed:', err));
      }
      await reconcileIdle(stationId, tx.connectorId).catch((err) => console.error(`Idle tracking failed for ${identity}/${tx.connectorId}:`, err));
      await createChargeForTransaction(stationId, tx.ocppTransactionId).catch((err) =>
        console.error(`Billing failed for ${identity}/${tx.ocppTransactionId}:`, err),
      );
    }
    return {};
  });

  handle('MeterValues', async ({ params }) => {
    // 2.0.1 meter values name the EVSE, not the transaction. They belong to the session open on it.
    const tx = await prisma.transaction.findFirst({ where: { stationId, stoppedAt: null }, orderBy: { startedAt: 'desc' } });
    if (tx) {
      await storeMeterValues(stationId, tx.connectorId, tx.ocppTransactionId, toStoredMeterValues(params.meterValue)).catch((err) =>
        console.error(`[ocpp2.0.1] meter values from ${identity} not stored:`, err.message),
      );
    }
    return {};
  });

  handle('FirmwareStatusNotification', async ({ params }) => {
    await prisma.station.update({ where: { id: stationId }, data: { firmwareStatus: params.status } });
    await recordStationEvent(stationId, 'FIRMWARE', params.status);
    return {};
  });

  // 2.0.1 reports diagnostics uploads as log status (LogStatusNotification).
  handle('LogStatusNotification', async ({ params }) => {
    await prisma.station.update({ where: { id: stationId }, data: { diagnosticsStatus: params.status } });
    await recordStationEvent(stationId, 'DIAGNOSTICS', params.status);
    if (params.status === 'UploadFailure') await markLatestDiagnosticsFailed(stationId);
    return {};
  });

  handle('DataTransfer', () => ({ status: 'UnknownVendorId' }));

  handle(({ method }) => {
    console.warn(`[ocpp2.0.1] Unhandled method ${method} from ${identity}`);
    throw createRPCError('NotImplemented');
  });
}
