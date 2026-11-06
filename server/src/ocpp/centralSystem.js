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
      const scoped = (ctx) => enterTenant(tenantId, () => handler(ctx));
      return client.handle(...args.slice(0, -1), scoped);
    };
    registry.add(identity, client);
    console.log(`[ocpp] ${identity} connected`);

    handle('BootNotification', ({ params }) => {
      console.log(`[ocpp] BootNotification from ${identity}:`, params.chargePointVendor, params.chargePointModel);
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
      const { connectorId, status, errorCode } = params;

      const previous = await prisma.connector.findUnique({
        where: { stationId_connectorId: { stationId, connectorId } },
      });

      await prisma.connector.upsert({
        where: { stationId_connectorId: { stationId, connectorId } },
        update: { status, errorCode },
        create: { stationId, connectorId, status, errorCode },
      });

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
    handle('Authorize', async ({ params }) => {
      const authorized = (await isWaitlistAuthorized(stationId, params.idTag)) || (await roamingAuthorize(stationId, params.idTag)).ok;
      return { idTagInfo: { status: authorized ? 'Accepted' : 'Blocked' } };
    });

    handle('StartTransaction', async ({ params }) => {
      const waitlisted = await isWaitlistAuthorized(stationId, params.idTag);
      const roaming = waitlisted ? { ok: false } : await roamingAuthorize(stationId, params.idTag);
      if (!waitlisted && !roaming.ok) {
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

      await reconcileIdle(stationId, params.connectorId).catch((err) =>
        console.error(`Idle tracking failed for ${identity}/${params.connectorId}:`, err),
      );

      await handleStartTransaction(stationId, params.connectorId, params.idTag);

      return {
        transactionId,
        idTagInfo: { status: 'Accepted' },
      };
    });

    handle('StopTransaction', async ({ params }) => {
      const tx = await prisma.transaction.findFirst({
        where: { stationId, ocppTransactionId: params.transactionId },
      });
      await prisma.transaction.updateMany({
        where: { stationId, ocppTransactionId: params.transactionId },
        data: { stoppedAt: new Date(), meterStop: params.meterStop },
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

    handle('MeterValues', () => ({}));
    handle('DiagnosticsStatusNotification', () => ({}));
    handle('FirmwareStatusNotification', () => ({}));

    handle(({ method }) => {
      console.warn(`[ocpp] Unhandled method ${method} from ${identity}`);
      throw createRPCError('NotImplemented');
    });

    client.on('disconnect', () => {
      registry.remove(identity);
      console.log(`[ocpp] ${identity} disconnected`);
    });
  });

  return server;
}
