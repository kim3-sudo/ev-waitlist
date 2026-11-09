import { readPageRequest, afterPosition, pageOf } from '../pagination.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { resolvePermissions, roleExists, missingPermissions } from '../services/roleService.js';
import { DRIVER_ROLE } from '../auth/permissions.js';

export const adminUsersRouter = Router();

function toDTO(admin) {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    hasPassword: Boolean(admin.passwordHash),
    mfaEnabled: admin.mfaEnabled,
    createdAt: admin.createdAt,
  };
}

// Counts accounts that would still hold users.manage. `overrides` maps an
// admin ID to its new role name, or to null if that account is being deleted.
async function countUserManagers(overrides = new Map()) {
  const admins = await prisma.admin.findMany({ select: { id: true, role: true } });
  const cache = new Map();
  let count = 0;
  for (const admin of admins) {
    if (overrides.has(admin.id) && overrides.get(admin.id) === null) continue;
    const role = overrides.has(admin.id) ? overrides.get(admin.id) : admin.role;
    if (!cache.has(role)) cache.set(role, await resolvePermissions(role));
    if (cache.get(role).includes('users.manage')) count += 1;
  }
  return count;
}

// You can only act on an account whose current role's permissions you all hold
// yourself. Otherwise a user manager could lock out, or delete, someone above them.
async function canActOn(callerPermissions, targetRole) {
  const targetPermissions = await resolvePermissions(targetRole);
  return missingPermissions(callerPermissions, targetPermissions).length === 0;
}

adminUsersRouter.get('/', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  // Driver accounts are the drivers' own; they are not listed with the people who run the site.
  const rows = await prisma.admin.findMany({
    where: { ...afterPosition(page.position, 'createdAt', { direction: 'asc', date: true }), role: { not: DRIVER_ROLE } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: page.limit + 1,
  });
  const result = pageOf(rows, page.limit, (a) => ({ v: a.createdAt.toISOString(), i: a.id }));
  res.json({ data: result.data.map(toDTO), nextCursor: result.nextCursor });
});

adminUsersRouter.post('/', async (req, res) => {
  const { email, password, role = 'VIEWER' } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!(await roleExists(role))) return res.status(400).json({ error: `Unknown role: ${role}` });

  const granted = await resolvePermissions(role);
  const missing = missingPermissions(req.admin.permissions, granted);
  if (missing.length) {
    return res.status(403).json({ error: "You can't give a role with permissions you don't have" });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const admin = await prisma.admin.create({
      data: {
        email,
        role,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
      },
    });
    res.status(201).json(toDTO(admin));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A user with that email already exists' });
    res.status(400).json({ error: err.message });
  }
});

adminUsersRouter.patch('/:id', async (req, res) => {
  const { resetMfa, role } = req.body ?? {};
  if (!resetMfa && role === undefined) return res.status(400).json({ error: 'Nothing to update' });
  if (role !== undefined && !(await roleExists(role))) {
    return res.status(400).json({ error: `Unknown role: ${role}` });
  }

  const target = await prisma.admin.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (!(await canActOn(req.admin.permissions, target.role))) {
    return res.status(403).json({ error: "You can't change a user whose role has permissions you don't have" });
  }

  if (role !== undefined && role !== target.role) {
    if (target.id === req.admin.sub) {
      return res.status(400).json({ error: "You can't change your own role" });
    }
    const granted = await resolvePermissions(role);
    if (missingPermissions(req.admin.permissions, granted).length) {
      return res.status(403).json({ error: "You can't give a role with permissions you don't have" });
    }
    const remaining = await countUserManagers(new Map([[target.id, role]]));
    if (remaining < 1) {
      return res.status(400).json({ error: "Can't remove user management from the last user manager" });
    }
  }

  const data = {};
  if (resetMfa) Object.assign(data, { mfaSecret: null, mfaEnabled: false });
  if (role !== undefined) data.role = role;

  const admin = await prisma.admin.update({ where: { id: target.id }, data });
  res.json(toDTO(admin));
});

adminUsersRouter.delete('/:id', async (req, res) => {
  if (req.params.id === req.admin.sub) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }

  const target = await prisma.admin.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!(await canActOn(req.admin.permissions, target.role))) {
    return res.status(403).json({ error: "You can't delete a user whose role has permissions you don't have" });
  }

  const count = await prisma.admin.count();
  if (count <= 1) {
    return res.status(400).json({ error: "Can't delete the last remaining user" });
  }
  const remaining = await countUserManagers(new Map([[target.id, null]]));
  if (remaining < 1) {
    return res.status(400).json({ error: "Can't delete the last user manager" });
  }

  await prisma.admin.delete({ where: { id: target.id } });
  res.status(204).end();
});
