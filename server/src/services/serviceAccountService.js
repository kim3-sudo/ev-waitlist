import { afterPosition, pageOf } from '../pagination.js';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { newToken, hashToken } from '../ocpi/tokens.js';
import { SERVICE_ACCOUNT_PERMISSION_KEYS } from '../auth/permissions.js';

// Service accounts and API keys for the REST API (/api/v1).
//
// A key looks like pgk_<8 hex characters>_<random>. The hex part is shown in the
// admin UI so keys can be told apart; the whole key is hashed (SHA-256) before it
// is stored, so a database leak does not expose working keys.

export const KEY_PREFIX = 'pgk_';
export const KEY_NAME_MAX = 60;
export const ACCOUNT_DESCRIPTION_MAX = 200;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;

export function parseAccountPermissions(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((p) => SERVICE_ACCOUNT_PERMISSION_KEYS.includes(p)) : [];
  } catch {
    return [];
  }
}

export function generateApiKey() {
  const prefix = randomBytes(4).toString('hex');
  const plain = `${KEY_PREFIX}${prefix}_${newToken()}`;
  return { plain, prefix, hash: hashToken(plain) };
}

export function keyStatus(key, now = new Date()) {
  if (key.revokedAt) return 'REVOKED';
  if (key.expiresAt && key.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

function serializeKey(key) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    status: keyStatus(key),
    createdAt: key.createdAt,
    expiresAt: key.expiresAt ?? null,
    revokedAt: key.revokedAt ?? null,
    lastUsedAt: key.lastUsedAt ?? null,
  };
}

export function serializeAccount(account) {
  return {
    id: account.id,
    name: account.name,
    description: account.description ?? '',
    permissions: parseAccountPermissions(account.permissions),
    disabled: account.disabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    keys: (account.keys ?? []).map(serializeKey).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}

// Validates a create or update payload. Returns { value } or { error }.
// Permissions must be API permissions: people's permissions cannot be given to an account.
export function validateAccountInput({ name, description, permissions, disabled }, { requireName = true } = {}) {
  const value = {};
  if (name !== undefined || requireName) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!NAME_PATTERN.test(trimmed)) {
      return { error: 'Name must be 1-40 letters, numbers, spaces, dots, hyphens, or underscores' };
    }
    value.name = trimmed;
  }
  if (description !== undefined) {
    value.description = typeof description === 'string' ? description.trim().slice(0, ACCOUNT_DESCRIPTION_MAX) : '';
  }
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) return { error: 'permissions must be a list' };
    const unknown = permissions.find((p) => !SERVICE_ACCOUNT_PERMISSION_KEYS.includes(p));
    if (unknown !== undefined) {
      return { error: `"${unknown}" is not an API permission. Service accounts can only hold API permissions.` };
    }
    value.permissions = [...new Set(permissions)];
  }
  if (disabled !== undefined) {
    if (typeof disabled !== 'boolean') return { error: 'disabled must be true or false' };
    value.disabled = disabled;
  }
  return { value };
}

export function validateKeyInput({ name, expiresAt }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > KEY_NAME_MAX) {
    return { error: `Key name is required (up to ${KEY_NAME_MAX} characters)` };
  }
  let expires = null;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    expires = new Date(expiresAt);
    if (Number.isNaN(expires.getTime())) return { error: 'expiresAt must be a date and time' };
    if (expires <= new Date()) return { error: 'expiresAt must be in the future' };
  }
  return { value: { name: trimmed, expiresAt: expires } };
}

export async function listServiceAccounts({ limit, position }) {
  const rows = await prisma.serviceAccount.findMany({
    where: afterPosition(position, 'name', { direction: 'asc' }),
    include: { keys: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const page = pageOf(rows, limit, (a) => ({ v: a.name, i: a.id }));
  return { data: page.data.map(serializeAccount), nextCursor: page.nextCursor };
}

export async function getServiceAccount(id) {
  const account = await prisma.serviceAccount.findUnique({ where: { id }, include: { keys: true } });
  return account ? serializeAccount(account) : null;
}

export async function findAccountRow(id) {
  return prisma.serviceAccount.findUnique({ where: { id }, include: { keys: true } });
}

export async function createServiceAccount(value, { adminId }) {
  const account = await prisma.serviceAccount.create({
    data: {
      name: value.name,
      description: value.description ?? null,
      permissions: JSON.stringify(value.permissions ?? []),
      disabled: value.disabled ?? false,
      createdBy: adminId ?? null,
    },
    include: { keys: true },
  });
  return serializeAccount(account);
}

export async function updateServiceAccount(id, value) {
  const data = {
    ...(value.name !== undefined && { name: value.name }),
    ...(value.description !== undefined && { description: value.description || null }),
    ...(value.permissions !== undefined && { permissions: JSON.stringify(value.permissions) }),
    ...(value.disabled !== undefined && { disabled: value.disabled }),
  };
  const account = await prisma.serviceAccount.update({ where: { id }, data, include: { keys: true } });
  return serializeAccount(account);
}

export async function deleteServiceAccount(id) {
  // Keys go with the account (cascade).
  await prisma.serviceAccount.delete({ where: { id } });
}

// Creates a key. The plain key is returned once and never stored.
export async function issueApiKey(accountId, { name, expiresAt }) {
  const { plain, prefix, hash } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: { serviceAccountId: accountId, name, prefix, keyHash: hash, expiresAt: expiresAt ?? null },
  });
  return { plainKey: plain, key: serializeKey(key) };
}

// Revokes a key. Returns false if the key is not on this account.
export async function revokeApiKey(accountId, keyId) {
  const key = await prisma.apiKey.findFirst({ where: { id: keyId, serviceAccountId: accountId } });
  if (!key) return false;
  if (!key.revokedAt) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  }
  return true;
}
