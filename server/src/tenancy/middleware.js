import { rawPrisma } from '../db.js';
import { verifyToken } from '../auth/sessionToken.js';
import { enterTenant } from './context.js';
import { ensureSiteLoaded } from '../services/runtimeConfig.js';

// Each middleware here sets the current site for the rest of the request.
// Lookups that happen before a site is known use the unscoped client, because
// the record that says which site a row belongs to is the thing being looked up.

// Routes under /api/t/:slug. Unknown slugs are refused.
export async function tenantFromSlug(req, res, next) {
  const { slug } = req.params;
  let tenant;
  try {
    tenant = await rawPrisma.tenant.findUnique({ where: { slug }, select: { id: true, slug: true } });
  } catch (err) {
    return next(err);
  }
  if (!tenant) return res.status(404).json({ error: 'Site not found' });
  await ensureSiteLoaded(tenant.id);
  req.tenantId = tenant.id;
  req.tenantSlug = tenant.slug;
  enterTenant(tenant.id, () => next());
}

// Public payment links are looked up by their unguessable token, which is
// global, so the site comes from the charge itself. Unknown tokens fall through
// so the route's own "not found" response is used.
export async function tenantForChargeToken(req, res, next) {
  return tenantFromRow(rawPrisma.charge, { token: req.params.token }, next);
}

// Card-hold links work the same way: the token alone identifies the site.
export async function tenantForHoldToken(req, res, next) {
  return tenantFromRow(rawPrisma.paymentHold, { token: req.params.token }, next);
}

// Waitlist entries are looked up by id. The site comes from the entry.
export async function tenantForQueueEntry(req, res, next) {
  return tenantFromRow(rawPrisma.queueEntry, { id: req.params.id }, next);
}

async function tenantFromRow(model, where, next) {
  let row;
  try {
    row = await model.findUnique({ where, select: { tenantId: true } });
  } catch (err) {
    return next(err);
  }
  if (!row) return next();
  await ensureSiteLoaded(row.tenantId);
  enterTenant(row.tenantId, () => next());
}

// Admin sessions carry the admin's site. Used before requireAdmin runs, for the
// pre-auth MFA steps, where the token is in the Bearer header or the body.
export async function tenantFromAdminToken(req, res, next) {
  const candidates = [];
  const header = req.headers.authorization ?? '';
  const [scheme, bearer] = header.split(' ');
  if (scheme === 'Bearer' && bearer) candidates.push(bearer);
  if (req.body?.preAuthToken) candidates.push(req.body.preAuthToken);

  for (const token of candidates) {
    const payload = verifyToken(token);
    if (!payload) continue;
    const admin = await rawPrisma.admin.findUnique({ where: { id: payload.sub }, select: { tenantId: true } });
    if (admin) {
      await ensureSiteLoaded(admin.tenantId);
      return enterTenant(admin.tenantId, () => next());
    }
  }
  return next();
}

// Used by the admin login, where the admin is found by email.
export async function tenantForAdminEmail(req, res, next) {
  const email = req.body?.email;
  if (!email) return next();
  return tenantFromRow(rawPrisma.admin, { email }, next);
}
