import { RPCServer, createRPCError } from 'ocpp-rpc';
import { prisma } from '../db.js';
import { registry } from '../services/stationRegistry.js';
import { onConnectorFreed, onChargeComplete, handleStartTransaction } from '../services/dispatcher.js';
import { isIdTagAuthorizedAt } from '../services/queueService.js';

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
    const station = await prisma.station.findUnique({ where: { identity: handshake.identity } });
    if (!station) {
      reject(404, 'Unknown charge point identity');
      return;
    }
    accept({ stationId: station.id, identity: station.identity });
  });

  server.on('client', (client) => {
    const { stationId, identity } = client.session;
    registry.add(identity, client);
    console.log(`[ocpp] ${identity} connected`);

    client.handle('BootNotification', ({ params }) => {
      console.log(`[ocpp] BootNotification from ${identity}:`, params.chargePointVendor, params.chargePointModel);
      return {
        status: 'Accepted',
        interval: 300,
        currentTime: new Date().toISOString(),
      };
    });

    client.handle('Heartbeat', () => ({
      currentTime: new Date().toISOString(),
    }));

    client.handle('StatusNotification', async ({ params }) => {
      const { connectorId, status, errorCode } = params;

      const previous = await prisma.connector.findUnique({
        where: { stationId_connectorId: { stationId, connectorId } },
      });

      await prisma.connector.upsert({
        where: { stationId_connectorId: { stationId, connectorId } },
        update: { status, errorCode },
        create: { stationId, connectorId, status, errorCode },
      });

      if (connectorId > 0 && status !== previous?.status) {
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
    client.handle('Authorize', async ({ params }) => {
      const authorized = await isIdTagAuthorizedAt(stationId, params.idTag);
      return { idTagInfo: { status: authorized ? 'Accepted' : 'Blocked' } };
    });

    client.handle('StartTransaction', async ({ params }) => {
      const authorized = await isIdTagAuthorizedAt(stationId, params.idTag);
      if (!authorized) {
        console.warn(`[ocpp] Rejected StartTransaction from ${identity}: idTag ${params.idTag} not authorized`);
        return {
          transactionId: 0,
          idTagInfo: { status: 'Blocked' },
        };
      }

      const transactionId = nextTransactionId();

      await prisma.transaction.create({
        data: {
          stationId,
          connectorId: params.connectorId,
          idTag: params.idTag,
          ocppTransactionId: transactionId,
          meterStart: params.meterStart,
        },
      });

      await handleStartTransaction(stationId, params.connectorId, params.idTag);

      return {
        transactionId,
        idTagInfo: { status: 'Accepted' },
      };
    });

    client.handle('StopTransaction', async ({ params }) => {
      await prisma.transaction.updateMany({
        where: { stationId, ocppTransactionId: params.transactionId },
        data: { stoppedAt: new Date(), meterStop: params.meterStop },
      });

      return { idTagInfo: { status: 'Accepted' } };
    });

    client.handle('MeterValues', () => ({}));
    client.handle('DiagnosticsStatusNotification', () => ({}));
    client.handle('FirmwareStatusNotification', () => ({}));

    client.handle(({ method }) => {
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
