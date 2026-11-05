import { Router } from 'express';
import { prisma } from '../db.js';
import { PERMISSIONS } from '../auth/permissions.js';
import {
  listRoles,
  validateRoleInput,
  missingPermissions,
  createRole,
  updateRole,
  resolvePermissions,
} from '../services/roleService.js';

// Mounted behind users.manage. Custom roles only; built-in roles are read-only.
export const adminRolesRouter = Router();

adminRolesRouter.get('/', async (req, res) => {
  res.json({ roles: await listRoles(), permissions: PERMISSIONS, callerPermissions: req.admin.permissions });
});

adminRolesRouter.post('/', async (req, res) => {
  const { value, error } = validateRoleInput(req.body ?? {});
  if (error) return res.status(400).json({ error });
  if (missingPermissions(req.admin.permissions, value.permissions ?? []).length) {
    return res.status(403).json({ error: "You can't grant permissions you don't have" });
  }

  try {
    const row = await createRole({ ...value, permissions: value.permissions ?? [] });
    res.status(201).json({ name: row.name, description: row.description ?? '', permissions: value.permissions ?? [] });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A role with that name already exists' });
    throw err;
  }
});

adminRolesRouter.patch('/:name', async (req, res) => {
  const name = req.params.name;
  const existing = await prisma.customRole.findUnique({ where: { name } });
  if (!existing) return res.status(404).json({ error: 'Role not found' });

  const { value, error } = validateRoleInput(
    { description: req.body?.description, permissions: req.body?.permissions },
    { requireName: false },
  );
  if (error) return res.status(400).json({ error });

  // You can't edit a role above your own access, nor grant permissions you lack.
  const current = await resolvePermissions(name);
  if (missingPermissions(req.admin.permissions, current).length) {
    return res.status(403).json({ error: "You can't edit a role with permissions you don't have" });
  }
  if (value.permissions && missingPermissions(req.admin.permissions, value.permissions).length) {
    return res.status(403).json({ error: "You can't grant permissions you don't have" });
  }

  const row = await updateRole(name, value);
  res.json({ name: row.name, description: row.description ?? '', permissions: value.permissions ?? current });
});

adminRolesRouter.delete('/:name', async (req, res) => {
  const name = req.params.name;
  const existing = await prisma.customRole.findUnique({ where: { name } });
  if (!existing) return res.status(404).json({ error: 'Role not found' });

  const current = await resolvePermissions(name);
  if (missingPermissions(req.admin.permissions, current).length) {
    return res.status(403).json({ error: "You can't delete a role with permissions you don't have" });
  }
  const assigned = await prisma.admin.count({ where: { role: name } });
  if (assigned > 0) {
    return res.status(400).json({ error: `Move the ${assigned} user(s) with this role to another role first` });
  }

  await prisma.customRole.delete({ where: { name } });
  res.status(204).end();
});
