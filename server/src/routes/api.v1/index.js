import { readPageRequest, afterPosition, pageOf } from '../../pagination.js';
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../db.js';
import { API_DOCS_DIR } from '../../apiDocs.js';
import { requireApiKey, requireApiPermission, apiAccess } from '../../auth/apiKey.middleware.js';
import { getQueueStatus } from '../../services/queueService.js';
import { cancelQueueEntry } from '../../services/dispatcher.js';
import { adminStationsRouter } from '../admin.stations.routes.js';
import { adminStationCommandsRouter } from '../admin.stationCommands.routes.js';
import { adminZonesRouter } from '../admin.zones.routes.js';
import { adminPriceRulesRouter } from '../admin.priceRules.routes.js';
import { adminAlertsRouter } from '../admin.alerts.routes.js';
import { adminReportsRouter } from '../admin.reports.routes.js';
import { adminUsageRouter } from '../admin.usage.routes.js';

// The REST API, version 1, mounted at /api/v1. Every route except the spec needs an
// API key (see auth/apiKey.middleware.js). The site is the key's site.
//
// Most resources reuse the admin routers, so the API and the admin pages behave the
// same. The waitlist and charge endpoints are written here, because they must not
// expose driver details (names, contact numbers, payment links).
export const apiV1Router = Router();

// The OpenAPI document is public, so anyone can read the reference before getting a key.
apiV1Router.get('/openapi.json', (req, res) => {
  const file = path.join(API_DOCS_DIR, 'openapi.json');
  if (!fs.existsSync(file)) {
    return res.status(503).json({ error: 'The API reference has not been built. Run npm run docs:api:build.' });
  }
  res.type('application/json').sendFile(file);
});

apiV1Router.use(requireApiKey);

apiV1Router.get('/me', async (req, res) => {
  const site = await prisma.tenant.findUnique({ where: { id: req.admin.tenantId }, select: { slug: true, name: true } });
  res.json({
    serviceAccount: { id: req.admin.serviceAccountId, name: req.admin.name },
    site: site ? { slug: site.slug, name: site.name } : null,
    permissions: req.apiPermissions,
  });
});

// Commands to a charge point: stopping sessions, unlock, reset, availability,
// configuration, holds. They need the control permission, not just write.
const COMMAND_PATH = /^\/[^/]+\/(transactions\/|trigger$|reset$|clear-cache$|configuration(\/|$)|connectors\/[^/]+\/(unlock|availability|hold)$|holds\/)/;

function stationAccess(req, res, next) {
  if (COMMAND_PATH.test(req.path)) return requireApiPermission('api.stations.control')(req, res, next);
  return apiAccess({ read: 'api.stations.read', write: 'api.stations.write' })(req, res, next);
}

// Waitlist entries carry driver details on the admin side. The API returns only
// the position and status, so it can show a line without naming anyone in it.
function serializeWaitlistEntry(entry, position = null) {
  const matchedStation = entry.reservation?.station ?? entry.station;
  return {
    id: entry.id,
    status: entry.status,
    stationId: entry.stationId,
    zoneId: entry.zoneId,
    stationName: matchedStation?.name ?? null,
    position,
    reservation: entry.reservation
      ? { connectorId: entry.reservation.connectorId, status: entry.reservation.status, expiresAt: entry.reservation.expiresAt }
      : null,
    createdAt: entry.createdAt,
  };
}

apiV1Router.get('/stations/:id/waitlist', requireApiPermission('api.waitlist.read'), async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  const station = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!station) return res.status(404).json({ error: 'Charge point not found' });
  const rows = await prisma.queueEntry.findMany({
    where: {
      AND: [{ stationId: station.id, status: { in: ['WAITING', 'NOTIFIED'] } }, afterPosition(page.position, 'position', { direction: 'asc' })],
    },
    include: { reservation: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: page.limit + 1,
  });
  const result = pageOf(rows, page.limit, (e) => ({ v: e.position, i: e.id }));
  const data = await Promise.all(
    result.data.map(async (entry) => {
      // Place in line among waiting drivers, so the number is the same whichever page it is on.
      const ahead = entry.status === 'WAITING'
        ? await prisma.queueEntry.count({ where: { stationId: station.id, status: 'WAITING', position: { lt: entry.position } } })
        : null;
      return serializeWaitlistEntry(entry, ahead === null ? null : ahead + 1);
    }),
  );
  res.json({ data, nextCursor: result.nextCursor });
});

apiV1Router.get('/waitlist/:id', requireApiPermission('api.waitlist.read'), async (req, res) => {
  const result = await getQueueStatus(req.params.id);
  if (!result) return res.status(404).json({ error: 'Waitlist entry not found' });
  res.json(serializeWaitlistEntry(result.entry, result.position));
});

apiV1Router.delete('/waitlist/:id', requireApiPermission('api.waitlist.manage'), async (req, res) => {
  const existing = await prisma.queueEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Waitlist entry not found' });
  await cancelQueueEntry(existing.id);
  res.status(204).end();
});

// Complaints without the driver's name or contact details. Only the driver's
// waitlist status is included.
function serializeComplaint(complaint) {
  return {
    id: complaint.id,
    status: complaint.status,
    note: complaint.note,
    createdAt: complaint.createdAt,
    resolvedAt: complaint.resolvedAt,
    station: { id: complaint.station.id, name: complaint.station.name },
    queueEntry: { id: complaint.queueEntry.id, status: complaint.queueEntry.status },
  };
}

apiV1Router.get('/complaints', requireApiPermission('api.complaints.read'), async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  const rows = await prisma.lineCuttingComplaint.findMany({
    where: afterPosition(page.position, 'createdAt', { date: true }),
    include: { station: true, queueEntry: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
  });
  const result = pageOf(rows, page.limit, (c) => ({ v: c.createdAt.toISOString(), i: c.id }));
  res.json({ data: result.data.map(serializeComplaint), nextCursor: result.nextCursor });
});

// Complaints are resolved in the admin app; the API only reads them.
apiV1Router.all('/complaints', requireApiPermission('api.complaints.read'), (req, res) => {
  res.status(405).json({ error: 'Complaints are read-only through the API', code: 'METHOD_NOT_ALLOWED' });
});

// Charges without payer details or payment links.
function serializeCharge(charge) {
  return {
    id: charge.id,
    stationId: charge.stationId,
    transactionId: charge.transactionId,
    status: charge.status,
    pricingModel: charge.pricingModel,
    pricingNote: charge.pricingNote,
    currency: charge.currency,
    amountCents: charge.amountCents,
    durationSeconds: charge.durationSeconds,
    energyWh: charge.energyWh,
    provider: charge.provider,
    paidAt: charge.paidAt,
    createdAt: charge.createdAt,
  };
}

apiV1Router.get('/charges', requireApiPermission('api.charges.read'), async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  const status = typeof req.query.status === 'string' && req.query.status ? { status: req.query.status } : {};
  const rows = await prisma.charge.findMany({
    where: { AND: [status, afterPosition(page.position, 'createdAt', { date: true })] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
  });
  const result = pageOf(rows, page.limit, (c) => ({ v: c.createdAt.toISOString(), i: c.id }));
  res.json({ data: result.data.map(serializeCharge), nextCursor: result.nextCursor });
});

apiV1Router.get('/charges/:id', requireApiPermission('api.charges.read'), async (req, res) => {
  const charge = await prisma.charge.findUnique({ where: { id: req.params.id } });
  if (!charge) return res.status(404).json({ error: 'Charge not found' });
  res.json(serializeCharge(charge));
});

// Steps of the admin app's add-charge-point wizard. They are not part of the API.
apiV1Router.all(['/stations/identity-check', '/stations/test-connection/:step'], (req, res) => {
  res.status(404).json({ error: `No API endpoint at ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' });
});

// Stations are mounted before the commands router: each request is checked against
// the permission for its path, then handled by whichever router owns the path.
apiV1Router.use('/stations', stationAccess, adminStationsRouter);
apiV1Router.use('/stations', stationAccess, adminStationCommandsRouter);
apiV1Router.use('/zones', apiAccess({ read: 'api.zones.read', write: 'api.zones.write' }), adminZonesRouter);
apiV1Router.use('/price-rules', apiAccess({ read: 'api.priceRules.read', write: 'api.priceRules.write' }), adminPriceRulesRouter);
apiV1Router.use('/alerts', apiAccess({ read: 'api.alerts.read', write: 'api.alerts.write' }), adminAlertsRouter);
apiV1Router.use('/reports', apiAccess({ read: 'api.reports.read', write: null }), adminReportsRouter);
apiV1Router.use('/reports', apiAccess({ read: 'api.reports.read', write: null }), adminUsageRouter);

// Anything not matched above. Returned as JSON, so clients never receive an HTML page.
apiV1Router.use((req, res) => {
  res.status(404).json({ error: `No API endpoint at ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' });
});
