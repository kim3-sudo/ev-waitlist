import express, { Router } from 'express';
import cors from 'cors';
import { allowedOrigins } from './services/runtimeConfig.js';
import { adminSystemRouter } from './routes/admin.system.routes.js';
import { adminIntegrationsRouter } from './routes/admin.integrations.routes.js';
import { adminEmailRouter, adminSmsRouter } from './routes/admin.notifications.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { samlRouter } from './auth/saml.routes.js';
import { requireAdmin, requirePermission, requireReadOrManage } from './auth/auth.middleware.js';
import { stationsRouter } from './routes/stations.routes.js';
import { zonesRouter } from './routes/zones.routes.js';
import { waitlistRouter } from './routes/waitlist.routes.js';
import { adminStationsRouter } from './routes/admin.stations.routes.js';
import { adminStationCommandsRouter } from './routes/admin.stationCommands.routes.js';
import { adminZonesRouter } from './routes/admin.zones.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { adminSettingsRouter } from './routes/admin.settings.routes.js';
import { adminTemplatesRouter } from './routes/admin.templates.routes.js';
import { adminReportsRouter } from './routes/admin.reports.routes.js';
import { adminUsageRouter } from './routes/admin.usage.routes.js';
import { adminComplaintsRouter } from './routes/admin.complaints.routes.js';
import { adminUsersRouter } from './routes/admin.users.routes.js';
import { adminSamlRouter } from './routes/admin.saml.routes.js';
import { adminSetupRouter } from './routes/admin.setup.routes.js';
import { adminRolesRouter } from './routes/admin.roles.routes.js';
import { adminPaymentsRouter } from './routes/admin.payments.routes.js';
import { payRouter } from './routes/pay.routes.js';
import { stripeWebhookHandler } from './routes/stripeWebhook.routes.js';
import { squareWebhookHandler } from './routes/squareWebhook.routes.js';
import { tenantFromSlug } from './tenancy/middleware.js';
import { requireInstanceAdmin } from './auth/auth.middleware.js';
import { adminSitesRouter } from './routes/admin.sites.routes.js';
import { adminOperatorRouter } from './routes/admin.operator.routes.js';
import { adminPrivacyRouter } from './routes/admin.privacy.routes.js';
import { adminRoamingRouter } from './routes/admin.roaming.routes.js';
import { ocpiRouter } from './ocpi/routes.js';
import { adminOcpiRouter } from './routes/admin.ocpi.routes.js';

// Builds the REST API's Express app. Deliberately has no side effects
// (no listen(), no OCPP central system, no background timers) so it can be
// mounted standalone -- e.g. under supertest in the test suite.
export function createApp() {
  const app = express();
  // Read per request, so a change in the admin UI applies without a restart.
  app.use(cors({ origin: (origin, callback) => callback(null, allowedOrigins().has(origin)) }));
  // Must come before express.json() so the signature is checked against the raw bytes.
  app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
  app.post('/api/payments/square/webhook', express.raw({ type: 'application/json' }), squareWebhookHandler);
  // The same webhooks for a named site. Each site can point its provider at its own URL.
  app.post('/api/t/:slug/payments/stripe/webhook', tenantFromSlug, express.raw({ type: 'application/json' }), stripeWebhookHandler);
  app.post('/api/t/:slug/payments/square/webhook', tenantFromSlug, express.raw({ type: 'application/json' }), squareWebhookHandler);
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/auth/saml', samlRouter);
  app.use('/api/stations', stationsRouter);
  app.use('/api/zones', zonesRouter);
  app.use('/api/waitlist', waitlistRouter);
  // Each area has a view and a manage permission. Reads need view, writes need manage.
  app.use('/api/admin/stations', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminStationsRouter);
  // Commands to charge points. Its own prefix, so viewers who can see stations are not blocked by it.
  app.use('/api/admin/station-commands', requireAdmin, requirePermission('stations.control'), adminStationCommandsRouter);
  app.use('/api/admin/zones', requireAdmin, requireReadOrManage('zones.view', 'zones.manage'), adminZonesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/pay', payRouter);

  // The public, driver-facing routes for a named site, under /api/t/<slug>. The
  // un-prefixed routes above serve the default site.
  const sitePublicRouter = Router();
  sitePublicRouter.use('/auth/saml', samlRouter);
  sitePublicRouter.use('/stations', stationsRouter);
  sitePublicRouter.use('/zones', zonesRouter);
  sitePublicRouter.use('/waitlist', waitlistRouter);
  sitePublicRouter.use('/settings', settingsRouter);
  sitePublicRouter.use('/pay', payRouter);
  app.use('/api/t/:slug', tenantFromSlug, sitePublicRouter);
  app.use('/api/admin/settings', requirePermission('branding.manage'), adminSettingsRouter);
  app.use('/api/admin/templates', requirePermission('branding.manage'), adminTemplatesRouter);
  app.use('/api/admin/reports', requirePermission('reports.view'), adminReportsRouter);
  app.use('/api/admin/reports', requirePermission('reports.view'), adminUsageRouter);
  app.use('/api/admin/complaints', requireAdmin, requireReadOrManage('complaints.view', 'complaints.manage'), adminComplaintsRouter);
  app.use('/api/admin/users', requirePermission('users.manage'), adminUsersRouter);
  app.use('/api/admin/roles', requirePermission('users.manage'), adminRolesRouter);
  app.use('/api/admin/saml', requirePermission('sso.manage'), adminSamlRouter);
  app.use('/api/admin/setup', requirePermission('branding.manage'), adminSetupRouter);
  app.use('/api/admin/payments', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminPaymentsRouter);
  app.use('/api/admin/integrations', requirePermission('integrations.manage'), adminIntegrationsRouter);
  app.use('/api/admin/email', requirePermission('integrations.manage'), adminEmailRouter);
  app.use('/api/admin/sms', requirePermission('integrations.manage'), adminSmsRouter);
  app.use('/api/admin/system', requirePermission('system.manage'), adminSystemRouter);
  app.use('/api/admin/sites', requirePermission('sites.manage'), requireInstanceAdmin, adminSitesRouter);
  app.use('/api/admin/operator', requirePermission('sites.manage'), requireInstanceAdmin, adminOperatorRouter);
  app.use('/api/admin/privacy', requirePermission('privacy.manage'), adminPrivacyRouter);
  app.use('/api/admin/roaming', requirePermission('roaming.manage'), adminRoamingRouter);
  app.use('/api/admin/ocpi', requirePermission('roaming.manage'), adminOcpiRouter);
  // OCPI 2.2.1 for one site, at /ocpi/<slug>. Partners authenticate with their own tokens.
  app.use('/ocpi/:slug', tenantFromSlug, ocpiRouter);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
