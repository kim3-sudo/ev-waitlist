import { rawPrisma } from '../db.js';
import { enterTenant } from '../tenancy/context.js';
import { ensureSiteLoaded } from '../services/runtimeConfig.js';
import { hashToken } from '../ocpi/tokens.js';
import { KEY_PREFIX, parseAccountPermissions } from '../services/serviceAccountService.js';
import { recordAudit } from '../audit/record.js';
import { currentTenantId } from '../tenancy/context.js';

// Records a refused key. Only the key's public prefix is written, never the key itself.
function auditRefusedKey(req, res, token, reason, tenantId = currentTenantId()) {
  const prefix = /^pgk_([0-9a-f]{8})_/.exec(token)?.[1] ?? null;
  recordAudit(
    {
      tenantId,
      actorType: 'ANONYMOUS',
      action: 'api.auth',
      targetType: 'api_key',
      targetLabel: prefix ? `pgk_${prefix}…` : null,
      outcome: 'DENIED',
      reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
}

// How often a key's lastUsedAt is written. Writing on every request would make
// every API call a database write.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

// Authenticates a request made with a service account's API key
// ("Authorization: Bearer pgk_..."). The key's site decides which data the request
// can see. Sets req.admin in the same shape as a signed-in admin, so the existing
// route handlers work unchanged, and req.apiPermissions for the guards below.
export async function requireApiKey(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token?.startsWith(KEY_PREFIX)) {
    return res.status(401).json({
      error: 'Missing or malformed API key. Send it as "Authorization: Bearer <key>".',
      code: 'UNAUTHENTICATED',
    });
  }

  let key;
  try {
    key = await rawPrisma.apiKey.findUnique({
      where: { keyHash: hashToken(token) },
      include: { serviceAccount: true },
    });
  } catch (err) {
    return next(err);
  }

  const now = new Date();
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= now) || key.serviceAccount.disabled) {
    const reason = !key ? 'unknown key' : key.revokedAt ? 'revoked key' : key.serviceAccount.disabled ? 'disabled account' : 'expired key';
    auditRefusedKey(req, res, token, reason, key?.tenantId);
    return res.status(401).json({ error: 'Invalid, revoked, or expired API key', code: 'UNAUTHENTICATED' });
  }

  if (!key.lastUsedAt || now - key.lastUsedAt > LAST_USED_WRITE_INTERVAL_MS) {
    rawPrisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } }).catch(() => {});
  }

  const account = key.serviceAccount;
  const siteId = key.tenantId;
  const permissions = parseAccountPermissions(account.permissions);
  try {
    await ensureSiteLoaded(siteId);
  } catch (err) {
    return next(err);
  }

  enterTenant(siteId, async () => {
    req.admin = {
      sub: `service-account:${account.id}`,
      name: account.name,
      role: null,
      permissions,
      tenantId: siteId,
      homeTenantId: siteId,
      instanceAdmin: false,
      serviceAccountId: account.id,
    };
    req.apiPermissions = permissions;
    next();
  });
}

// Requires every listed API permission. Responds 403 with the ones that are missing.
export function requireApiPermission(...needed) {
  return (req, res, next) => {
    const missing = needed.filter((p) => !req.apiPermissions.includes(p));
    if (missing.length) {
      return res.status(403).json({ error: 'This API key does not allow this', code: 'FORBIDDEN', missing });
    }
    next();
  };
}

// Reads need the read permission; writes need the write permission. A resource
// with no write permission (write is null) is read-only, so other methods get 405.
export function apiAccess({ read, write }) {
  return (req, res, next) => {
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    if (isRead) return requireApiPermission(read)(req, res, next);
    if (!write) return res.status(405).json({ error: 'This resource is read-only through the API', code: 'METHOD_NOT_ALLOWED' });
    return requireApiPermission(write)(req, res, next);
  };
}
