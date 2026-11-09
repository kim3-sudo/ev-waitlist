import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { rawPrisma } from '../db.js';
import { resolvePermissions } from '../services/roleService.js';
import { enterTenant } from '../tenancy/context.js';
import { ensureSiteLoaded } from '../services/runtimeConfig.js';
import { DRIVER_PERMISSION, PERMISSION_KEYS, isDriverOnly } from './permissions.js';

// Verifies the Bearer session token and loads the admin it belongs to, along
// with the permissions of their role. Accounts that must still change their
// first-run passphrase are rejected everywhere except the password-change
// endpoint (allowPasswordChange).
//
// The admin's row decides which site the request works in. A token that names
// a different site than the row is refused.
// `driverRoute` marks the driver pages, the only ones a driver-only account may use. Every
// admin route refuses such an account, so a driver never reaches admin data.
async function verifySession(req, res, next, { allowPasswordChange, driverRoute = false }) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  let admin;
  try {
    admin = await rawPrisma.admin.findUnique({
      where: { id: payload.sub },
      select: { mustChangePassword: true, role: true, tenantId: true, instanceAdmin: true },
    });
  } catch (err) {
    return next(err);
  }
  if (!admin) return res.status(401).json({ error: 'Invalid or expired token' });
  // Tokens issued before sites existed carry no site; they belong to the default site.
  if (payload.tenantId !== undefined && payload.tenantId !== admin.tenantId) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (admin.mustChangePassword && !allowPasswordChange) {
    return res.status(403).json({
      error: 'You must change your passphrase before continuing',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }

  // The installation administrator may act on another site by naming it in the
  // X-Site header (a site slug). Everyone else works only in their own site.
  let siteId = admin.tenantId;
  let actingInOtherSite = false;
  const requestedSite = req.headers['x-site'];
  if (admin.instanceAdmin && requestedSite && requestedSite !== '') {
    const site = await rawPrisma.tenant.findUnique({ where: { slug: String(requestedSite) }, select: { id: true } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    siteId = site.id;
    actingInOtherSite = siteId !== admin.tenantId;
  }

  // Role and permissions come from the database, not the token, so a change
  // takes effect on the next request. Roles belong to a site, so they are read
  // inside the admin's home site. In another site the installation administrator
  // holds every permission.
  await ensureSiteLoaded(siteId);
  enterTenant(siteId, async () => {
    try {
      const permissions = actingInOtherSite ? PERMISSION_KEYS : await resolvePermissions(admin.role);
      if (!driverRoute && isDriverOnly(permissions)) {
        return res.status(403).json({ error: 'This is a driver account. Use the driver pages.', code: 'DRIVER_ACCOUNT' });
      }
      req.admin = {
        ...payload,
        role: admin.role,
        permissions,
        tenantId: siteId,
        homeTenantId: admin.tenantId,
        instanceAdmin: admin.instanceAdmin,
      };
    } catch (err) {
      return next(err);
    }
    next();
  });
}

export function requireAdmin(req, res, next) {
  return verifySession(req, res, next, { allowPasswordChange: false });
}

// Requires a signed-in admin holding every listed permission.
export function requirePermission(...permissions) {
  return (req, res, next) =>
    verifySession(req, res, (err) => {
      if (err) return next(err);
      const missing = permissions.filter((p) => !req.admin.permissions.includes(p));
      if (missing.length) {
        return res.status(403).json({ error: 'Your role does not allow this', missing });
      }
      next();
    }, { allowPasswordChange: false });
}

// Only the installation administrator (the first admin, who set up the software).
// Mount after requirePermission.
export function requireInstanceAdmin(req, res, next) {
  if (!req.admin?.instanceAdmin) {
    return res.status(403).json({ error: 'Only the installation administrator can do this' });
  }
  next();
}

// Read methods need `view`; every other method needs `manage`. Mount after requireAdmin.
export function requireReadOrManage(view, manage) {
  return (req, res, next) => {
    const needed = req.method === 'GET' || req.method === 'HEAD' ? view : manage;
    if (!req.admin.permissions.includes(needed)) {
      return res.status(403).json({ error: 'Your role does not allow this' });
    }
    next();
  };
}

// A signed-in driver (any account that holds the driver permission, admins included).
export function requireDriver(req, res, next) {
  return verifySession(
    req,
    res,
    (err) => {
      if (err) return next(err);
      if (!req.admin.permissions.includes(DRIVER_PERMISSION)) {
        return res.status(403).json({ error: 'This account cannot use driver features' });
      }
      next();
    },
    { allowPasswordChange: false, driverRoute: true },
  );
}

// Only for the endpoints needed to finish a forced password change.
export function requireAdminAllowingPasswordChange(req, res, next) {
  return verifySession(req, res, next, { allowPasswordChange: true });
}
