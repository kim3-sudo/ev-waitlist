import { PrismaClient } from '@prisma/client';
import './loadRootEnv.js';
import { currentTenantId, DEFAULT_TENANT_ID } from './tenancy/context.js';

// Unscoped client. Use only for instance-level work (sites, the operator, the
// default-site bootstrap) and in tests. Everything else uses `prisma` below.
export const rawPrisma = new PrismaClient();

// Models whose rows belong to exactly one site. Connector is reached through
// Station, so it is not listed. Alert and PriceRule are not listed either: a
// network-wide row has no site, so they are filtered by hand (see tenancy/context.js
// ownOrNetworkWhere) and read through rawPrisma.
const TENANT_SCOPED_MODELS = new Set([
  'admin',
  'customRole',
  'serviceAccount',
  'apiKey',
  'zone',
  'station',
  'queueEntry',
  'reservation',
  'lineCuttingComplaint',
  'transaction',
  'charge',
  'idleEvent',
  'settings',
  'paymentSettings',
  'samlConfig',
  'configValue',
  'ocpiPartner',
  'ocpiToken',
  'ocpiOutbox',
  'paymentHold',
  'messageTemplate',
  'meterSample',
  'stationEvent',
  'driverVehicle',
  'driverSignInCode',
  'walletCredential',
]);

// Operations that take a `where` (other than the finds, which are matched by prefix).
const READ_OR_WRITE_WHERE = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy']);

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

// Adds the current site to a write's data. A write that names a different site
// is an error, so a bug can't move a row into another site silently.
function withTenant(data, tenantId) {
  if (data === undefined || data === null) return { tenantId };
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new Error(`Write for site ${data.tenantId} attempted in site ${tenantId}`);
  }
  return { ...data, tenantId };
}

// Restricts a query or update to the current site.
function scopeWhere(where, tenantId) {
  if (where?.tenantId !== undefined && where.tenantId !== tenantId) {
    throw new Error(`Query for site ${where.tenantId} attempted in site ${tenantId}`);
  }
  return { ...(where ?? {}), tenantId };
}

// Scoped client: every query on a tenant-scoped model is limited to the current
// site, and every create fills in that site.
export const prisma = rawPrisma.$extends({
  name: 'tenantScope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_SCOPED_MODELS.has(lowerFirst(model))) return query(args);

        const tenantId = currentTenantId();
        if (operation === 'create') {
          args.data = withTenant(args.data, tenantId);
        } else if (operation === 'createMany') {
          args.data = Array.isArray(args.data)
            ? args.data.map((d) => withTenant(d, tenantId))
            : withTenant(args.data, tenantId);
        } else if (operation === 'upsert') {
          args.where = scopeWhere(args.where, tenantId);
          args.create = withTenant(args.create, tenantId);
        } else if (READ_OR_WRITE_WHERE.has(operation) || operation.startsWith('find')) {
          args.where = scopeWhere(args.where, tenantId);
        }
        return query(args);
      },
    },
  },
});

// Creates the default site and the operator row if they are missing. Migrations
// create them for upgraded and fresh databases; this covers a database that was
// emptied, and keeps startup and tests from depending on migration history.
export async function ensureDefaultTenant() {
  await rawPrisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    create: { id: DEFAULT_TENANT_ID, slug: DEFAULT_TENANT_ID, name: 'Main site' },
    update: {},
  });
  await rawPrisma.operator.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
}
