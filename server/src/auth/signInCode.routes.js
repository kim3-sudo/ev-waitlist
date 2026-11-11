import { Router } from 'express';
import { limit, addressKey } from '../rateLimit/middleware.js';
import { prisma, rawPrisma } from '../db.js';
import { DRIVER_ROLE } from './permissions.js';
import { currentTenantId } from '../tenancy/context.js';
import { siteConfig } from '../services/runtimeConfig.js';
import { emailProblem } from '../services/channels/email.js';
import { looksLikeEmail } from '../services/contact.js';
import { cleanText } from '../services/locator.js';
import {
  checkSignInCode,
  driverSession,
  isDriverAccount,
  issueSignInCode,
  sendSignInCode,
} from '../services/driverAccounts.js';

// Sign-in with a one-time code e-mailed to the address. Mounted at /api/auth/code for the
// default site and /api/t/<slug>/auth/code for a named one. A new e-mail address gets a driver
// account. Accounts with admin permissions are refused here: they sign in with a password and
// two-factor code at /api/auth/login, so the second factor cannot be skipped.
export const signInCodeRouter = Router();

// Requests for a code, and codes typed in, share one limit per address. The code itself already
// allows 5 wrong tries, and 5 requests an hour per e-mail address (services/driverAccounts.js).
signInCodeRouter.use(limit('signInCode.ip', addressKey, { audit: true }));

const CODE_PATTERN = /^\d{6}$/;

function trimmedEmail(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Asks for a code. The reply is the same whether or not the e-mail has an account, so the
// page cannot be used to find out who has one.
signInCodeRouter.post('/request', async (req, res) => {
  const email = trimmedEmail(req.body?.email);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
  if (emailProblem(siteConfig().email)) {
    return res.status(503).json({
      error: "Sign-in codes can't be sent from this site yet. Sign in with your password instead.",
      code: 'EMAIL_NOT_SET_UP',
    });
  }

  const issued = await issueSignInCode(email);
  if (issued.limited) return res.status(429).json({ error: 'Too many codes were asked for. Try again in an hour.' });
  try {
    await sendSignInCode(email, issued.code);
  } catch {
    return res.status(502).json({ error: 'The code could not be sent. Try again in a moment.' });
  }
  res.json({ sent: true });
});

// Signs in with the code. A new e-mail address gets a driver account.
signInCodeRouter.post('/verify', async (req, res) => {
  const email = trimmedEmail(req.body?.email);
  const code = String(req.body?.code ?? '').trim();
  if (!looksLikeEmail(email) || !CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: 'Enter the six-digit code we e-mailed you' });
  }
  const name = cleanText(req.body?.name, 'Name', 100);
  if (name.error) return res.status(400).json({ error: name.error });

  if (!(await checkSignInCode(email, code))) {
    return res.status(401).json({ error: 'That code is not right or has expired. Ask for a new one.' });
  }

  const existing = await rawPrisma.admin.findUnique({ where: { email } });
  if (existing && existing.tenantId !== currentTenantId()) {
    return res.status(409).json({ error: 'This e-mail address already has an account on another site.' });
  }

  let account = existing;
  if (account) {
    if (!(await isDriverAccount(account))) {
      return res.status(403).json({
        error: 'This account has admin permissions. Sign in with your password instead.',
        code: 'PASSWORD_SIGN_IN_REQUIRED',
      });
    }
    if (!account.name && name.value) {
      account = await prisma.admin.update({ where: { id: account.id }, data: { name: name.value } });
    }
  } else {
    account = await prisma.admin.create({
      data: { email, role: DRIVER_ROLE, name: name.value ?? null, passwordHash: null },
    });
  }
  res.json(await driverSession(account));
});
