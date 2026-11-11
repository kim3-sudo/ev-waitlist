import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { rawPrisma } from '../db.js';

// Session tokens: who signed in, and the account's sessionVersion at that moment. Raising the
// version (password change, "sign out everywhere", an administrator revoking sessions) makes every
// older token fail, because verification compares the two.

export const ALGORITHM = 'HS256';

export function signSessionToken(admin, expiresIn = '12h') {
  return jwt.sign(
    { sub: admin.id, email: admin.email, tenantId: admin.tenantId, sv: admin.sessionVersion ?? 0 },
    config.jwtSecret,
    { algorithm: ALGORITHM, expiresIn },
  );
}

// Short-lived token that only says "the password was right, the second factor is next".
export function signPreAuthToken(admin, expiresIn = '5m') {
  return jwt.sign({ sub: admin.id, type: 'mfa' }, config.jwtSecret, { algorithm: ALGORITHM, expiresIn });
}

// The payload of a token this server signed, or null. Only the one algorithm is accepted.
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM] });
  } catch {
    return null;
  }
}

// The payload of a session token (not a pre-auth or other typed token), or null.
export function readSessionToken(token) {
  const payload = verifyToken(token);
  return payload && payload.type === undefined ? payload : null;
}

// True when a session token was made with the account's current sessionVersion. Tokens made before
// versions existed carry none, which counts as 0.
export function sessionIsCurrent(payload, admin) {
  return (payload.sv ?? 0) === (admin.sessionVersion ?? 0);
}

// Signs the account out everywhere. Returns the account with its new version, so the caller can
// give the current device a fresh token and keep it signed in.
export async function revokeSessions(adminId, client = rawPrisma) {
  return client.admin.update({ where: { id: adminId }, data: { sessionVersion: { increment: 1 } } });
}

// ---- one-time codes for SAML single sign-on ------------------------------------------------

const SSO_CODE_TTL_MS = 60_000;
const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');

// Makes a code the browser can trade for a session once, within a minute.
export async function issueSsoCode(adminId) {
  const code = crypto.randomBytes(32).toString('base64url');
  await rawPrisma.ssoLoginCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await rawPrisma.ssoLoginCode.create({
    data: { codeHash: hashCode(code), adminId, expiresAt: new Date(Date.now() + SSO_CODE_TTL_MS) },
  });
  return code;
}

// Uses up a code. Returns the account id, or null if the code is unknown, used, or expired.
export async function consumeSsoCode(code) {
  if (typeof code !== 'string' || code.length < 20 || code.length > 100) return null;
  const codeHash = hashCode(code);
  const row = await rawPrisma.ssoLoginCode.findUnique({ where: { codeHash } });
  if (!row) return null;
  // Deleting is the claim: only one of two simultaneous requests sees a count of 1.
  const { count } = await rawPrisma.ssoLoginCode.deleteMany({ where: { id: row.id } });
  if (count !== 1 || row.expiresAt.getTime() < Date.now()) return null;
  return row.adminId;
}
