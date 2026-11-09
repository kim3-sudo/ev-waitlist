import { config } from './config.js';
import { initRuntimeConfig } from './services/runtimeConfig.js';
import { ensureDefaultTenant } from './db.js';
import { createApp } from './app.js';
import { createCentralSystem } from './ocpp/centralSystem.js';
import { startReservationSweeper } from './services/reservationSweeper.js';
import { startRetentionSweeper } from './services/retentionSweeper.js';
import { startAuditSweeper } from './audit/retention.js';
import { startAuditExporter } from './audit/exporter.js';
import { startOcpiDispatcher } from './ocpi/outbox.js';
import { startWebhookDispatcher } from './services/webhooks.js';
import { startStationWatch } from './services/stationWatch.js';
import { startSmartChargingTicker } from './services/smartChargingTicker.js';
import { runWithTenant } from './tenancy/context.js';
import { startProviderHealthChecks } from './services/payments/providerOutage.js';
import { redispatchAllStations } from './services/dispatcher.js';

// Settings come from the database, so load them before anything starts serving.
await ensureDefaultTenant();
await initRuntimeConfig();

const app = createApp();

const httpServer = app.listen(config.port, () => {
  console.log(`REST API listening on http://localhost:${config.port}`);
});

// OCPP 1.6J charge points connect to ws://host:port/ocpp/<identity>, sharing
// the same HTTP server/port as the REST API.
const centralSystem = createCentralSystem();
httpServer.on('upgrade', centralSystem.handleUpgrade);

startReservationSweeper();
startProviderHealthChecks((tenantId) => runWithTenant(tenantId, () => redispatchAllStations()).catch((err) => console.error('Re-offering connectors failed:', err)));
startRetentionSweeper();
startAuditSweeper();
// Exports audit events to a SIEM when AUDIT_SYSLOG_URL is set.
startAuditExporter();
startOcpiDispatcher();
startWebhookDispatcher();
startStationWatch();
startSmartChargingTicker();
