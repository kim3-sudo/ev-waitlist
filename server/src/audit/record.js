import { rawPrisma } from '../db.js';
import { GENESIS_HASH, hashEvent } from './chain.js';
import { truncateIp } from './ipPolicy.js';
import { getAuditSettings } from './settings.js';

// Writes audit events. Two rules matter here:
//  - Events are appended one at a time, because each one has to chain onto the last.
//  - Recording never throws. If a write fails, the failure is logged with the action
//    that could not be recorded, and the request that caused it carries on.

const SECRET_FIELD = /secret|passw|passphrase|token|apikey|api_key|private|credential|keyhash/i;
const MAX_VALUE_LENGTH = 500;

const ACTOR_TYPES = ['ADMIN', 'SERVICE_ACCOUNT', 'ANONYMOUS', 'SYSTEM'];
const OUTCOMES = ['SUCCESS', 'DENIED', 'FAILED'];

let queue = Promise.resolve();
let failureCount = 0;
let lastFailure = null;

export function auditFailures() {
  return { count: failureCount, last: lastFailure };
}

// Replaces secret values with [set] or [cleared], and shortens long text. Applies to
// before/after pairs and to plain values alike.
export function redactChanges(changes) {
  if (changes === undefined || changes === null) return null;
  const scalar = (field, value) => {
    if (SECRET_FIELD.test(field)) {
      return value === '' || value === null || value === undefined ? '[cleared]' : '[set]';
    }
    if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) return `${value.slice(0, MAX_VALUE_LENGTH)}…`;
    return value;
  };
  const isPair = (value) =>
    value && typeof value === 'object' && !Array.isArray(value) && ('from' in value || 'to' in value) &&
    Object.keys(value).every((k) => k === 'from' || k === 'to');
  return Object.fromEntries(
    Object.entries(changes).map(([field, value]) => {
      if (isPair(value)) {
        return [field, { from: scalar(field, value.from), to: scalar(field, value.to) }];
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return [field, Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scalar(k, v)]))];
      }
      return [field, scalar(field, value)];
    }),
  );
}

function shorten(value, max) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

async function appendEvent(event) {
  const settings = await getAuditSettings();
  const last = await rawPrisma.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });

  const row = {
    seq: (last?.seq ?? 0) + 1,
    at: new Date(),
    tenantId: event.tenantId ?? null,
    actorType: ACTOR_TYPES.includes(event.actorType) ? event.actorType : 'SYSTEM',
    actorId: shorten(event.actorId, 191),
    actorLabel: shorten(event.actorLabel, 191),
    action: shorten(event.action, 120),
    targetType: shorten(event.targetType, 60),
    targetId: shorten(event.targetId, 191),
    targetLabel: shorten(event.targetLabel, 191),
    outcome: OUTCOMES.includes(event.outcome) ? event.outcome : 'SUCCESS',
    reason: shorten(event.reason, 300),
    changes: event.changes === undefined || event.changes === null ? null : JSON.stringify(redactChanges(event.changes)),
    ip: truncateIp(event.ip, settings.ipLogging),
    userAgent: shorten(event.userAgent, 300),
    requestId: shorten(event.requestId, 100),
    prevHash: last?.hash ?? GENESIS_HASH,
  };
  row.hash = hashEvent(row);
  return rawPrisma.auditEvent.create({ data: row });
}

// Records one event. Resolves to the stored row, or null if the write failed.
// Pass `res` for an HTTP request, so the HTTP-level recorder knows not to record it again.
export function recordAudit(event, { res } = {}) {
  if (res) res.locals.auditRecorded = true;
  const job = queue.then(() => appendEvent(event));
  // Keep the queue going even if this write fails.
  queue = job.catch(() => {});
  return job.catch((err) => {
    failureCount += 1;
    lastFailure = { action: event.action, at: new Date(), message: err.message };
    console.error(`[audit] could not record "${event.action}": ${err.message}`);
    return null;
  });
}

// Resolves once every event queued so far has been written. For tests and shutdown.
export function flushAudit() {
  return queue;
}
