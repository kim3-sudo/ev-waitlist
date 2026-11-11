import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { recordAudit } from '../audit/record.js';
import { consume, peek, record } from './limiter.js';
import { ensureFresh, ruleSettings } from './rules.js';

// Express middleware that enforces the rules in rules.js. A request over its limit gets
// 429 with Retry-After. The limits are read on each request, so a change an administrator
// saves applies at once. RATE_LIMIT_DISABLED=1 turns every rule off (the test suite uses it).

const AUDIT_EVERY_MS = 5 * 60 * 1000;
const auditedAt = new Map();

const disabled = () => process.env.RATE_LIMIT_DISABLED === '1';

// ---- who a request counts against ------------------------------------------------------------

// The address a request came from. IPv6 addresses are grouped by their first 64 bits, because
// one subscriber is normally given a whole /64 and could otherwise use a new address every time.
export function addressKey(req) {
  const raw = req.ip ?? req.socket?.remoteAddress ?? '';
  const ip = raw.replace(/^::ffff:/i, '');
  if (!ip.includes(':')) return ip || null;
  const [head, tail = ''] = ip.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...first, ...Array(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last] : first;
  return `v6:${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}`;
}

// The sign-in or API key on a request, as a short hash so the token itself is never kept.
export function sessionKey(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header) return null;
  return crypto.createHash('sha256').update(header).digest('hex').slice(0, 24);
}

// The e-mail address being signed in to.
export function emailKey(req) {
  const email = req.body?.email;
  if (typeof email !== 'string') return null;
  const clean = email.trim().toLowerCase();
  return clean && clean.length <= 254 ? clean : null;
}

// The account behind a pre-auth token. Only a token this server signed counts, so nobody can
// use up another account's attempts by sending a made-up one.
export function preAuthAccountKey(req) {
  const token = req.body?.preAuthToken;
  if (typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.type === 'mfa' ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

// ---- refusing --------------------------------------------------------------------------------

function setHeaders(res, info) {
  res.set('RateLimit-Limit', String(info.limit));
  res.set('RateLimit-Remaining', String(info.remaining));
}

function refuse(req, res, rule, info, { audit }) {
  const seconds = Math.max(1, Math.ceil(info.retryAfterMs / 1000));
  res.set('Retry-After', String(seconds));
  res.set('RateLimit-Limit', String(info.limit));
  res.set('RateLimit-Remaining', '0');
  res.set('RateLimit-Reset', String(seconds));
  if (audit) auditRefusal(req, res, rule, info.limit);
  return res.status(429).json({
    error: `Too many requests. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    code: 'RATE_LIMITED',
    retryAfterSeconds: seconds,
  });
}

// Recorded at most once every few minutes per rule and address, so an attack cannot fill the log.
function auditRefusal(req, res, rule, limit) {
  const who = addressKey(req) ?? 'unknown';
  const id = `${rule}|${who}`;
  const now = Date.now();
  if (now - (auditedAt.get(id) ?? 0) < AUDIT_EVERY_MS) return;
  auditedAt.set(id, now);
  if (auditedAt.size > 10_000) for (const [k, t] of auditedAt) if (now - t >= AUDIT_EVERY_MS) auditedAt.delete(k);
  recordAudit(
    {
      tenantId: null,
      actorType: 'ANONYMOUS',
      action: 'rateLimit.exceeded',
      targetType: 'rate_limit',
      targetLabel: rule,
      outcome: 'DENIED',
      reason: `Limit of ${limit} reached for ${rule}`,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
}

// ---- middleware ------------------------------------------------------------------------------

// Limits requests by `keyFn(req)`. A null key means the request is not counted by this rule.
//   mode 'all'       every request counts
//   mode 'failures'  only requests answered 401 count; a blocked key is refused before the handler runs
//   skip(req)        true to leave a request out
export function limit(rule, keyFn, { mode = 'all', audit = false, skip } = {}) {
  return async (req, res, next) => {
    let key;
    let settings;
    try {
      if (disabled() || skip?.(req)) return next();
      await ensureFresh();
      settings = ruleSettings(rule);
      if (!settings.enabled) return next();
      key = await keyFn(req);
    } catch (err) {
      // A fault in the limiter must not take the site down.
      console.error(`[rate-limit] ${rule} skipped:`, err.message);
      return next();
    }
    if (!key) return next();

    const options = { limit: settings.limit, windowMs: settings.windowMs };
    if (mode === 'failures') {
      const state = peek(rule, key, options);
      if (!state.allowed) return refuse(req, res, rule, state, { audit });
      res.on('finish', () => {
        if (res.statusCode === 401) record(rule, key, options);
      });
      return next();
    }

    const state = consume(rule, key, options);
    if (!state.allowed) return refuse(req, res, rule, state, { audit });
    setHeaders(res, state);
    next();
  };
}

// Caps how many responses one address can hold open at once (live-update streams).
const open = new Map();
export function limitConcurrent(rule, keyFn, { skip } = {}) {
  return async (req, res, next) => {
    let key;
    let settings;
    try {
      if (disabled() || skip?.(req)) return next();
      await ensureFresh();
      settings = ruleSettings(rule);
      if (!settings.enabled) return next();
      key = keyFn(req);
    } catch (err) {
      console.error(`[rate-limit] ${rule} skipped:`, err.message);
      return next();
    }
    if (!key) return next();

    const id = `${rule}|${key}`;
    const count = open.get(id) ?? 0;
    if (count >= settings.limit) {
      return refuse(req, res, rule, { limit: settings.limit, retryAfterMs: 5000 }, { audit: false });
    }
    open.set(id, count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (open.get(id) ?? 1) - 1;
      if (left <= 0) open.delete(id);
      else open.set(id, left);
    };
    res.on('close', release);
    next();
  };
}

export function resetOpenStreams() {
  open.clear();
  auditedAt.clear();
}
