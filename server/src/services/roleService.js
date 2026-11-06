import { prisma } from '../db.js';
import { BUILT_IN_ROLES, BUILT_IN_ROLE_NAMES, PERMISSION_KEYS } from '../auth/permissions.js';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

function parsePermissions(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((p) => PERMISSION_KEYS.includes(p)) : [];
  } catch {
    return [];
  }
}

// Permission keys for a role name. Unknown names (e.g. a role deleted while
// someone still holds it) grant nothing.
// A custom role in the current site, by name. Names are unique per site, not globally.
export function findCustomRole(name) {
  return prisma.customRole.findFirst({ where: { name } });
}

export async function resolvePermissions(roleName) {
  if (BUILT_IN_ROLE_NAMES.includes(roleName)) return BUILT_IN_ROLES[roleName].permissions;
  const custom = await findCustomRole(roleName);
  return custom ? parsePermissions(custom.permissions) : [];
}

export async function roleExists(roleName) {
  if (BUILT_IN_ROLE_NAMES.includes(roleName)) return true;
  return Boolean(await findCustomRole(roleName));
}

export async function listRoles() {
  const custom = await prisma.customRole.findMany({ orderBy: { name: 'asc' } });
  const counts = await prisma.admin.groupBy({ by: ['role'], _count: { _all: true } });
  const countFor = (name) => counts.find((c) => c.role === name)?._count._all ?? 0;

  const builtIn = BUILT_IN_ROLE_NAMES.map((name) => ({
    name,
    description: BUILT_IN_ROLES[name].description,
    permissions: BUILT_IN_ROLES[name].permissions,
    builtIn: true,
    userCount: countFor(name),
  }));
  const customRows = custom.map((role) => ({
    name: role.name,
    description: role.description ?? '',
    permissions: parsePermissions(role.permissions),
    builtIn: false,
    userCount: countFor(role.name),
  }));
  return [...builtIn, ...customRows];
}

// Validates a name/description/permissions payload. Returns { value } or { error }.
export function validateRoleInput({ name, description, permissions }, { requireName = true } = {}) {
  const value = {};
  if (name !== undefined || requireName) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!NAME_PATTERN.test(trimmed)) {
      return { error: 'Role name must be 1-40 letters, numbers, spaces, hyphens, or underscores' };
    }
    if (BUILT_IN_ROLE_NAMES.includes(trimmed.toUpperCase()) || BUILT_IN_ROLE_NAMES.includes(trimmed)) {
      return { error: `"${trimmed}" is a built-in role name` };
    }
    value.name = trimmed;
  }
  if (description !== undefined) {
    value.description = typeof description === 'string' ? description.trim().slice(0, 200) : '';
  }
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) return { error: 'permissions must be a list' };
    const unknown = permissions.filter((p) => !PERMISSION_KEYS.includes(p));
    if (unknown.length) return { error: `Unknown permission: ${unknown[0]}` };
    value.permissions = [...new Set(permissions)];
  }
  return { value };
}

// A grantor may only hand out permissions they hold, so nobody can use a role
// to climb above their own access.
export function missingPermissions(grantorPermissions, requested) {
  return requested.filter((p) => !grantorPermissions.includes(p));
}

export async function createRole(data) {
  return prisma.customRole.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      permissions: JSON.stringify(data.permissions ?? []),
    },
  });
}

export async function updateRole(name, data) {
  const row = await findCustomRole(name);
  if (!row) return null;
  return prisma.customRole.update({
    where: { id: row.id },
    data: {
      ...(data.description !== undefined && { description: data.description || null }),
      ...(data.permissions !== undefined && { permissions: JSON.stringify(data.permissions) }),
    },
  });
}
