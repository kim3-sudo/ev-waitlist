import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma, rawPrisma } from '../db.js';
import { requireDriver } from '../auth/auth.middleware.js';
import { DRIVER_ROLE } from '../auth/permissions.js';
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
  phoneProblem,
  plugsProblem,
  sendSignInCode,
  vehicleView,
} from '../services/driverAccounts.js';

// Driver accounts: sign-in with a one-time code or a password, the account's details, and its
// vehicles. Mounted at /api/driver for the default site and /api/t/<slug>/driver for a named one.
export const driverRouter = Router();

const CODE_PATTERN = /^\d{6}$/;

function trimmedEmail(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Asks for a code. The reply is the same whether or not the e-mail has an account, so the
// page cannot be used to find out who has one.
driverRouter.post('/code/request', async (req, res) => {
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
driverRouter.post('/code/verify', async (req, res) => {
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
        error: 'This e-mail address belongs to an admin account. Sign in with your password on the admin sign-in page.',
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

// Signs in with a password the driver chose. Admin accounts use the admin sign-in, with two-factor.
driverRouter.post('/login', async (req, res) => {
  const email = trimmedEmail(req.body?.email);
  const password = req.body?.password;
  if (!email || !password) return res.status(400).json({ error: 'Enter your e-mail address and password' });

  const account = await rawPrisma.admin.findUnique({ where: { email } });
  const ok =
    account &&
    account.tenantId === currentTenantId() &&
    account.passwordHash &&
    (await bcrypt.compare(String(password), account.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Invalid e-mail address or password' });
  if (!(await isDriverAccount(account))) {
    return res.status(403).json({ error: 'This is an admin account. Sign in on the admin sign-in page.' });
  }
  res.json(await driverSession(account));
});

driverRouter.get('/me', requireDriver, async (req, res) => {
  const account = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const vehicles = await prisma.driverVehicle.findMany({ where: { ownerId: account.id }, orderBy: { createdAt: 'asc' } });
  res.json({
    email: account.email,
    name: account.name ?? null,
    phone: account.phone ?? null,
    hasPassword: Boolean(account.passwordHash),
    vehicles: vehicles.map(vehicleView),
  });
});

driverRouter.put('/me', requireDriver, async (req, res) => {
  const name = cleanText(req.body?.name, 'Name', 100);
  if (name.error) return res.status(400).json({ error: name.error });
  const phone = phoneProblem(req.body?.phone);
  if (phone.error) return res.status(400).json({ error: phone.error });

  const data = {
    ...(name.value !== undefined && { name: name.value }),
    ...(req.body?.phone !== undefined && { phone: phone.value }),
  };
  const account = await prisma.admin.update({ where: { id: req.admin.sub }, data });
  res.json({ name: account.name ?? null, phone: account.phone ?? null });
});

// Sets a password, or changes it. Changing one needs the current password.
driverRouter.put('/password', requireDriver, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }
  const account = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.passwordHash) {
    if (!currentPassword || !(await bcrypt.compare(String(currentPassword), account.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }
  await prisma.admin.update({
    where: { id: account.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  res.json({ ok: true });
});

// Checks a vehicle form. On an update, fields that were not sent are left out.
function vehicleFields(body, { creating }) {
  const out = {};
  const name = cleanText(body?.name, 'Vehicle name', 60);
  if (name.error) return { error: name.error };
  if (creating && !name.value) return { error: 'Give the vehicle a name, for example "My IONIQ 5"' };
  if (name.value !== undefined) out.name = name.value;

  for (const [key, label, max] of [['make', 'Make', 60], ['model', 'Model', 60], ['licensePlate', 'License plate', 20]]) {
    const result = cleanText(body?.[key], label, max);
    if (result.error) return { error: result.error };
    if (result.value !== undefined) out[key] = result.value;
  }

  if (body?.plugs !== undefined || creating) {
    const plugs = plugsProblem(body?.plugs);
    if (plugs.error) return { error: plugs.error };
    out.plugs = JSON.stringify(plugs.value);
  }
  return { value: out };
}

driverRouter.get('/vehicles', requireDriver, async (req, res) => {
  const vehicles = await prisma.driverVehicle.findMany({ where: { ownerId: req.admin.sub }, orderBy: { createdAt: 'asc' } });
  res.json(vehicles.map(vehicleView));
});

driverRouter.post('/vehicles', requireDriver, async (req, res) => {
  const fields = vehicleFields(req.body, { creating: true });
  if (fields.error) return res.status(400).json({ error: fields.error });
  const vehicle = await prisma.driverVehicle.create({
    data: { ownerId: req.admin.sub, make: null, model: null, licensePlate: null, ...fields.value },
  });
  res.status(201).json(vehicleView(vehicle));
});

driverRouter.put('/vehicles/:id', requireDriver, async (req, res) => {
  const existing = await prisma.driverVehicle.findFirst({ where: { id: req.params.id, ownerId: req.admin.sub } });
  if (!existing) return res.status(404).json({ error: 'Vehicle not found' });
  const fields = vehicleFields(req.body, { creating: false });
  if (fields.error) return res.status(400).json({ error: fields.error });
  const vehicle = await prisma.driverVehicle.update({ where: { id: existing.id }, data: fields.value });
  res.json(vehicleView(vehicle));
});

driverRouter.delete('/vehicles/:id', requireDriver, async (req, res) => {
  const { count } = await prisma.driverVehicle.deleteMany({ where: { id: req.params.id, ownerId: req.admin.sub } });
  if (!count) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ ok: true });
});
