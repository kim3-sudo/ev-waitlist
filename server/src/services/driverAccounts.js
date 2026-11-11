import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma, rawPrisma } from '../db.js';
import { currentTenantId } from '../tenancy/context.js';
import { resolvePermissions } from './roleService.js';
import { siteConfig } from './runtimeConfig.js';
import { deliverEmail, emailProblem } from './channels/email.js';
import { contactProblem } from './notifier.js';
import { looksLikeEmail, normalizePhone } from './contact.js';
import { CONNECTOR_STANDARDS } from '../ocpi/mappers.js';
import { DRIVER_PERMISSION, isDriverOnly } from '../auth/permissions.js';
import { readSessionToken, sessionIsCurrent, signSessionToken } from '../auth/sessionToken.js';

// Driver accounts are ordinary accounts (the Admin table) with the driver role, so they use the
// same sign-in tokens and permission checks as everyone else. A driver signs in with a one-time
// code sent by e-mail, or with a password they chose. An admin signs in on the admin page, with
// their password and two-factor code, and can also use the driver features.

export const DRIVER_ACCOUNT_MODES = ['OPTIONAL', 'REQUIRED'];

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const SESSION_TTL = '30d';

// The account a request is signed in as, if it is a driver on this site. Null for guests.
export async function signedInDriver(req) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  const payload = readSessionToken(token);
  if (!payload) return null;
  const account = await rawPrisma.admin.findUnique({ where: { id: payload.sub } });
  if (!account || account.tenantId !== currentTenantId() || !sessionIsCurrent(payload, account)) return null;
  const permissions = await resolvePermissions(account.role);
  return permissions.includes(DRIVER_PERMISSION) ? account : null;
}

// The name, and the contact a driver joins with. A signed-in driver's account fills in
// anything they leave blank. Returns { name, contact } or { error: { status, body } }.
export async function joinerDetails(req, body, settings) {
  const account = await signedInDriver(req);
  if (settings.driverAccounts === 'REQUIRED' && !account) {
    return { error: { status: 401, body: { error: 'Sign in to join the waitlist.', code: 'ACCOUNT_REQUIRED' } } };
  }

  const name = (typeof body?.name === 'string' ? body.name.trim() : '') || account?.name || '';
  const typed = typeof body?.contact === 'string' ? body.contact.trim() : '';
  const contact = typed || account?.email || '';

  if (!name) return { error: { status: 400, body: { error: 'name is required' } } };
  if (!contact && settings.waitlistContactRequired) {
    return {
      error: { status: 400, body: { error: 'Add an e-mail address so we can tell you when a charger is ready.' } },
    };
  }
  if (contact) {
    const problem = contactProblem(contact);
    if (problem) return { error: { status: 400, body: { error: problem } } };
  }
  return { name, contact, accountId: account?.id ?? null };
}

// A six-digit code, keyed to the site and the e-mail address, so a stored hash is useless alone.
function hashCode(tenantId, email, code) {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${tenantId}:${email}:${code}`).digest('hex');
}

// Makes a new code for this e-mail on this site, replacing any earlier one. Returns { code }
// or { limited: true } when too many were asked for in the last hour.
export async function issueSignInCode(email) {
  const tenantId = currentTenantId();
  const recent = await prisma.driverSignInCode.count({
    where: { email, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_CODES_PER_HOUR) return { limited: true };

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await prisma.driverSignInCode.deleteMany({ where: { email } });
  await prisma.driverSignInCode.create({
    data: { email, codeHash: hashCode(tenantId, email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return { code };
}

// Checks a code the driver typed, and uses it up when it is right. Wrong guesses count
// against the code, which stops working after too many.
export async function checkSignInCode(email, code) {
  const tenantId = currentTenantId();
  const row = await prisma.driverSignInCode.findFirst({
    where: { email, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;

  const expected = Buffer.from(hashCode(tenantId, email, String(code ?? '')));
  const stored = Buffer.from(row.codeHash);
  const matches = expected.length === stored.length && crypto.timingSafeEqual(expected, stored);
  if (!matches) {
    await prisma.driverSignInCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  await prisma.driverSignInCode.deleteMany({ where: { email } });
  return true;
}

// Sends the code by e-mail. Throws if the site cannot send e-mail or the send fails.
export async function sendSignInCode(email, code) {
  const cfg = siteConfig().email;
  const problem = emailProblem(cfg);
  if (problem) throw Object.assign(new Error(problem), { code: 'EMAIL_NOT_SET_UP' });
  await deliverEmail(cfg, {
    to: email,
    subject: 'Your sign-in code',
    text: `Your sign-in code is ${code}. It expires in 10 minutes. If you did not ask for it, you can ignore this e-mail.`,
  });
}

// The session a driver gets. The same shape as an admin sign-in, so the client handles both.
export async function driverSession(account) {
  const token = signSessionToken(account, SESSION_TTL);
  return {
    token,
    email: account.email,
    name: account.name ?? null,
    role: account.role,
    permissions: await resolvePermissions(account.role),
    mustChangePassword: false,
    instanceAdmin: false,
  };
}

// True when this account can sign in as a driver. Admin-capable accounts must use the admin sign-in.
export async function isDriverAccount(account) {
  return isDriverOnly(await resolvePermissions(account.role));
}

// A list of plugs a vehicle can charge with. Returns { value } or { error }.
export function plugsProblem(plugs) {
  if (!Array.isArray(plugs) || plugs.length === 0) return { error: 'Choose at least one plug this vehicle can charge with' };
  if (plugs.length > 20) return { error: 'Choose 20 plugs at most' };
  const unknown = plugs.find((p) => !CONNECTOR_STANDARDS.includes(p));
  if (unknown !== undefined) return { error: `Plug not recognised: ${String(unknown)}` };
  return { value: [...new Set(plugs)] };
}

export function vehicleView(vehicle) {
  let plugs = [];
  try {
    plugs = JSON.parse(vehicle.plugs);
  } catch {
    plugs = [];
  }
  return {
    id: vehicle.id,
    name: vehicle.name,
    make: vehicle.make ?? null,
    model: vehicle.model ?? null,
    licensePlate: vehicle.licensePlate ?? null,
    plugs,
  };
}

// A phone number a driver gives, checked. Returns { value } (null when blank) or { error }.
export function phoneProblem(text) {
  if (text === undefined || text === null || String(text).trim() === '') return { value: null };
  const phone = normalizePhone(String(text));
  if (!phone) return { error: 'Enter a mobile number with its country code, for example +1 555 123 4567.' };
  return { value: phone };
}
