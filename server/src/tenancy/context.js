import { AsyncLocalStorage } from 'node:async_hooks';

// The site that a single-site installation always uses. Fresh installs and
// upgraded installs both have this tenant, so single-site setups never need to
// choose or see a site.
export const DEFAULT_TENANT_ID = 'default';

const storage = new AsyncLocalStorage();

// Runs `fn` with `tenantId` as the current site and returns its result.
// Prisma queries are lazy: a call such as prisma.zone.create() only runs when
// it is awaited, so `fn` is awaited here, inside the store, rather than
// returning its promise for the caller to await later.
export function runWithTenant(tenantId, fn) {
  return storage.run({ tenantId }, async () => await fn());
}

// Sets the current site for everything that runs inside `fn`, without waiting
// for it. Used by middleware, where `fn` is the rest of the request.
export function enterTenant(tenantId, fn) {
  return storage.run({ tenantId }, fn);
}

// The site the current request, socket, or job is working on. Outside any
// scope this is the default site, which is correct for a single-site installation.
export function currentTenantId() {
  return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}
