// Watches each site's payment provider and records outages. While one is open, the
// site's outage mode decides what drivers get:
//   COMPLIMENTARY  charging is free for as long as the outage lasts (it is a price change
//                  for the sessions that overlap it, see priceRuleService.js)
//   LOCKOUT        no new waitlist joins, and no connector is offered to anyone waiting.
//                  Sessions already under way are not interrupted.
//
// The provider is probed once a minute with a harmless read-only call. An outage opens
// after FAILURES_TO_OPEN failed checks in a row, so one blip does not lock anyone out.
// The first successful check closes it.
import { rawPrisma } from '../../db.js';
import { currentTenantId, runWithTenant } from '../../tenancy/context.js';
import { ensureSiteLoaded, siteConfig } from '../runtimeConfig.js';
import { isProviderConfigured, getStripe, getBraintreeGateway, getSquare } from './providers.js';

export const OUTAGE_MODES = ['COMPLIMENTARY', 'LOCKOUT'];
export const CHECK_INTERVAL_MS = 60_000;
const FAILURES_TO_OPEN = 2;
const PROBE_TIMEOUT_MS = 8_000;
export const LOCKOUT_MESSAGE = 'Joining the waitlist is paused while the payment system is unavailable. Please try again soon.';

// Consecutive failed checks, per site and provider.
const failures = new Map();

function braintreeClientToken() {
  return new Promise((resolve, reject) => {
    getBraintreeGateway().clientToken.generate({}, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

// One read-only call to the provider. Resolves when it works, rejects when it does not.
async function defaultProbe(provider) {
  switch (provider) {
    case 'STRIPE':
      return getStripe().balance.retrieve();
    case 'BRAINTREE':
      return braintreeClientToken();
    case 'SQUARE':
      return getSquare().locations.get({ locationId: siteConfig().square.locationId });
    default:
      throw new Error(`No health check for ${provider}`);
  }
}

let probe = defaultProbe;

// Tests only: replace the provider call.
export function setProviderProbeForTests(fn) {
  probe = fn;
}

export function resetProviderOutagesForTests() {
  probe = defaultProbe;
  failures.clear();
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The provider did not answer in time')), PROBE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function shortReason(err) {
  return String(err?.message ?? err ?? 'Unknown error').slice(0, 200);
}

// The site's open outage, if any.
export async function currentOutage(tenantId = currentTenantId()) {
  return rawPrisma.providerOutage.findFirst({
    where: { tenantId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
}

async function modeOf(tenantId) {
  const settings = await rawPrisma.paymentSettings.findUnique({
    where: { tenantId },
    select: { providerOutageMode: true },
  });
  return settings?.providerOutageMode ?? 'LOCKOUT';
}

async function endOpenOutages(tenantId, provider = null) {
  await rawPrisma.providerOutage.updateMany({
    where: { tenantId, endedAt: null, ...(provider ? { NOT: { provider } } : {}) },
    data: { endedAt: new Date() },
  });
}

// Runs one health check for the current site. Returns the open outage after the check,
// or null. The site's provider must be configured for a check to mean anything.
export async function checkProviderNow() {
  const tenantId = currentTenantId();
  const settings = await rawPrisma.paymentSettings.findUnique({ where: { tenantId }, select: { provider: true } });
  const provider = settings?.provider ?? 'NONE';
  const key = `${tenantId}|${provider}`;

  if (provider === 'NONE' || !isProviderConfigured(provider)) {
    failures.delete(key);
    await endOpenOutages(tenantId);
    return null;
  }
  // A provider change ends an outage of the old provider.
  await endOpenOutages(tenantId, provider);

  let error = null;
  try {
    await withTimeout(probe(provider));
  } catch (err) {
    error = err;
  }

  const open = await currentOutage(tenantId);
  if (!error) {
    failures.delete(key);
    if (open) await rawPrisma.providerOutage.update({ where: { id: open.id }, data: { endedAt: new Date() } });
    return null;
  }

  const count = (failures.get(key) ?? 0) + 1;
  failures.set(key, count);
  if (open) return open;
  if (count < FAILURES_TO_OPEN) return null;
  return rawPrisma.providerOutage.create({
    data: { tenantId, provider, reason: shortReason(error) },
  });
}

// Checks every site, and calls onRecovered(tenantId) for each site whose outage just ended.
export async function checkAllSites(onRecovered = async () => {}) {
  const tenants = await rawPrisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    try {
      await ensureSiteLoaded(tenant.id);
      await runWithTenant(tenant.id, async () => {
        const before = await currentOutage(tenant.id);
        await checkProviderNow();
        const after = await currentOutage(tenant.id);
        if (before && !after) await onRecovered(tenant.id);
      });
    } catch (err) {
      console.error(`Payment provider check failed for site ${tenant.id}:`, err);
    }
  }
}

// Starts the one-minute health checks. onRecovered(tenantId) runs when an outage ends, so
// connectors that were held back can be offered again.
export function startProviderHealthChecks(onRecovered) {
  return setInterval(() => {
    checkAllSites(onRecovered).catch((err) => console.error('Payment provider checks failed:', err));
  }, CHECK_INTERVAL_MS);
}

// True while new waitlist joins and connector offers must stop for the current site.
export async function lockedOut(tenantId = currentTenantId()) {
  if ((await modeOf(tenantId)) !== 'LOCKOUT') return false;
  return Boolean(await currentOutage(tenantId));
}

// The outages that overlap a session, as complimentary price changes, when the site's
// mode is COMPLIMENTARY. Empty otherwise.
export async function complimentaryOutagesDuring(tenantId, startedAt, stoppedAt) {
  if ((await modeOf(tenantId)) !== 'COMPLIMENTARY') return [];
  const rows = await rawPrisma.providerOutage.findMany({
    where: {
      tenantId,
      startedAt: { lt: stoppedAt },
      OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
    },
  });
  return rows.map((row) => ({
    id: `outage-${row.id}`,
    kind: 'COMPLIMENTARY',
    scope: 'SITE',
    tenantId,
    zoneId: null,
    stationId: null,
    powerClass: null,
    percent: null,
    label: 'Payment system unavailable',
    startsAt: row.startedAt,
    endsAt: row.endedAt,
  }));
}

// What the admin sees: the mode, and the open outage if there is one.
export async function outageStatus(tenantId = currentTenantId()) {
  const open = await currentOutage(tenantId);
  return {
    mode: await modeOf(tenantId),
    current: open ? { provider: open.provider, since: open.startedAt, reason: open.reason } : null,
  };
}

// The notice drivers see on the waitlist page, or null when no outage is open.
export async function paymentOutageNotice(tenantId = currentTenantId()) {
  const open = await currentOutage(tenantId);
  if (!open) return null;
  return { mode: await modeOf(tenantId), since: open.startedAt };
}
