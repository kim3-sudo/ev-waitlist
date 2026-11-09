import { RPCServer, createRPCError } from 'ocpp-rpc';
import { prisma, rawPrisma } from '../db.js';
import { enterTenant } from '../tenancy/context.js';
import { ensureSiteLoaded } from '../services/runtimeConfig.js';
import { registry } from '../services/stationRegistry.js';
import { onConnectorFreed, onChargeComplete, handleStartTransaction } from '../services/dispatcher.js';
import { reconcileIdle } from '../services/idleTracker.js';
import { createChargeForTransaction } from '../services/payments/chargeService.js';
import { isWaitlistAuthorized, markHoldInUse } from '../services/payments/holds.js';
import { roamingAuthorize } from '../ocpi/authorize.js';
import { enqueue, enqueueForActivePartners } from '../ocpi/outbox.js';
import { noteSeen, recordStationEvent } from '../services/stationEvents.js';
import { notifyAdmins } from '../services/adminAlerts.js';
import { storeMeterValues } from '../services/meterService.js';
import { configureMetering, reapplyAvailability } from '../services/stationConfigure.js';
import { isManualHoldAuthorized, fulfillManualHold } from '../services/manualHolds.js';
import { translateIdTag } from '../services/wallet/credentialService.js';

// An accepted idTagInfo. When the turn has an end time, it is given as expiryDate so the charge
// point can drop the tag from its cache once the turn is over.
function acceptedInfo(expiresAt) {
  return expiresAt ? { status: 'Accepted', expiryDate: expiresAt.toISOString() } : { status: 'Accepted' };
}

// Runs work after the reply to the current message has gone out. Errors go to the log.
function later(label, fn) {
  setTimeout(() => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error(`[ocpp] ${label} failed:`, err.message));
  }, 300);
}

// Alerts the admins who chose fault alerts, once per move into Faulted.
async function reportFault(stationId, connectorId, errorCode, info) {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  const where = connectorId > 0 ? `connector ${connectorId}` : 'the charge point';
  const detail = `${errorCode}${info ? ` (${info})` : ''}`;
  await recordStationEvent(stationId, 'FAULT', `${where}: ${detail}`, { connectorId: connectorId > 0 ? connectorId : null });
  await notifyAdmins('FAULT', `${station.name} reported a fault`, `${station.name} (${station.identity}) reported a fault on ${where}: ${detail}.`);
}

// Statuses meaning "session over, vehicle still occupying the connector".
const IDLE_OCCUPIED_STATUSES = new Set(['SuspendedEV', 'Finishing']);
import { nextTransactionId } from '../services/transactionIdCounter.js';

export function createCentralSystem() {
  const server = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: true,
  });

  // Only charge points that an admin has provisioned (i.e. exist in the
  // Station table) are allowed to connect.
  server.auth(async (accept, reject, handshake) => {
    // Identities are unique across sites, so the station row tells us its site.
    const station = await rawPrisma.station.findUnique({ where: { identity: handshake.identity } });
    if (!station) {
      reject(404, 'Unknown charge point identity');
      return;
    }
    await ensureSiteLoaded(station.tenantId);
    accept({ stationId: station.id, identity: station.identity, tenantId: station.tenantId });
  });

  server.on('client', (client) => {
    const { stationId, identity, tenantId } = client.session;

    // Every message from this charge point runs inside the charge point's site.
    const handle = (...args) => {
      const handler = args.at(-1);
      const scoped = (ctx) =>
        enterTenant(tenantId, () => {
          // Any message is a sign of life, for the silent-station check.
          noteSeen(stationId).catch((err) => console.error(`[ocpp] last-seen for ${identity} failed:`, err.message));
          return handler(ctx);
        });
      return client.handle(...args.slice(0, -1), scoped);
    };
    registry.add(identity, client);
    console.log(`[ocpp] ${identity} connected`);
    enterTenant(tenantId, () =>
      prisma.station.updateMany({ where: { id: stationId }, data: { offlineSince: null } }),
    ).catch((err) => console.error(`[ocpp] connect bookkeeping for ${identity} failed:`, err.message));

    handle('BootNotification', async ({ params }) => {
      console.log(`[ocpp] BootNotification from ${identity}:`, params.chargePointVendor, params.chargePointModel);
      const current = await prisma.station.findUnique({ where: { id: stationId } });
      await prisma.station.update({
        where: { id: stationId },
        data: {
          serialNumber: params.chargePointSerialNumber ?? params.chargeBoxSerialNumber ?? current.serialNumber,
          firmwareVersion: params.firmwareVersion ?? current.firmwareVersion,
          // Fill in the vendor and model only where the admin left them blank.
          vendor: current.vendor || params.chargePointVendor || null,
          model: current.model || params.chargePointModel || null,
        },
      });
      const firmware = params.firmwareVersion ? `, firmware ${params.firmwareVersion}` : '';
      await recordStationEvent(stationId, 'BOOT', `${params.chargePointVendor} ${params.chargePointModel}${firmware}`);
      later(`configuring ${identity}`, async () => {
        const station = await prisma.station.findUnique({ where: { id: stationId } });
        await configureMetering(station);
        await reapplyAvailability(station);
      });
      return {
        status: 'Accepted',
        interval: 300,
        currentTime: new Date().toISOString(),
      };
    });

    handle('Heartbeat', () => ({
      currentTime: new Date().toISOString(),
    }));

    handle('StatusNotification', async ({ params }) => {
      const { connectorId, status, errorCode, info, vendorErrorCode } = params;

      const previous = await prisma.connector.findUnique({
        where: { stationId_connectorId: { stationId, connectorId } },
      });

      const details = { status, errorCode, info: info ?? null, vendorErrorCode: vendorErrorCode ?? null };
      await prisma.connector.upsert({
        where: { stationId_connectorId: { stationId, connectorId } },
        update: details,
        create: { stationId, connectorId, ...details },
      });

      if (status === 'Faulted' && previous?.status !== 'Faulted') {
        await reportFault(stationId, connectorId, errorCode, info).catch((err) =>
          console.error(`[ocpp] fault report for ${identity} failed:`, err.message),
        );
      }

      if (connectorId > 0) {
        await reconcileIdle(stationId, connectorId).catch((err) =>
          console.error(`Idle tracking failed for ${identity}/${connectorId}:`, err),
        );
      }

      if (connectorId > 0 && status !== previous?.status) {
        await enqueueForActivePartners('EVSE_STATUS', `${stationId}|${connectorId}`).catch((err) =>
          console.error('EVSE status queue failed:', err),
        );
        if (status === 'Available') {
          onConnectorFreed(stationId, connectorId).catch((err) =>
            console.error(`Dispatch failed for ${identity}/${connectorId}:`, err),
          );
        } else if (IDLE_OCCUPIED_STATUSES.has(status) && !IDLE_OCCUPIED_STATUSES.has(previous?.status)) {
          onChargeComplete(stationId, connectorId).catch((err) =>
            console.error(`Charge-complete notification failed for ${identity}/${connectorId}:`, err),
          );
        }
      }

      return {};
    });

    // Only the idTag currently holding an ACTIVE reservation/NOTIFIED entry
    // at this station is authorized -- anyone else (a line-cutter plugging
    // in with a different card, or before their turn) is blocked.
    // Where the site requires a card hold, a waitlisted driver is authorized only once it is in place.
    // A wallet pass tag is translated to the driver's waitlist tag first (see services/wallet).
    handle('Authorize', async ({ params: reported }) => {
      const { idTag, expiresAt } = await translateIdTag(stationId, reported.idTag);
      const authorized =
        (await isWaitlistAuthorized(stationId, idTag)) ||
        (await roamingAuthorize(stationId, idTag)).ok ||
        (await isManualHoldAuthorized(stationId, idTag));
      return { idTagInfo: authorized ? acceptedInfo(expiresAt) : { status: 'Blocked' } };
    });

    handle('StartTransaction', async ({ params: reported }) => {
      const { idTag, expiresAt } = await translateIdTag(stationId, reported.idTag);
      const params = { ...reported, idTag };
      const waitlisted = await isWaitlistAuthorized(stationId, params.idTag);
      const roaming = waitlisted ? { ok: false } : await roamingAuthorize(stationId, params.idTag);
      // An admin's manual hold for this ID tag, when the driver isn't on the waitlist.
      const held = !waitlisted && !roaming.ok && (await isManualHoldAuthorized(stationId, params.idTag));
      if (!waitlisted && !roaming.ok && !held) {
        console.warn(`[ocpp] Rejected StartTransaction from ${identity}: idTag ${params.idTag} not authorized`);
        return {
          transactionId: 0,
          idTagInfo: { status: 'Blocked' },
        };
      }

      const transactionId = nextTransactionId();

      const started = await prisma.transaction.create({
        data: {
          stationId,
          connectorId: params.connectorId,
          idTag: params.idTag,
          ocppTransactionId: transactionId,
          meterStart: params.meterStart,
          partnerId: roaming.partnerId ?? null,
        },
      });
      if (roaming.partnerId) {
        await enqueue(roaming.partnerId, 'SESSION', started.id).catch((err) => console.error('Session queue failed:', err));
      }
      if (waitlisted) await markHoldInUse(params.idTag, started.id);
      if (held) await fulfillManualHold(stationId, params.connectorId, params.idTag);

      await reconcileIdle(stationId, params.connectorId).catch((err) =>
        console.error(`Idle tracking failed for ${identity}/${params.connectorId}:`, err),
      );

      await handleStartTransaction(stationId, params.connectorId, params.idTag);

      return {
        transactionId,
        idTagInfo: acceptedInfo(expiresAt),
      };
    });

    handle('StopTransaction', async ({ params }) => {
      const tx = await prisma.transaction.findFirst({
        where: { stationId, ocppTransactionId: params.transactionId },
      });
      await prisma.transaction.updateMany({
        where: { stationId, ocppTransactionId: params.transactionId },
        // OCPP's default reason is Local when the charge point doesn't send one.
        data: { stoppedAt: new Date(), meterStop: params.meterStop, stopReason: params.reason ?? 'Local' },
      });
      if (tx?.partnerId) {
        await enqueue(tx.partnerId, 'SESSION', tx.id).catch((err) => console.error('Session queue failed:', err));
        await enqueue(tx.partnerId, 'CDR', tx.id).catch((err) => console.error('CDR queue failed:', err));
      }
      if (tx) {
        await reconcileIdle(stationId, tx.connectorId).catch((err) =>
          console.error(`Idle tracking failed for ${identity}/${tx.connectorId}:`, err),
        );
      }
      await createChargeForTransaction(stationId, params.transactionId).catch((err) =>
        console.error(`Billing failed for ${identity}/${params.transactionId}:`, err),
      );

      return { idTagInfo: { status: 'Accepted' } };
    });

    handle('MeterValues', async ({ params }) => {
      await storeMeterValues(stationId, params.connectorId, params.transactionId, params.meterValue).catch((err) =>
        console.error(`[ocpp] meter values from ${identity} not stored:`, err.message),
      );
      return {};
    });

    handle('DiagnosticsStatusNotification', async ({ params }) => {
      await prisma.station.update({ where: { id: stationId }, data: { diagnosticsStatus: params.status } });
      await recordStationEvent(stationId, 'DIAGNOSTICS', params.status);
      return {};
    });

    handle('FirmwareStatusNotification', async ({ params }) => {
      await prisma.station.update({ where: { id: stationId }, data: { firmwareStatus: params.status } });
      await recordStationEvent(stationId, 'FIRMWARE', params.status);
      return {};
    });

    // No vendor extensions are set up, so every vendor message is declined politely.
    handle('DataTransfer', () => ({ status: 'UnknownVendorId' }));

    handle(({ method }) => {
      console.warn(`[ocpp] Unhandled method ${method} from ${identity}`);
      throw createRPCError('NotImplemented');
    });

    client.on('disconnect', () => {
      registry.remove(identity);
      enterTenant(tenantId, () =>
        prisma.station.updateMany({ where: { id: stationId, offlineSince: null }, data: { offlineSince: new Date() } }),
      ).catch((err) => console.error(`[ocpp] disconnect bookkeeping for ${identity} failed:`, err.message));
      console.log(`[ocpp] ${identity} disconnected`);
    });
  });

  return server;
}
