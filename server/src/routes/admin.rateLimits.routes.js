import { Router } from 'express';
import { rateLimitView, resetToDefaults, saveChanges, validateChanges } from '../rateLimit/rules.js';
import { recordAudit } from '../audit/record.js';

// Mounted behind rateLimits.manage and requireInstanceAdmin. The limits cover the whole
// installation, because they apply before a request is tied to a site.
export const adminRateLimitsRouter = Router();

function audit(req, res, action, changes) {
  recordAudit(
    {
      tenantId: req.admin.homeTenantId ?? null,
      actorType: 'ADMIN',
      actorId: req.admin.sub,
      actorLabel: req.admin.email ?? null,
      action,
      targetType: 'rate_limits',
      outcome: 'SUCCESS',
      changes,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
    { res },
  );
}

adminRateLimitsRouter.get('/', (req, res) => {
  res.json({ rules: rateLimitView() });
});

// Body: { rules: { "login.ip": { limit: 10, windowSeconds: 600, enabled: true }, ... } }. Rules left
// out are not changed.
adminRateLimitsRouter.put('/', async (req, res) => {
  const checked = validateChanges(req.body?.rules);
  if (checked.error) return res.status(400).json({ error: checked.error });
  if (Object.keys(checked.value).length === 0) return res.status(400).json({ error: 'No changes were sent' });

  const before = Object.fromEntries(rateLimitView().map((r) => [r.name, r]));
  await saveChanges(checked.value);
  const changes = {};
  for (const [name, change] of Object.entries(checked.value)) {
    for (const [field, to] of Object.entries(change)) {
      if (before[name][field] !== to) changes[`${name}.${field}`] = { from: before[name][field], to };
    }
  }
  audit(req, res, 'admin.rate-limits.update', changes);
  res.json({ rules: rateLimitView() });
});

// Puts every limit back to its default.
adminRateLimitsRouter.delete('/', async (req, res) => {
  await resetToDefaults();
  audit(req, res, 'admin.rate-limits.reset', null);
  res.json({ rules: rateLimitView() });
});
