import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { resolvePermissions } from '../services/roleService.js';

// Verifies the Bearer session token and loads the admin it belongs to, along
// with the permissions of their role. Accounts that must still change their
// first-run passphrase are rejected everywhere except the password-change
// endpoint (allowPasswordChange).
async function verifySession(req, res, next, { allowPasswordChange }) {
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
    admin = await prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { mustChangePassword: true, role: true },
    });
  } catch (err) {
    return next(err);
  }
  if (!admin) return res.status(401).json({ error: 'Invalid or expired token' });

  if (admin.mustChangePassword && !allowPasswordChange) {
    return res.status(403).json({
      error: 'You must change your passphrase before continuing',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }

  // Role and permissions come from the database, not the token, so a change
  // takes effect on the next request.
  try {
    const permissions = await resolvePermissions(admin.role);
    req.admin = { ...payload, role: admin.role, permissions };
  } catch (err) {
    return next(err);
  }
  next();
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

// Only for the endpoints needed to finish a forced password change.
export function requireAdminAllowingPasswordChange(req, res, next) {
  return verifySession(req, res, next, { allowPasswordChange: true });
}
