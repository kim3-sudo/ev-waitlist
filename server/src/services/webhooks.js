import crypto from 'node:crypto';
import { rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { encryptSecret, decryptSecret } from '../utils/secretBox.js';
import { safeRequest, urlProblem as addressUrlProblem } from '../utils/safeHttp.js';

// Webhooks: the server posts events to the URLs an admin registers. Every post is signed with the
// endpoint's secret, so the receiver can check it came from this server. Each delivery is retried with
// growing waits, and given up after MAX_ATTEMPTS. Events are written to the database in the same
// step as the change they describe, so a delivery is never lost to a crash in between.

export const EVENT_TYPES = [
  'charge.paid',
  'charge.reversed',
  'transaction.started',
  'transaction.stopped',
  'station.faulted',
  'invoice.issued',
  'subscription.started',
  'subscription.cancelled',
  'webhook.test',
];

export const MAX_ATTEMPTS = 10;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 6 * 3600 * 1000;

// The wait before retry number `attempts` (1 minute, then 2, 4, ... up to six hours).
export function backoffMs(attempts) {
  return Math.min(MAX_WAIT_MS, 60_000 * 2 ** Math.max(0, attempts - 1));
}

// The endpoint's secret is a random value shown once, when the endpoint is created.
export function newSecret() {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

// Whether an endpoint's event list covers this event type. "*" covers everything.
export function eventMatches(list, type) {
  const wanted = String(list ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
  return wanted.includes('*') || wanted.includes(type);
}

export function parseEvents(input) {
  const list = Array.isArray(input) ? input : String(input ?? '*').split(',');
  const clean = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  if (clean.length === 0) return { error: 'Choose at least one event, or * for all' };
  if (clean.includes('*')) return { value: '*' };
  const unknown = clean.filter((t) => !EVENT_TYPES.includes(t));
  if (unknown.length) return { error: `Unknown event type: ${unknown.join(', ')}` };
  return { value: clean.join(',') };
}

const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === '1';

// Checks a destination when it is saved. It must be https, with no user name or password, and must
// not name a private or loopback address, so the server cannot be used to reach the internal
// network. Operators who run receivers on private networks can allow that with
// WEBHOOK_ALLOW_PRIVATE_NETWORKS=1. A name that points at a private address is caught later, when
// the post is sent (see utils/safeHttp.js), because DNS can change after this check.
export function urlProblem(url) {
  return addressUrlProblem(url, { allowPrivate: allowPrivate() });
}

// The signature header: t=<unix seconds>,v1=<HMAC-SHA256 of "<t>.<body>" with the secret>.
export function signPayload(secret, body, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

// Checks a received signature against a body, for receivers (and tests). Rejects stale timestamps.
export function verifySignature(secret, body, header, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const parts = Object.fromEntries(String(header ?? '').split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = signPayload(secret, body, t);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Writes one delivery row per matching active endpoint. Called from the code that made the change.
export async function emitEvent(type, data = {}, tenantId = currentTenantId()) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown webhook event ${type}`);
  const endpoints = await rawPrisma.webhookEndpoint.findMany({ where: { tenantId, active: true } });
  const matching = endpoints.filter((e) => eventMatches(e.events, type));
  if (matching.length === 0) return null;
  const eventId = `evt_${crypto.randomBytes(12).toString('hex')}`;
  const payload = JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), data });
  await rawPrisma.webhookDelivery.createMany({
    data: matching.map((e) => ({ tenantId, endpointId: e.id, eventId, eventType: type, payload })),
  });
  return eventId;
}

// Posts to the endpoint's address. Resolves the name itself and refuses private addresses, does not
// follow redirects, and gives up on a slow or oversized reply. Answers like fetch: { status }.
async function postSafely(url, init) {
  const { status } = await safeRequest(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: 64 * 1024,
    allowPrivate: allowPrivate(),
  });
  return { status };
}

async function sendOnce(endpoint, delivery, fetchImpl) {
  const secret = decryptSecret(endpoint.secret);
  const timestamp = Math.floor(Date.now() / 1000);
  const body = delivery.payload;
  const response = await fetchImpl(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Plugyard-Webhooks/1.0',
      'X-Plugyard-Event': delivery.eventType,
      'X-Plugyard-Delivery': delivery.id,
      'X-Plugyard-Signature': signPayload(secret, body, timestamp),
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.status;
}

// Sends the deliveries that are due. Run on a timer. Returns how many were attempted.
export async function dispatchWebhookDeliveries({ now = new Date(), limit = 50, fetchImpl = postSafely } = {}) {
  const due = await rawPrisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: { endpoint: true },
  });
  for (const delivery of due) {
    const endpoint = delivery.endpoint;
    if (!endpoint.active) {
      await rawPrisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', lastError: 'The endpoint is turned off' } });
      continue;
    }
    const attempts = delivery.attempts + 1;
    try {
      const status = await sendOnce(endpoint, delivery, fetchImpl);
      if (status >= 200 && status < 300) {
        await rawPrisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'DELIVERED', attempts, lastStatusCode: status, lastError: null, deliveredAt: new Date() },
        });
      } else {
        await recordFailure(delivery, attempts, `The endpoint answered ${status}`, status, now);
      }
    } catch (err) {
      await recordFailure(delivery, attempts, err.name === 'TimeoutError' ? 'The endpoint did not answer in time' : `Could not reach the endpoint (${err.message})`, null, now);
    }
  }
  return due.length;
}

async function recordFailure(delivery, attempts, error, statusCode, now) {
  const giveUp = attempts >= MAX_ATTEMPTS;
  await rawPrisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      lastStatusCode: statusCode,
      lastError: error,
      status: giveUp ? 'FAILED' : 'PENDING',
      nextAttemptAt: giveUp ? delivery.nextAttemptAt : new Date(now.getTime() + backoffMs(attempts)),
    },
  });
}

// Keeps deliveries going. Started once from the server entry point.
export function startWebhookDispatcher() {
  return setInterval(() => {
    dispatchWebhookDeliveries().catch((err) => console.error('[webhooks] dispatch failed:', err.message));
  }, 30_000);
}

export function encryptNewSecret(plain) {
  return encryptSecret(plain);
}
