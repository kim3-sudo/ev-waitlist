import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { requireDriver } from '../auth/auth.middleware.js';
import { ensureCredential } from '../services/wallet/credentialService.js';
import { appleCheck, googleCredentials, walletStatus } from '../services/wallet/walletSettings.js';
import { buildPkpass } from '../services/wallet/applePass.js';
import { googleSaveUrl } from '../services/wallet/googlePass.js';
import { siteConfig } from '../services/runtimeConfig.js';
import { cleanText } from '../services/locator.js';
import { phoneProblem, plugsProblem, vehicleView } from '../services/driverAccounts.js';

// Driver accounts: the account's details, its password, and its vehicles. Signing in is shared
// with admins: see auth.routes.js (password) and signInCode.routes.js (one-time code). Mounted at
// /api/driver for the default site and /api/t/<slug>/driver for a named one.
export const driverRouter = Router();

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

// Wallet passes. Which platforms the site has set up, so the account page knows what to offer.
driverRouter.get('/wallet', requireDriver, (req, res) => {
  const status = walletStatus(siteConfig().wallet);
  res.json({ apple: status.apple.ready, google: status.google.ready });
});

// The driver's Apple Wallet pass. Asking for it issues the driver's tag the first time.
driverRouter.get('/wallet/apple', requireDriver, async (req, res) => {
  const wallet = siteConfig().wallet;
  if (!appleCheck(wallet.apple).ready) {
    return res.status(404).json({ error: 'Apple Wallet passes are not set up for this site.' });
  }
  const credential = await ensureCredential(req.admin.sub);
  const pass = buildPkpass(wallet.apple, { serial: credential.idTag, design: wallet.design });
  res.set('Content-Type', 'application/vnd.apple.pkpass');
  res.set('Content-Disposition', 'attachment; filename="charging-pass.pkpass"');
  res.send(pass);
});

// The link that adds the driver's Google Wallet pass. The page opens it on the phone.
driverRouter.get('/wallet/google', requireDriver, async (req, res) => {
  const config = siteConfig();
  const credentials = googleCredentials(config.wallet.google);
  if (!credentials) return res.status(404).json({ error: 'Google Wallet passes are not set up for this site.' });
  const credential = await ensureCredential(req.admin.sub);
  let origin = '';
  try {
    origin = new URL(config.webUrl).origin;
  } catch {
    origin = '';
  }
  res.json({ url: googleSaveUrl(credentials, credential.idTag, { origin, design: config.wallet.design }) });
});
