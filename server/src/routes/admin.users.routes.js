import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';

export const adminUsersRouter = Router();

function toDTO(admin) {
  return {
    id: admin.id,
    email: admin.email,
    hasPassword: Boolean(admin.passwordHash),
    mfaEnabled: admin.mfaEnabled,
    createdAt: admin.createdAt,
  };
}

adminUsersRouter.get('/', async (req, res) => {
  const admins = await prisma.admin.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(admins.map(toDTO));
});

adminUsersRouter.post('/', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (password && password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const admin = await prisma.admin.create({
      data: {
        email,
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
  const { resetMfa } = req.body ?? {};
  if (!resetMfa) return res.status(400).json({ error: 'Nothing to update' });

  try {
    const admin = await prisma.admin.update({
      where: { id: req.params.id },
      data: { mfaSecret: null, mfaEnabled: false },
    });
    res.json(toDTO(admin));
  } catch {
    res.status(404).json({ error: 'User not found' });
  }
});

adminUsersRouter.delete('/:id', async (req, res) => {
  if (req.params.id === req.admin.sub) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }

  const count = await prisma.admin.count();
  if (count <= 1) {
    return res.status(400).json({ error: "Can't delete the last remaining user" });
  }

  try {
    await prisma.admin.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'User not found' });
  }
});
