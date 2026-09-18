import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { getSettings } from '../services/settingsService.js';
import { requireAdmin } from './auth.middleware.js';

export const authRouter = Router();

const MFA_TOKEN_TTL = '5m';

function issueSessionToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email }, config.jwtSecret, { expiresIn: '12h' });
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
      const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
      if (admin) return { admin, preAuth: false };
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

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !admin.passwordHash || !(await bcrypt.compare(password, admin.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (admin.mfaEnabled) {
    return res.json({ mfaRequired: true, preAuthToken: issuePreAuthToken(admin) });
  }

  const settings = await getSettings();
  if (settings.mfaRequired) {
    return res.json({ mfaSetupRequired: true, preAuthToken: issuePreAuthToken(admin) });
  }

  res.json({ token: issueSessionToken(admin), email: admin.email });
});

authRouter.post('/mfa/verify', async (req, res) => {
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
    return res.status(401).json({ error: 'Invalid code' });
  }

  res.json({ token: issueSessionToken(admin), email: admin.email });
});

authRouter.post('/mfa/setup/start', async (req, res) => {
  const resolved = await resolveAdminForMfaStep(req);
  if (!resolved) return res.status(401).json({ error: 'Not authenticated' });

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(resolved.admin.email, 'EV Waitlist', secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  res.json({ secret, qrCode });
});

authRouter.post('/mfa/setup/confirm', async (req, res) => {
  const resolved = await resolveAdminForMfaStep(req);
  if (!resolved) return res.status(401).json({ error: 'Not authenticated' });

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
    return res.json({ token: issueSessionToken(admin), email: admin.email });
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

authRouter.put('/password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }

  const admin = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!admin?.passwordHash) {
    return res.status(400).json({ error: 'This account signs in via SSO and has no local password' });
  }
  if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } });
  res.json({ ok: true });
});

authRouter.get('/me', requireAdmin, async (req, res) => {
  const admin = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!admin) return res.status(404).json({ error: 'Not found' });
  res.json({ email: admin.email, mfaEnabled: admin.mfaEnabled, hasPassword: Boolean(admin.passwordHash) });
});
