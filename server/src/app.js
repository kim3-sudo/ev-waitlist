import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { adminSystemRouter } from './routes/admin.system.routes.js';
import { adminIntegrationsRouter } from './routes/admin.integrations.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { samlRouter } from './auth/saml.routes.js';
import { requireAdmin, requirePermission, requireReadOrManage } from './auth/auth.middleware.js';
import { stationsRouter } from './routes/stations.routes.js';
import { zonesRouter } from './routes/zones.routes.js';
import { waitlistRouter } from './routes/waitlist.routes.js';
import { adminStationsRouter } from './routes/admin.stations.routes.js';
import { adminZonesRouter } from './routes/admin.zones.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { adminSettingsRouter } from './routes/admin.settings.routes.js';
import { adminReportsRouter } from './routes/admin.reports.routes.js';
import { adminComplaintsRouter } from './routes/admin.complaints.routes.js';
import { adminUsersRouter } from './routes/admin.users.routes.js';
import { adminSamlRouter } from './routes/admin.saml.routes.js';
import { adminSetupRouter } from './routes/admin.setup.routes.js';
import { adminRolesRouter } from './routes/admin.roles.routes.js';
import { adminPaymentsRouter } from './routes/admin.payments.routes.js';
import { payRouter } from './routes/pay.routes.js';
import { stripeWebhookHandler } from './routes/stripeWebhook.routes.js';
import { squareWebhookHandler } from './routes/squareWebhook.routes.js';

// Builds the REST API's Express app. Deliberately has no side effects
// (no listen(), no OCPP central system, no background timers) so it can be
// mounted standalone -- e.g. under supertest in the test suite.
export function createApp() {
  const app = express();
  // Read per request, so a change in the admin UI applies without a restart.
  app.use(cors({ origin: (origin, callback) => callback(null, origin === config.corsOrigin) }));
  // Must come before express.json() so the signature is checked against the raw bytes.
  app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
  app.post('/api/payments/square/webhook', express.raw({ type: 'application/json' }), squareWebhookHandler);
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/auth/saml', samlRouter);
  app.use('/api/stations', stationsRouter);
  app.use('/api/zones', zonesRouter);
  app.use('/api/waitlist', waitlistRouter);
  // Each area has a view and a manage permission. Reads need view, writes need manage.
  app.use('/api/admin/stations', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminStationsRouter);
  app.use('/api/admin/zones', requireAdmin, requireReadOrManage('zones.view', 'zones.manage'), adminZonesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/pay', payRouter);
  app.use('/api/admin/settings', requirePermission('branding.manage'), adminSettingsRouter);
  app.use('/api/admin/reports', requirePermission('reports.view'), adminReportsRouter);
  app.use('/api/admin/complaints', requireAdmin, requireReadOrManage('complaints.view', 'complaints.manage'), adminComplaintsRouter);
  app.use('/api/admin/users', requirePermission('users.manage'), adminUsersRouter);
  app.use('/api/admin/roles', requirePermission('users.manage'), adminRolesRouter);
  app.use('/api/admin/saml', requirePermission('sso.manage'), adminSamlRouter);
  app.use('/api/admin/setup', requirePermission('branding.manage'), adminSetupRouter);
  app.use('/api/admin/payments', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminPaymentsRouter);
  app.use('/api/admin/integrations', requirePermission('integrations.manage'), adminIntegrationsRouter);
  app.use('/api/admin/system', requirePermission('system.manage'), adminSystemRouter);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
