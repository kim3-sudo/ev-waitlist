import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { getSettings } from '../services/settingsService.js';
import { resolvePermissions } from '../services/roleService.js';
import { driverSession, isDriverAccount } from '../services/driverAccounts.js';
import { requireAdmin, requireAdminAllowingPasswordChange } from './auth.middleware.js';
import { tenantForAdminEmail, tenantFromAdminToken } from '../tenancy/middleware.js';
import { recordAudit } from '../audit/record.js';
import { currentTenantId } from '../tenancy/context.js';
import { limit, addressKey, emailKey, preAuthAccountKey } from '../rateLimit/middleware.js';

// Sign-in events. Recorded with the e-mail the sign-in was attempted with, so a failed
// attempt on an unknown account can still be traced.
function auditSignIn(req, res, { admin, email, outcome, reason }) {
  recordAudit(
    {
      tenantId: admin?.tenantId ?? currentTenantId(),
      actorType: admin ? 'ADMIN' : 'ANONYMOUS',
      actorId: admin?.id ?? null,
      actorLabel: admin?.email ?? email ?? null,
      action: 'auth.login',
      targetType: 'admin',
      targetId: admin?.id ?? null,
      targetLabel: email ?? admin?.email ?? null,
      outcome,
      reason,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
}

export const authRouter = Router();

const MFA_TOKEN_TTL = '5m';

function issueSessionToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email, tenantId: admin.tenantId }, config.jwtSecret, { expiresIn: '12h' });
}

// Body returned whenever a full session is granted. The client uses
// mustChangePassword to send the admin to the forced passphrase change.
async function sessionBody(admin) {
  return {
    token: issueSessionToken(admin),
    email: admin.email,
    role: admin.role,
    permissions: await resolvePermissions(admin.role),
    mustChangePassword: admin.mustChangePassword,
    instanceAdmin: admin.instanceAdmin,
  };
}

function issuePreAuthToken(admin) {
  return jwt.sign({ sub: admin.id, type: 'mfa' }, config.jwtSecret, { expiresIn: MFA_TOKEN_TTL });
}

// Resolves the admin behind either a normal Bearer session token or a
// short-lived pre-auth token passed in the body (used while an MFA
// enrollment/verification step is still in progress and no full session
// exists yet). Returns { admin, preAuth } or null.
async function resolveAdminForMfaStep(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, bearerToken] = header.split(' ');
  if (scheme === 'Bearer' && bearerToken) {
    try {
      const payload = jwt.verify(bearerToken, config.jwtSecret);
      // A pre-auth token in the Bearer header must not count as a session.
      if (payload.type === undefined) {
        const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
        if (admin) return { admin, preAuth: false };
      }
    } catch {
      // fall through to preAuthToken
    }
  }

  const { preAuthToken } = req.body ?? {};
  if (preAuthToken) {
    try {
      const payload = jwt.verify(preAuthToken, config.jwtSecret);
      if (payload.type !== 'mfa') return null;
      const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
      if (admin) return { admin, preAuth: true };
    } catch {
      return null;
    }
  }

  return null;
}

// Limited by address (every attempt) and by account (wrong passwords only), so one address cannot
// try many passwords and many addresses cannot keep trying one account.
authRouter.post(
  '/login',
  limit('login.ip', addressKey, { audit: true }),
  limit('login.account', emailKey, { mode: 'failures', audit: true }),
  tenantForAdminEmail,
  async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // One sign-in for everyone. Admins (any account with more than the driver permission) get the
  // two-factor step; driver accounts sign in with the password alone.
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !admin.passwordHash || !(await bcrypt.compare(password, admin.passwordHash))) {
    auditSignIn(req, res, { admin: null, email, outcome: 'FAILED', reason: 'wrong e-mail or password' });
    return res.status(401).json({ error: 'Invalid e-mail address or password' });
  }
  if (await isDriverAccount(admin)) {
    auditSignIn(req, res, { admin, email, outcome: 'SUCCESS', reason: 'signed in' });
    return res.json(await driverSession(admin));
  }

  if (admin.mfaEnabled) {
    return res.json({ mfaRequired: true, preAuthToken: issuePreAuthToken(admin) });
  }

  const settings = await getSettings();
  if (settings.mfaRequired) {
    return res.json({ mfaSetupRequired: true, preAuthToken: issuePreAuthToken(admin) });
  }

  auditSignIn(req, res, { admin, email, outcome: 'SUCCESS', reason: 'signed in' });
  res.json(await sessionBody(admin));
});

authRouter.post(
  '/mfa/verify',
  limit('mfa.ip', addressKey, { audit: true }),
  limit('mfa.account', preAuthAccountKey, { mode: 'failures', audit: true }),
  tenantFromAdminToken,
  async (req, res) => {
  const { preAuthToken, code } = req.body ?? {};
  if (!preAuthToken || !code) {
    return res.status(400).json({ error: 'preAuthToken and code are required' });
  }

  let payload;
  try {
    payload = jwt.verify(preAuthToken, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (payload.type !== 'mfa') return res.status(401).json({ error: 'Invalid or expired session' });

  const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
  if (!admin?.mfaEnabled || !admin.mfaSecret || !authenticator.check(code, admin.mfaSecret)) {
    auditSignIn(req, res, { admin, email: admin?.email, outcome: 'FAILED', reason: 'wrong authentication code' });
    return res.status(401).json({ error: 'Invalid code' });
  }

  auditSignIn(req, res, { admin, email: admin.email, outcome: 'SUCCESS', reason: 'signed in with MFA' });
  res.json(await sessionBody(admin));
});

authRouter.post('/mfa/setup/start', tenantFromAdminToken, async (req, res) => {
  const resolved = await resolveAdminForMfaStep(req);
  if (!resolved) return res.status(401).json({ error: 'Not authenticated' });

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(resolved.admin.email, 'Plugyard', secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  res.json({ secret, qrCode });
});

authRouter.post('/mfa/setup/confirm', tenantFromAdminToken, async (req, res) => {
  const resolved = await resolveAdminForMfaStep(req);
  if (!resolved) return res.status(401).json({ error: 'Not authenticated' });

  // Replacing an existing second factor would let a password-only login take over the account.
  // To change the authenticator, turn MFA off first (which needs the password) and enrol again.
  if (resolved.admin.mfaEnabled) {
    return res.status(409).json({ error: 'Two-factor authentication is already on. Turn it off before setting it up again.' });
  }

  const { secret, code } = req.body ?? {};
  if (!secret || !code || !authenticator.check(code, secret)) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  const admin = await prisma.admin.update({
    where: { id: resolved.admin.id },
    data: { mfaSecret: secret, mfaEnabled: true },
  });

  // Forced first-login enrollment: complete the login in the same step.
  if (resolved.preAuth) {
    return res.json(await sessionBody(admin));
  }
  res.json({ ok: true });
});

authRouter.post('/mfa/disable', requireAdmin, async (req, res) => {
  const { password } = req.body ?? {};
  const admin = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!admin?.passwordHash || !password || !(await bcrypt.compare(password, admin.passwordHash))) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: { mfaSecret: null, mfaEnabled: false },
  });
  res.json({ ok: true });
});

authRouter.put('/password', requireAdminAllowingPasswordChange, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'newPassword must be different from the current password' });
  }

  const admin = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!admin?.passwordHash) {
    return res.status(400).json({ error: 'This account signs in via SSO and has no local password' });
  }
  if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    recordAudit({ tenantId: admin.tenantId, actorType: 'ADMIN', actorId: admin.id, actorLabel: admin.email, action: 'auth.password.change', targetType: 'admin', targetId: admin.id, targetLabel: admin.email, outcome: 'FAILED', reason: 'current password was wrong', ip: req.ip, userAgent: req.headers['user-agent'] }, { res });
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.admin.update({
    where: { id: admin.id },
    data: { passwordHash, mustChangePassword: false },
  });
  recordAudit({ tenantId: admin.tenantId, actorType: 'ADMIN', actorId: admin.id, actorLabel: admin.email, action: 'auth.password.change', targetType: 'admin', targetId: admin.id, targetLabel: admin.email, outcome: 'SUCCESS', reason: 'password changed', ip: req.ip, userAgent: req.headers['user-agent'] }, { res });
  res.json({ ok: true });
});

authRouter.get('/me', requireAdminAllowingPasswordChange, async (req, res) => {
  const admin = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!admin) return res.status(404).json({ error: 'Not found' });
  res.json({
    email: admin.email,
    role: admin.role,
    permissions: req.admin.permissions,
    mfaEnabled: admin.mfaEnabled,
    hasPassword: Boolean(admin.passwordHash),
    mustChangePassword: admin.mustChangePassword,
    instanceAdmin: admin.instanceAdmin,
    alertOnFault: admin.alertOnFault,
    alertOffline: admin.alertOffline,
  });
});

// The admin chooses which charge point alerts they receive by e-mail. Nobody else's choice changes.
authRouter.put('/alerts', requireAdminAllowingPasswordChange, async (req, res) => {
  const { alertOnFault, alertOffline } = req.body ?? {};
  const data = {};
  for (const [key, value] of [['alertOnFault', alertOnFault], ['alertOffline', alertOffline]]) {
    if (value === undefined) continue;
    if (typeof value !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` });
    data[key] = value;
  }
  const admin = await prisma.admin.update({ where: { id: req.admin.sub }, data });
  res.json({ alertOnFault: admin.alertOnFault, alertOffline: admin.alertOffline });
});
