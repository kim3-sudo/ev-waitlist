import express, { Router } from 'express';
import cors from 'cors';
import { allowedOrigins } from './services/runtimeConfig.js';
import { adminSystemRouter } from './routes/admin.system.routes.js';
import { adminIntegrationsRouter } from './routes/admin.integrations.routes.js';
import { adminWalletRouter } from './routes/admin.wallet.routes.js';
import { adminFirmwareRouter } from './routes/admin.firmware.routes.js';
import { deviceFilesRouter } from './routes/deviceFiles.routes.js';
import { adminBillingRouter, adminTaxRulesRouter } from './routes/admin.billing.routes.js';
import { publicReceiptsRouter } from './routes/receipts.routes.js';
import { adminLocalListRouter } from './routes/admin.localList.routes.js';
import { adminWebhooksRouter } from './routes/admin.webhooks.routes.js';
import { adminSubscriptionsRouter } from './routes/admin.subscriptions.routes.js';
import { adminLoadBalancingRouter } from './routes/admin.loadBalancing.routes.js';
import { adminEmailRouter, adminSmsRouter } from './routes/admin.notifications.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { signInCodeRouter } from './auth/signInCode.routes.js';
import { samlRouter } from './auth/saml.routes.js';
import { requireAdmin, requirePermission, requireReadOrManage } from './auth/auth.middleware.js';
import { stationsRouter } from './routes/stations.routes.js';
import { zonesRouter } from './routes/zones.routes.js';
import { locatorRouter } from './routes/locator.routes.js';
import { adminLocatorRouter } from './routes/admin.locator.routes.js';
import { waitlistRouter } from './routes/waitlist.routes.js';
import { adminStationsRouter } from './routes/admin.stations.routes.js';
import { adminStationCommandsRouter } from './routes/admin.stationCommands.routes.js';
import { adminZonesRouter } from './routes/admin.zones.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { adminSettingsRouter } from './routes/admin.settings.routes.js';
import { adminTemplatesRouter } from './routes/admin.templates.routes.js';
import { adminReportsRouter } from './routes/admin.reports.routes.js';
import { adminUsageRouter } from './routes/admin.usage.routes.js';
import { adminDashboardRouter } from './routes/admin.dashboard.routes.js';
import { adminComplaintsRouter } from './routes/admin.complaints.routes.js';
import { adminUsersRouter } from './routes/admin.users.routes.js';
import { adminSamlRouter } from './routes/admin.saml.routes.js';
import { adminSetupRouter } from './routes/admin.setup.routes.js';
import { adminRolesRouter } from './routes/admin.roles.routes.js';
import { adminPaymentsRouter } from './routes/admin.payments.routes.js';
import { adminPriceRulesRouter } from './routes/admin.priceRules.routes.js';
import { adminAlertsRouter } from './routes/admin.alerts.routes.js';
import { noticesRouter } from './routes/notices.routes.js';
import { pricingRouter } from './routes/pricing.routes.js';
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
import { adminAuditRouter } from './routes/admin.audit.routes.js';
import { auditHttp } from './audit/httpAudit.js';
import { adminRateLimitsRouter } from './routes/admin.rateLimits.routes.js';
import { limit, limitConcurrent, addressKey, sessionKey } from './rateLimit/middleware.js';
import { adminServiceAccountsRouter } from './routes/admin.serviceAccounts.routes.js';
import { apiV1Router } from './routes/api.v1/index.js';
import { driverRouter } from './routes/driver.routes.js';
import { API_DOCS_DIR } from './apiDocs.js';
import { openLiveStream } from './services/liveUpdates.js';
import { currentTenantId } from './tenancy/context.js';

// Express's "trust proxy" setting from TRUST_PROXY: a hop count (1), true/false, or an address list.
// Unset leaves it off. Set it only to what really sits in front of the server: a wrong value lets
// a client claim any address it likes.
export function trustProxySetting(value) {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const WEBHOOK_PATH = /^\/api(\/t\/[^/]+)?\/payments\/(stripe|square)\/webhook$/;

// Requests the general limit leaves alone: payment provider webhooks (they come from the provider's
// addresses, and a refused one is retried for days) and the health check.
function exemptFromLimits(req) {
  const path = req.originalUrl.split('?')[0];
  return path === '/api/health' || WEBHOOK_PATH.test(path);
}

// Changes made without signing in, to the public pages' routes. Sign-in has its own rules.
function isPublicWrite(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  const path = req.originalUrl.split('?')[0];
  if (exemptFromLimits(req)) return false;
  return !/^\/api\/(admin|v1|auth|device-files|docs)(\/|$)/.test(path);
}

// Builds the REST API's Express app. Deliberately has no side effects
// (no listen(), no OCPP central system, no background timers) so it can be
// mounted standalone -- e.g. under supertest in the test suite.
export function createApp() {
  const app = express();
  // Behind a reverse proxy, every request seems to come from the proxy unless this names it. Rate
  // limits and the audit log rely on the real address. See docs/rate-limiting.md.
  const trustProxy = trustProxySetting(process.env.TRUST_PROXY);
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  // Read per request, so a change in the admin UI applies without a restart.
  app.use(cors({ origin: (origin, callback) => callback(null, allowedOrigins().has(origin)) }));
  // Rate limits (see rateLimit/rules.js). Before the body is read, so a flood is turned away cheaply.
  // Sign-in and code routes add their own, stricter limits.
  app.use('/api', limit('general.ip', addressKey, { skip: exemptFromLimits }));
  app.use('/api', limitConcurrent('liveStreams.ip', addressKey, { skip: (req) => !(req.method === 'GET' && /\/live$/.test(req.path)) }));
  app.use('/api', limit('publicWrite.ip', addressKey, { skip: (req) => !isPublicWrite(req) }));
  app.use(['/api/admin', '/api/v1'], limit('authenticated.session', (req) => sessionKey(req) ?? addressKey(req)));
  app.use('/api/device-files', limit('deviceFiles.ip', addressKey));
  // Must come before express.json() so the signature is checked against the raw bytes.
  app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
  app.post('/api/payments/square/webhook', express.raw({ type: 'application/json' }), squareWebhookHandler);
  // The same webhooks for a named site. Each site can point its provider at its own URL.
  app.post('/api/t/:slug/payments/stripe/webhook', tenantFromSlug, express.raw({ type: 'application/json' }), stripeWebhookHandler);
  app.post('/api/t/:slug/payments/square/webhook', tenantFromSlug, express.raw({ type: 'application/json' }), squareWebhookHandler);
  app.use(express.json());
  // Records changes and refused requests in the admin app and the API (see audit/httpAudit.js).
  app.use(['/api/admin', '/api/v1'], auditHttp);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/auth/code', signInCodeRouter);
  app.use('/api/auth/saml', samlRouter);
  app.use('/api/stations', stationsRouter);
  app.use('/api/zones', zonesRouter);
  // The charger locator across all sites (list, by site, and map points).
  app.use('/api/locator', locatorRouter);
  app.use('/api/notices', noticesRouter);
  app.use('/api/pricing', pricingRouter);
  app.use('/api/waitlist', waitlistRouter);
  // Driver accounts: the account's details and vehicles.
  app.use('/api/driver', driverRouter);
  // The public REST API. Its routes authenticate with API keys, not admin sessions.
  app.use('/api/v1', apiV1Router);
  // The Redocly reference for the API (built by npm run docs:api:build).
  app.use('/api/docs', express.static(API_DOCS_DIR));
  // Each area has a view and a manage permission. Reads need view, writes need manage.
  app.use('/api/admin/stations', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminStationsRouter);
  // Commands to charge points. Its own prefix, so viewers who can see stations are not blocked by it.
  app.use('/api/admin/station-commands', requireAdmin, requirePermission('stations.control'), adminStationCommandsRouter);
  // Firmware images and diagnostics logs (local disk). Reads need stations.view; changes need firmware.manage.
  app.use('/api/admin/firmware', requireAdmin, requireReadOrManage('stations.view', 'firmware.manage'), adminFirmwareRouter);
  // Addresses charge points use for firmware downloads and diagnostics uploads. No admin login.
  app.use('/api/device-files', deviceFilesRouter);
  // Billing: business details, customers, invoices, credit notes and receipts. Reads need payments.view; changes need payments.manage.
  app.use('/api/admin/billing', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminBillingRouter);
  app.use('/api/admin/tax-rules', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminTaxRulesRouter);
  // A driver's receipt, by the charge's unguessable token. No admin login.
  app.use('/api/receipts', publicReceiptsRouter);
  // The site's local authorization list (ID tags charge points may accept, or refuse, offline).
  app.use('/api/admin/local-list', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminLocalListRouter);
  // Webhook endpoints and their delivery log. Changes need integrations.manage.
  app.use('/api/admin/webhooks', requirePermission('integrations.manage'), adminWebhooksRouter);
  // Charging plans and their subscribers.
  app.use('/api/admin/subscriptions', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminSubscriptionsRouter);
  // Site supply shared across charge points with smart charging.
  app.use('/api/admin/load-balancing', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminLoadBalancingRouter);
  app.use('/api/admin/dashboard', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminDashboardRouter);
  app.use('/api/admin/zones', requireAdmin, requireReadOrManage('zones.view', 'zones.manage'), adminZonesRouter);
  // The site's own pin and address, and address lookup for the pin picker.
  app.use('/api/admin/locator', requireAdmin, requireReadOrManage('stations.view', 'stations.manage'), adminLocatorRouter);
  // Change notices for the admin app, pushed as they happen (see services/liveUpdates.js).
  app.get('/api/admin/live', requireAdmin, (req, res) => openLiveStream(req, res, { tenantId: currentTenantId() }));
  app.use('/api/settings', settingsRouter);
  app.use('/api/pay', payRouter);

  // The public, driver-facing routes for a named site, under /api/t/<slug>. The
  // un-prefixed routes above serve the default site.
  const sitePublicRouter = Router();
  sitePublicRouter.use('/auth/code', signInCodeRouter);
  sitePublicRouter.use('/auth/saml', samlRouter);
  sitePublicRouter.use('/stations', stationsRouter);
  sitePublicRouter.use('/zones', zonesRouter);
  sitePublicRouter.use('/locator', locatorRouter);
  sitePublicRouter.use('/notices', noticesRouter);
  sitePublicRouter.use('/pricing', pricingRouter);
  sitePublicRouter.use('/waitlist', waitlistRouter);
  sitePublicRouter.use('/driver', driverRouter);
  sitePublicRouter.use('/settings', settingsRouter);
  sitePublicRouter.use('/pay', payRouter);
  app.use('/api/t/:slug', tenantFromSlug, sitePublicRouter);
  app.use('/api/admin/settings', requirePermission('branding.manage'), adminSettingsRouter);
  app.use('/api/admin/templates', requirePermission('branding.manage'), adminTemplatesRouter);
  app.use('/api/admin/reports', requirePermission('reports.view'), adminReportsRouter);
  app.use('/api/admin/reports', requirePermission('reports.view'), adminUsageRouter);
  app.use('/api/admin/complaints', requireAdmin, requireReadOrManage('complaints.view', 'complaints.manage'), adminComplaintsRouter);
  app.use('/api/admin/audit', requireAdmin, adminAuditRouter);
  app.use('/api/admin/service-accounts', requireAdmin, requireReadOrManage('serviceAccounts.view', 'serviceAccounts.manage'), adminServiceAccountsRouter);
  app.use('/api/admin/users', requirePermission('users.manage'), adminUsersRouter);
  app.use('/api/admin/roles', requirePermission('users.manage'), adminRolesRouter);
  app.use('/api/admin/saml', requirePermission('sso.manage'), adminSamlRouter);
  app.use('/api/admin/setup', requirePermission('branding.manage'), adminSetupRouter);
  app.use('/api/admin/payments', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminPaymentsRouter);
  app.use('/api/admin/price-rules', requireAdmin, requireReadOrManage('payments.view', 'payments.manage'), adminPriceRulesRouter);
  app.use('/api/admin/alerts', requirePermission('alerts.manage'), adminAlertsRouter);
  app.use('/api/admin/integrations', requirePermission('integrations.manage'), adminIntegrationsRouter);
  app.use('/api/admin/wallet', requirePermission('wallet.manage'), adminWalletRouter);
  app.use('/api/admin/email', requirePermission('integrations.manage'), adminEmailRouter);
  app.use('/api/admin/sms', requirePermission('integrations.manage'), adminSmsRouter);
  app.use('/api/admin/system', requirePermission('system.manage'), adminSystemRouter);
  app.use('/api/admin/rate-limits', requirePermission('rateLimits.manage'), requireInstanceAdmin, adminRateLimitsRouter);
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
