import { readPageRequest } from '../pagination.js';
import { Router } from 'express';
import { missingPermissions } from '../services/roleService.js';
import { recordAudit } from '../audit/record.js';
import {
  serializeAccount,
  listServiceAccounts,
  getServiceAccount,
  findAccountRow,
  createServiceAccount,
  updateServiceAccount,
  deleteServiceAccount,
  issueApiKey,
  revokeApiKey,
  validateAccountInput,
  validateKeyInput,
  parseAccountPermissions,
} from '../services/serviceAccountService.js';

// Service accounts and their API keys, for the admin UI. Mounted behind
// serviceAccounts.view (reads) and serviceAccounts.manage (changes).
export const adminServiceAccountsRouter = Router();

// Records a change to a service account or its keys, with before and after values.
function audit(req, res, { action, account, key, outcome = 'SUCCESS', changes, reason }) {
  recordAudit(
    {
      tenantId: req.admin.tenantId,
      actorType: 'ADMIN',
      actorId: req.admin.sub,
      actorLabel: req.admin.email ?? null,
      action,
      targetType: key ? 'api_key' : 'service_account',
      targetId: key?.id ?? account?.id ?? null,
      targetLabel: key ? `${account?.name ?? ''} / ${key.name ?? ''}`.trim() : account?.name ?? null,
      outcome,
      reason,
      changes,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
}

// Field-level before and after values for the fields that changed.
function diffAccount(before, after) {
  const changes = {};
  for (const field of ['name', 'description', 'permissions', 'disabled']) {
    const from = before[field];
    const to = after[field];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

// A person may only give an account permissions they hold themselves, so nobody
// can use a service account to climb above their own access.
function escalationError(req, requested) {
  const missing = missingPermissions(req.admin.permissions, requested);
  return missing.length ? { status: 403, body: { error: 'You cannot grant permissions you do not hold', missing } } : null;
}

adminServiceAccountsRouter.get('/', async (req, res) => {
  const page = readPageRequest(req.query);
  if (page.error) return res.status(400).json({ error: page.error });
  res.json(await listServiceAccounts(page));
});

adminServiceAccountsRouter.post('/', async (req, res) => {
  const { value, error } = validateAccountInput(req.body ?? {});
  if (error) return res.status(400).json({ error });
  const denied = escalationError(req, value.permissions ?? []);
  if (denied) return res.status(denied.status).json(denied.body);

  try {
    const account = await createServiceAccount(value, { adminId: req.admin.sub });
    audit(req, res, { action: 'service_account.create', account, changes: { name: { from: null, to: account.name }, permissions: { from: [], to: account.permissions } } });
    res.status(201).json(account);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `A service account named "${value.name}" already exists` });
    throw err;
  }
});

adminServiceAccountsRouter.put('/:id', async (req, res) => {
  const existing = await findAccountRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service account not found' });

  const { value, error } = validateAccountInput(req.body ?? {}, { requireName: false });
  if (error) return res.status(400).json({ error });

  // Only newly added permissions need the grantor to hold them. Removing one is always allowed.
  if (value.permissions !== undefined) {
    const current = parseAccountPermissions(existing.permissions);
    const denied = escalationError(req, value.permissions.filter((p) => !current.includes(p)));
    if (denied) return res.status(denied.status).json(denied.body);
  }

  try {
    const before = serializeAccount(existing);
    const updated = await updateServiceAccount(req.params.id, value);
    const changes = diffAccount(before, updated);
    if (Object.keys(changes).length) {
      audit(req, res, { action: changes.disabled ? (updated.disabled ? 'service_account.disable' : 'service_account.enable') : 'service_account.update', account: updated, changes });
    }
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `A service account named "${value.name}" already exists` });
    throw err;
  }
});

adminServiceAccountsRouter.delete('/:id', async (req, res) => {
  const existing = await findAccountRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service account not found' });
  await deleteServiceAccount(existing.id);
  audit(req, res, { action: 'service_account.delete', account: serializeAccount(existing) });
  res.status(204).end();
});

// Creates a key. The response is the only time the full key is shown.
adminServiceAccountsRouter.post('/:id/keys', async (req, res) => {
  const existing = await findAccountRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service account not found' });
  const { value, error } = validateKeyInput(req.body ?? {});
  if (error) return res.status(400).json({ error });

  const { plainKey, key } = await issueApiKey(existing.id, value);
  audit(req, res, { action: 'api_key.create', account: existing, key, changes: { name: { from: null, to: key.name }, expiresAt: { from: null, to: key.expiresAt } } });
  res.status(201).json({ key, plainKey });
});

adminServiceAccountsRouter.delete('/:id/keys/:keyId', async (req, res) => {
  const existing = await findAccountRow(req.params.id);
  const found = await revokeApiKey(req.params.id, req.params.keyId);
  if (!found) return res.status(404).json({ error: 'API key not found' });
  audit(req, res, { action: 'api_key.revoke', account: existing, key: { id: req.params.keyId, name: null }, changes: { revokedAt: { from: null, to: 'now' } } });
  res.json(await getServiceAccount(req.params.id));
});
