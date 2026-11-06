import { createHash, randomBytes } from 'node:crypto';

// OCPI puts a token in the Authorization header as "Token <base64 of the token>".
// Tokens we issue are random strings; only their SHA-256 hash is stored.

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(plain) {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

export function encodeForHeader(plain) {
  return Buffer.from(plain, 'utf8').toString('base64');
}

// Returns the plain token from an Authorization header, or null if the header is
// not a Token header with valid base64.
export function tokenFromHeader(header) {
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.trim().split(/\s+/);
  if (scheme !== 'Token' || !value) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const plain = Buffer.from(value, 'base64').toString('utf8');
  return plain || null;
}
