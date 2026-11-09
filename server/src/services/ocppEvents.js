import { currentTenantId } from '../tenancy/context.js';
import { emitEvent } from './webhooks.js';
import { rebalanceLater } from './loadBalance.js';

// What the OCPP handlers tell the rest of the system when a session starts or stops, or a charge point
// faults: webhooks are queued, and load balancing runs again. Both protocols call these, so the
// behaviour is the same whichever protocol a charge point speaks. Nothing here blocks the charge point's answer.

export function onSessionStarted(stationId, connectorId, idTag, transactionId) {
  const tenantId = currentTenantId();
  emitEvent('transaction.started', { stationId, connectorId, idTag, transactionId }, tenantId).catch((err) =>
    console.error('[webhooks] transaction.started not queued:', err.message),
  );
  rebalanceLater(tenantId);
}

export function onSessionStopped(stationId, transactionId) {
  const tenantId = currentTenantId();
  emitEvent('transaction.stopped', { stationId, transactionId }, tenantId).catch((err) =>
    console.error('[webhooks] transaction.stopped not queued:', err.message),
  );
  rebalanceLater(tenantId);
}

export function onFault(stationId, connectorId, errorCode) {
  emitEvent('station.faulted', { stationId, connectorId, errorCode }, currentTenantId()).catch((err) =>
    console.error('[webhooks] station.faulted not queued:', err.message),
  );
}
